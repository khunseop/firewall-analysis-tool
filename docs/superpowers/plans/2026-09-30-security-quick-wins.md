# 보안 퀵윈 (로그인 rate limit + 문서 엔드포인트 비공개) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 엔드포인트에 무차별 대입 방지를 추가하고, `/docs`·`/redoc`·OpenAPI 스키마를 운영 환경에서 비공개로 전환한다.

**Architecture:** (1) 순수 로직으로 테스트 가능한 `LoginRateLimiter` 클래스를 신설해 `auth.py` 로그인 엔드포인트에서 사용자명 기준으로 실패 횟수를 추적하고 임계치 초과 시 429를 반환한다. (2) `Settings.ENVIRONMENT` 설정값을 추가해 `production`일 때 Swagger/ReDoc 라우트와 OpenAPI 스키마 등록 자체를 건너뛴다.

**Tech Stack:** FastAPI, 표준 라이브러리(`threading.Lock`, `time.monotonic`)만 사용 — 새 의존성 없음. 테스트는 `pytest`(신규 도입).

**Spec:** `docs/superpowers/plans/2026-09-30-production-readiness-roadmap.md` (항목 1, 2)

## Global Constraints

- 새 외부 의존성 추가 금지 — 표준 라이브러리만 사용 (Redis 등 외부 저장소 불필요, 단일 프로세스 uvicorn 기준).
- `backend/requirements.txt`에 `pytest`만 추가한다 (비동기 테스트 불필요 — rate limiter는 순수 동기 로직).
- 기존 로그인 성공/실패 흐름(`log_activity` 호출 등)은 그대로 유지하고, 그 앞뒤에 rate limit 체크만 끼워 넣는다.
- `ENVIRONMENT` 미설정 시 기본값은 `development`로, 기존 배포 환경의 동작을 바꾸지 않는다.

---

## File Structure

- Create: `backend/app/core/rate_limit.py` — `LoginRateLimiter` 클래스 + 전역 인스턴스 `login_rate_limiter`.
- Create: `backend/tests/__init__.py`, `backend/tests/test_rate_limit.py` — 순수 로직 단위 테스트.
- Modify: `backend/app/api/api_v1/endpoints/auth.py` — 로그인 엔드포인트에 rate limit 체크/기록 삽입.
- Modify: `backend/app/core/config.py` — `ENVIRONMENT` 설정 필드 추가.
- Modify: `backend/app/main.py` — `ENVIRONMENT`에 따라 `/docs`, `/redoc`, OpenAPI 스키마 등록 여부 결정.
- Modify: `backend/requirements.txt` — `pytest` 추가.

---

### Task 1: LoginRateLimiter 순수 로직 + 단위 테스트

**Files:**
- Create: `backend/app/core/rate_limit.py`
- Test: `backend/tests/test_rate_limit.py`
- Create: `backend/tests/__init__.py` (빈 파일)
- Modify: `backend/requirements.txt`

**Interfaces:**
- Produces: `LoginRateLimiter(max_attempts: int = 5, window_seconds: float = 900, lockout_seconds: float = 900, clock: Callable[[], float] = time.monotonic)` — 메서드 `is_locked(key: str) -> bool`, `record_failure(key: str) -> None`, `record_success(key: str) -> None`. 전역 인스턴스 `login_rate_limiter = LoginRateLimiter()`.

- [ ] **Step 1: pytest 의존성 추가**

`backend/requirements.txt` 맨 끝에 한 줄 추가:

```
pytest
```

설치:

```bash
pip install -r backend/requirements.txt
```

- [ ] **Step 2: 테스트 디렉터리 생성**

```bash
mkdir -p backend/tests
touch backend/tests/__init__.py
```

- [ ] **Step 3: 실패하는 테스트 작성**

`backend/tests/test_rate_limit.py`:

```python
from app.core.rate_limit import LoginRateLimiter


def _fake_clock():
    """테스트에서 시간을 직접 흘려보내기 위한 조작 가능한 클럭."""
    state = {"t": 0.0}

    def now() -> float:
        return state["t"]

    def advance(seconds: float) -> None:
        state["t"] += seconds

    now.advance = advance  # type: ignore[attr-defined]
    return now


def _make_limiter(max_attempts=3, window_seconds=100.0, lockout_seconds=50.0):
    clock = _fake_clock()
    limiter = LoginRateLimiter(
        max_attempts=max_attempts,
        window_seconds=window_seconds,
        lockout_seconds=lockout_seconds,
        clock=clock,
    )
    return limiter, clock


def test_not_locked_before_reaching_max_attempts():
    limiter, _ = _make_limiter(max_attempts=3)
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    assert limiter.is_locked("alice") is False


def test_locked_after_reaching_max_attempts():
    limiter, _ = _make_limiter(max_attempts=3)
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    assert limiter.is_locked("alice") is True


def test_unlocked_after_lockout_period_elapses():
    limiter, clock = _make_limiter(max_attempts=3, lockout_seconds=50.0)
    for _ in range(3):
        limiter.record_failure("alice")
    assert limiter.is_locked("alice") is True
    clock.advance(51.0)
    assert limiter.is_locked("alice") is False


def test_success_resets_attempt_count():
    limiter, _ = _make_limiter(max_attempts=3)
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    limiter.record_success("alice")
    limiter.record_failure("alice")
    assert limiter.is_locked("alice") is False


def test_attempts_outside_window_are_not_counted():
    limiter, clock = _make_limiter(max_attempts=3, window_seconds=100.0)
    limiter.record_failure("alice")
    clock.advance(101.0)
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    assert limiter.is_locked("alice") is False


def test_keys_are_independent():
    limiter, _ = _make_limiter(max_attempts=3)
    for _ in range(3):
        limiter.record_failure("alice")
    assert limiter.is_locked("alice") is True
    assert limiter.is_locked("bob") is False
```

- [ ] **Step 4: 테스트 실행 → 실패 확인**

```bash
cd backend && python -m pytest tests/test_rate_limit.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.core.rate_limit'` (또는 import 에러)로 전부 실패.

- [ ] **Step 5: 최소 구현 작성**

`backend/app/core/rate_limit.py`:

```python
"""로그인 무차별 대입 방지용 in-memory rate limiter.

단일 uvicorn 프로세스를 전제로 한다 (워커를 여러 개로 늘리면 프로세스별로
카운터가 분리되어 효과가 줄어든다 — 현재 배포 방식(단일 프로세스)에서는 문제 없음).
"""
import time
from collections import defaultdict
from threading import Lock
from typing import Callable


class LoginRateLimiter:
    def __init__(
        self,
        max_attempts: int = 5,
        window_seconds: float = 15 * 60,
        lockout_seconds: float = 15 * 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_attempts = max_attempts
        self._window_seconds = window_seconds
        self._lockout_seconds = lockout_seconds
        self._clock = clock
        self._lock = Lock()
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._locked_until: dict[str, float] = {}

    def is_locked(self, key: str) -> bool:
        with self._lock:
            until = self._locked_until.get(key)
            if until is None:
                return False
            if self._clock() >= until:
                del self._locked_until[key]
                self._attempts.pop(key, None)
                return False
            return True

    def record_failure(self, key: str) -> None:
        with self._lock:
            now = self._clock()
            window_start = now - self._window_seconds
            attempts = [t for t in self._attempts[key] if t >= window_start]
            attempts.append(now)
            self._attempts[key] = attempts
            if len(attempts) >= self._max_attempts:
                self._locked_until[key] = now + self._lockout_seconds

    def record_success(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)
            self._locked_until.pop(key, None)


login_rate_limiter = LoginRateLimiter()
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

```bash
cd backend && python -m pytest tests/test_rate_limit.py -v
```

Expected: 6개 테스트 모두 PASS.

- [ ] **Step 7: 커밋**

```bash
git add backend/app/core/rate_limit.py backend/tests/ backend/requirements.txt
git commit -m "$(cat <<'EOF'
feat: 로그인 rate limiter 순수 로직 추가 (테스트 인프라 신설 포함)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 로그인 엔드포인트에 rate limit 연결

**Files:**
- Modify: `backend/app/api/api_v1/endpoints/auth.py`

**Interfaces:**
- Consumes: `login_rate_limiter`의 `is_locked(key)`, `record_failure(key)`, `record_success(key)` (Task 1에서 정의).

- [ ] **Step 1: `login` 엔드포인트 수정**

`backend/app/api/api_v1/endpoints/auth.py` 상단 import에 추가:

```python
from app.core.rate_limit import login_rate_limiter
```

`login` 함수 본문을 다음과 같이 수정 (기존 로직은 그대로 두고 lockout 체크와 성공/실패 기록만 추가):

```python
@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    rate_limit_key = form_data.username.strip().lower()
    if login_rate_limiter.is_locked(rate_limit_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="로그인 시도 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.",
        )

    user = await get_user_by_username(db, form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        login_rate_limiter.record_failure(rate_limit_key)
        await log_activity(
            db,
            title="로그인 실패",
            message=f"사용자 '{form_data.username}' 로그인 실패 (아이디 또는 비밀번호 불일치)",
            type="warning",
            category="auth",
            username=form_data.username,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        await log_activity(
            db,
            title="로그인 거부",
            message=f"비활성화된 계정 '{user.username}' 로그인 시도",
            type="warning",
            category="auth",
            user_id=user.id,
            username=user.username,
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화된 계정입니다")

    login_rate_limiter.record_success(rate_limit_key)
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    await log_activity(
        db,
        title="로그인",
        message=f"사용자 '{user.username}' 로그인",
        type="info",
        category="auth",
        user_id=user.id,
        username=user.username,
    )

    token = create_access_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}
```

- [ ] **Step 2: 수동 검증 (자동화 통합 테스트는 Task 6 테스트 인프라 구축 이후로 미룸)**

서버 실행:

```bash
uvicorn app.main:app --app-dir backend
```

같은 (존재하지 않는) 사용자로 6회 연속 로그인 실패 시도:

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/api/v1/auth/login \
    -d "username=__ratelimit_probe__&password=wrong"
done
```

Expected: 처음 5회는 `401`, 6번째부터 `429`.

정상 계정으로는 평소처럼 로그인이 되는지 브라우저에서 한 번 더 확인한다 (회귀 확인).

- [ ] **Step 3: 커밋**

```bash
git add backend/app/api/api_v1/endpoints/auth.py
git commit -m "$(cat <<'EOF'
feat: 로그인 엔드포인트에 rate limiter 적용

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `ENVIRONMENT` 설정 추가

**Files:**
- Modify: `backend/app/core/config.py`

**Interfaces:**
- Produces: `settings.ENVIRONMENT: str` (기본값 `"development"`).

- [ ] **Step 1: `Settings` 클래스에 필드 추가**

`backend/app/core/config.py`의 `class Settings(BaseSettings):` 블록에 다음 필드를 추가한다 (`JWT_ACCESS_TOKEN_EXPIRE_MINUTES` 다음 줄):

```python
    ENVIRONMENT: str = "development"  # "production"일 때 /docs, /redoc, OpenAPI 스키마 비활성화
```

- [ ] **Step 2: 동작 확인**

```bash
cd backend && python -c "from app.core.config import settings; print(settings.ENVIRONMENT)"
```

Expected: `development` 출력 (기존 `.env`에 `ENVIRONMENT`가 없으므로 기본값 적용).

- [ ] **Step 3: 커밋**

```bash
git add backend/app/core/config.py
git commit -m "$(cat <<'EOF'
feat: ENVIRONMENT 설정값 추가 (기본 development)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 운영 환경에서 `/docs`, `/redoc`, OpenAPI 스키마 비활성화

**Files:**
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `settings.ENVIRONMENT` (Task 3에서 정의).

- [ ] **Step 1: docs 활성화 여부 플래그 및 조건부 등록**

`backend/app/main.py`에서 `from app.services.scheduler import sync_scheduler` 다음 줄에 import 추가:

```python
from app.core.config import settings
```

`SWAGGER_OAUTH2_REDIRECT_PATH = "/docs/oauth2-redirect"` 다음에 플래그 추가:

```python
_DOCS_ENABLED = settings.ENVIRONMENT != "production"
```

`app = FastAPI(...)` 생성 부분의 `openapi_url="/api/v1/openapi.json",`을 다음으로 교체:

```python
    openapi_url="/api/v1/openapi.json" if _DOCS_ENABLED else None,
```

기존에 있던 아래 세 라우트 정의 블록(`custom_swagger_ui_html`, `swagger_ui_redirect`, `redoc_html`) 전체를 다음과 같이 `if _DOCS_ENABLED:` 로 감싼다 (함수 내용은 그대로, 들여쓰기만 4칸 추가):

```python
if _DOCS_ENABLED:
    @app.get(SWAGGER_UI_HTML_PATH, include_in_schema=False)
    async def custom_swagger_ui_html():
        return get_swagger_ui_html(
            openapi_url=app.openapi_url,
            title=f"{app.title} - Swagger UI",
            oauth2_redirect_url=SWAGGER_OAUTH2_REDIRECT_PATH,
            swagger_js_url="/static/swagger-ui-bundle.js",
            swagger_css_url="/static/swagger-ui.css",
        )

    @app.get(SWAGGER_OAUTH2_REDIRECT_PATH, include_in_schema=False)
    async def swagger_ui_redirect():
        return get_swagger_ui_oauth2_redirect_html()

    @app.get(REDOC_HTML_PATH, include_in_schema=False)
    async def redoc_html():
        return get_redoc_html(
            openapi_url=app.openapi_url,
            title=f"{app.title} - ReDoc",
            redoc_js_url="/static/redoc.standalone.js",
        )
```

- [ ] **Step 2: 수동 검증**

기본값(개발 모드) 회귀 확인:

```bash
uvicorn app.main:app --app-dir backend &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/docs
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/v1/openapi.json
kill %1
```

Expected: 둘 다 `200`.

운영 모드 확인 (`backend/.env`에 `ENVIRONMENT=production` 추가 후):

```bash
echo "ENVIRONMENT=production" >> .env
uvicorn app.main:app --app-dir backend &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/docs
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/v1/openapi.json
kill %1
```

Expected: `/docs`는 SPA 폴백으로 `200`(index.html) 또는 `404`, `/api/v1/openapi.json`은 `404`. **테스트 후 `.env`에서 `ENVIRONMENT=production` 줄을 반드시 제거**해서 로컬 개발 환경을 원상복구한다 (실수로 남기면 로컬 개발 중 Swagger를 못 쓰게 됨).

- [ ] **Step 3: 커밋**

```bash
git add backend/app/main.py
git commit -m "$(cat <<'EOF'
feat: 운영 환경에서 Swagger/ReDoc/OpenAPI 스키마 비공개 처리

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 로드맵 항목 1(로그인 rate limit) → Task 1, 2. 항목 2(문서 엔드포인트 비공개) → Task 3, 4. 둘 다 커버됨.
- **플레이스홀더 스캔**: 없음 — 모든 스텝에 실제 코드/명령 포함.
- **타입 일관성**: `LoginRateLimiter`의 메서드명(`is_locked`, `record_failure`, `record_success`)이 Task 1 정의와 Task 2 사용처에서 동일.
- **주의**: Task 4는 실서비스 배포 시 `.env`에 `ENVIRONMENT=production`을 명시적으로 설정해야 효과가 있다. 배포 문서(`docs/DEVELOPMENT.md` 등)에 이 사실을 반영하는 것은 이번 계획 범위 밖이며, 로드맵 문서의 "발견된 추가 이슈"에 후속 작업으로 남긴다.
