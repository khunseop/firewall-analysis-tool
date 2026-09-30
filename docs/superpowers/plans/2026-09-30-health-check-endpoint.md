# 헬스체크 엔드포인트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모니터링/오케스트레이션 도구가 서버 생존 여부를 확인할 수 있는 인증 불필요 헬스체크 엔드포인트를 추가한다.

**Architecture:** 다른 엔드포인트와 동일한 패턴(`app/api/api_v1/endpoints/`)으로 `health.py`를 신설하고, `api.py`에서 `dependencies=_auth` 없이 등록해 자동으로 인증 없는 공개 엔드포인트가 되게 한다 (이미 `auth.router`가 같은 방식으로 공개되어 있음). DB 연결 상태까지 함께 확인해 "프로세스는 떠 있지만 DB에 붙지 못하는" 상태도 감지한다.

**Tech Stack:** FastAPI, SQLAlchemy `text()` — 새 의존성 없음.

**Spec:** `docs/superpowers/plans/2026-09-30-production-readiness-roadmap.md` (항목 4)

## Global Constraints

- 새 외부 의존성 추가 금지.
- 엔드포인트는 인증이 필요 없어야 한다 (모니터링 도구가 토큰 없이 호출).
- DB 체크 실패 시 내부 에러 메시지를 응답 본문에 노출하지 않는다 (정보 노출 방지) — 로그에만 스택트레이스를 남긴다.

---

## File Structure

- Create: `backend/app/api/api_v1/endpoints/health.py` — `GET /health` 라우트.
- Test: `backend/tests/test_health.py`
- Modify: `backend/app/api/api_v1/api.py` — `health.router`를 인증 의존성 없이 등록.

---

### Task 1: 헬스체크 엔드포인트 + 테스트

**Files:**
- Create: `backend/app/api/api_v1/endpoints/health.py`
- Test: `backend/tests/test_health.py`
- Modify: `backend/app/api/api_v1/api.py`

**Interfaces:**
- Produces: `GET /api/v1/health` — 성공 시 `200 {"status": "ok", "database": "ok"}`, DB 연결 실패 시 `503 {"status": "error", "database": "error"}`.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_health.py`:

```python
from starlette.testclient import TestClient

from app.main import app


def test_health_check_returns_ok_with_db_status():
    client = TestClient(app)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_health.py -v
```

Expected: `404` — 엔드포인트가 아직 없어서 `assert response.status_code == 200`에서 FAIL.

- [ ] **Step 3: 엔드포인트 구현**

`backend/app/api/api_v1/endpoints/health.py`:

```python
"""모니터링/오케스트레이션 도구용 헬스체크 엔드포인트. 인증 불필요."""
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db.session import SessionLocal

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health_check():
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("헬스체크: DB 연결 실패")
        return JSONResponse({"status": "error", "database": "error"}, status_code=503)
    return {"status": "ok", "database": "ok"}
```

`backend/app/api/api_v1/api.py`의 import 목록에 `health`를 추가하고, `auth.router` 등록 바로 다음 줄에 인증 의존성 없이 등록한다 (파일 상단 import 블록과 라우터 등록 블록 두 곳을 수정):

```python
from app.api.api_v1.endpoints import (
    devices, firewall_sync, firewall_query, export, analysis, analysis_projects,
    websocket, sync_schedule, settings, notifications, deletion_workflow,
    users, policy_builder, health,
)
```

```python
# Public: auth endpoints (no authentication required)
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
# Public: 헬스체크 (모니터링 도구가 토큰 없이 호출)
api_router.include_router(health.router, tags=["health"])
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_health.py -v
```

Expected: PASS. (이 테스트는 실제 프로젝트 DB(`fat.db`)에 읽기 전용 `SELECT 1`을 날려 연결을 확인한다 — 부작용 없음.)

- [ ] **Step 5: 수동 검증 — 인증 없이 호출 가능한지 확인**

```bash
cd /Users/hoon/Code/firewall-analysis-tool
(.venv/bin/uvicorn app.main:app --app-dir backend --port 8014 > /tmp/uvicorn_health_verify.log 2>&1 &)
sleep 2
curl -s -w "\n%{http_code}\n" http://localhost:8014/api/v1/health
pkill -f "uvicorn app.main:app --app-dir backend --port 8014"
```

Expected: `Authorization` 헤더 없이도 `{"status":"ok","database":"ok"}`와 `200`이 출력된다 (다른 `/api/v1/*` 엔드포인트와 달리 401이 아님을 확인).

- [ ] **Step 6: 전체 테스트 회귀 확인**

```bash
cd backend && ../.venv/bin/python -m pytest -v
```

Expected: 기존 10개 + 신규 1개 = 11개 모두 PASS.

- [ ] **Step 7: 커밋**

```bash
git add backend/app/api/api_v1/endpoints/health.py backend/app/api/api_v1/api.py backend/tests/test_health.py
git commit -m "$(cat <<'EOF'
feat: 인증 불필요 헬스체크 엔드포인트 추가 (GET /api/v1/health)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 로드맵 항목 4 전체를 Task 1이 커버.
- **플레이스홀더 스캔**: 없음.
- **타입 일관성**: 응답 스키마(`{"status": ..., "database": ...}`)가 테스트와 구현에서 동일.
