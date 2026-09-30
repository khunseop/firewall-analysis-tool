# 직접 추출(사용이력 등) 취소 기능 + 서버 재시작 후 고아 작업 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 보고한 두 가지를 고친다 — (1) 서버가 추출 도중 재시작되면 `ExportTask`가 `in_progress` 상태로 영원히 멈춰 DevicesPage 상단 패널에 스피너가 영구히 떠 있는 버그, (2) 진행 중인 직접 추출(정책/객체/사용이력)을 사용자가 중간에 취소하는 기능이 아예 없던 문제.

**Architecture:** `run_export_task`는 FastAPI `BackgroundTasks`로 실행되어 요청을 처리한 프로세스에 묶여 있다 — 프로세스가 죽으면 그 태스크도 함께 죽지만 DB의 `ExportTask.status`는 마지막으로 기록된 값(`in_progress`)에 그대로 멈춰 있고, `GET /devices/export-tasks/active`는 `status in (pending, in_progress)`를 시간 제한 없이 그대로 반환하므로 영원히 다시 나타난다. 두 가지로 고친다: (a) 앱 시작 시(`lifespan`) 고아가 된 `pending`/`in_progress` 작업을 일괄 `failure`로 정리, (b) 실행 중인 작업을 즉시 실패 처리하고 다음 장비로 넘어가기 전 루프가 스스로 멈추는 협조적 취소(cooperative cancellation) 엔드포인트 추가.

**Tech Stack:** 기존 스택 그대로 — 새 의존성 없음.

**Spec:** 사용자 보고 — "예전에 사용이력 추출했다가 중간에 서버 종료한적 있는데, 사용이력 추출 중이 계속 UI에 하나 떠있는 문제가 있어. 중간에 취소하는 기능 확인해줘."

## Global Constraints

- 실행 중인 백그라운드 태스크를 강제로 kill하지는 않는다 — 장비와의 네트워크 호출(SSH/API) 도중 즉시 끊을 안전한 방법이 없다. 대신 DB 상태를 먼저 바꿔 UI가 즉시 반응하게 하고, 실행 루프가 스스로 멈추게 하는 협조적 취소로 처리한다.
- `ExportTask`에 국한한다 — `AnalysisTask`/동기화도 같은 구조(BackgroundTasks, 크래시 시 고아 상태)를 갖고 있어 잠재적으로 같은 문제가 있을 수 있지만, 이번 사용자 보고는 "사용이력 추출"(Devices 페이지 직접 추출) 범위이므로 그것만 고친다. 나머지는 로드맵에 후속 이슈로 남긴다.
- 마이그레이션(스키마 변경) 없이 기존 `status`/`error_message` 컬럼만으로 취소 상태를 표현한다 (`status="failure"` + 고정 문구의 `error_message`로 "취소됨"을 구분).

---

## File Structure

- Modify: `backend/app/services/export/tasks.py` — 취소 함수 + 협조적 취소 체크 추가.
- Modify: `backend/app/api/api_v1/endpoints/devices.py` — 취소 엔드포인트 추가.
- Modify: `backend/app/main.py` — 시작 시 고아 `ExportTask` 정리.
- Modify: `frontend/src/api/devices.ts` — `cancelExportTask()` 추가.
- Modify: `frontend/src/components/pages/DevicesPage.tsx` — 진행 중 항목에 취소 버튼 추가.

---

### Task 1: 서버 시작 시 고아 `ExportTask` 정리

**Files:**
- Modify: `backend/app/main.py`

기존 `lifespan`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    sync_scheduler.start()
    await sync_scheduler.load_schedules()
    logger.info("Application started and scheduler initialized")
    yield
    sync_scheduler.stop()
    logger.info("Application shutdown and scheduler stopped")
```

를 다음으로 교체 (앱 시작 직후, 스케줄러 초기화 전에 고아 작업 정리 — DB 세션 하나로 끝나는 가벼운 작업이라 스케줄러 시작을 막지 않는다):

```python
async def _recover_orphaned_export_tasks() -> None:
    """이전 프로세스가 비정상 종료돼 in_progress/pending으로 멈춘 ExportTask를 failure로 정리한다.

    BackgroundTasks로 실행되는 추출 작업은 서버 프로세스에 묶여 있어, 프로세스가 죽으면
    DB의 status가 마지막 값(in_progress)에 그대로 멈춘 채 남는다. 정리하지 않으면
    GET /devices/export-tasks/active가 이 행을 시간 제한 없이 계속 반환해 UI에 진행중
    스피너가 영구히 떠 있는 버그로 이어진다.
    """
    from sqlalchemy import select
    from app.db.session import SessionLocal
    from app.models.export_task import ExportTask

    async with SessionLocal() as db:
        result = await db.execute(
            select(ExportTask).where(ExportTask.status.in_(["pending", "in_progress"]))
        )
        orphaned = result.scalars().all()
        if not orphaned:
            return
        for task in orphaned:
            task.status = "failure"
            task.error_message = "서버가 재시작되어 작업이 중단되었습니다. 다시 시도해주세요."
            task.completed_at = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
        await db.commit()
        logger.info(f"고아 ExportTask {len(orphaned)}건을 failure로 정리했습니다.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _recover_orphaned_export_tasks()
    sync_scheduler.start()
    await sync_scheduler.load_schedules()
    logger.info("Application started and scheduler initialized")
    yield
    sync_scheduler.stop()
    logger.info("Application shutdown and scheduler stopped")
```

`backend/app/main.py` 상단 import 블록에 `datetime`/`ZoneInfo`가 아직 없다면 추가한다:

```python
from datetime import datetime
from zoneinfo import ZoneInfo
```

(이미 `from pathlib import Path` 등이 있는 import 블록 최상단, `from contextlib import asynccontextmanager` 다음 줄에 추가.)

- [ ] **Step 1: 위 교체 적용**
- [ ] **Step 2: 수동 검증 — 실제로 고아 행을 만들어서 정리되는지 확인**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/backend
../.venv/bin/python -c "
import asyncio
from datetime import datetime
from app.db.session import SessionLocal
from app.models.export_task import ExportTask

async def main():
    async with SessionLocal() as db:
        t = ExportTask(
            device_ids=[1], export_type='hit_dates', source='live',
            merge=False, use_ssh=False, timeout_seconds=600,
            status='in_progress', progress_total=1, created_at=datetime.now(),
        )
        db.add(t)
        await db.commit()
        await db.refresh(t)
        print('created orphan task id:', t.id)

asyncio.run(main())
"
```

메모해둔 id로 서버를 기동해 정리되는지 확인:

```bash
cd /Users/hoon/Code/firewall-analysis-tool
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 &
sleep 2
curl -s http://localhost:8000/api/v1/devices/export-tasks/<메모한 id> | python3 -m json.tool
kill %1
```

Expected: `status: "failure"`, `error_message: "서버가 재시작되어 작업이 중단되었습니다. 다시 시도해주세요."`.

- [ ] **Step 3: 커밋**

```bash
git add backend/app/main.py
git commit -m "$(cat <<'EOF'
fix: 서버 재시작 시 고아 상태로 멈춘 ExportTask를 failure로 정리

BackgroundTasks로 실행되는 직접 추출 작업이 서버 프로세스와 함께
죽으면 DB status가 in_progress에 그대로 멈춰, 시간 제한 없는
/export-tasks/active 조회 때문에 UI에 진행중 스피너가 영구히
떠 있는 버그가 있었다. 앱 시작 시 고아 행을 일괄 정리하도록 수정.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 백엔드 — 취소 엔드포인트 + 협조적 취소

**Files:**
- Modify: `backend/app/services/export/tasks.py`
- Modify: `backend/app/api/api_v1/endpoints/devices.py`

**Interfaces:**
- Produces: `CANCELLED_MESSAGE: str`, `async def cancel_export_task(task_id: int) -> bool` — `app/services/export/tasks.py`.
- Produces: `POST /api/v1/devices/export-tasks/{task_id}/cancel` — 취소 성공 시 `{"cancelled": true}`, 이미 끝난 작업이면 `409`.

- [ ] **Step 1: `tasks.py`에 취소 지원 추가**

`backend/app/services/export/tasks.py`의 `EXPORT_TYPE_LABEL` 정의 다음에 추가:

```python
CANCELLED_MESSAGE = "사용자가 취소했습니다."


async def cancel_export_task(task_id: int) -> bool:
    """진행 중인 추출 작업을 취소한다. 이미 끝난 작업이면 아무 것도 하지 않고 False를 반환한다.

    실행 중인 백그라운드 태스크를 강제 종료하지는 않는다(장비 접속 중인 네트워크 호출을
    안전하게 즉시 끊을 방법이 없음) — 대신 DB 상태를 먼저 failure로 바꿔 UI가 즉시
    반응하게 하고, 실행 루프(run_export_task)가 다음 장비로 넘어가기 전 이 상태를
    확인해 스스로 멈추게 한다(협조적 취소).
    """
    async with SessionLocal() as db:
        task = await db.get(models.ExportTask, task_id)
        if not task or task.status not in ("pending", "in_progress"):
            return False
    await _update_export_task(task_id, status="failure", error_message=CANCELLED_MESSAGE)
    return True


async def _is_cancelled(task_id: int) -> bool:
    async with SessionLocal() as db:
        task = await db.get(models.ExportTask, task_id)
        return bool(task and task.status == "failure" and task.error_message == CANCELLED_MESSAGE)
```

`run_export_task`의 `for idx, device in enumerate(devices, start=1):` 루프 맨 앞에 취소 체크를 추가한다. 기존:

```python
    try:
        for idx, device in enumerate(devices, start=1):
            await _update_export_task(task_id, step=f"{device.name} 처리 중 ({idx}/{len(devices)})")
```

를 다음으로 교체:

```python
    try:
        for idx, device in enumerate(devices, start=1):
            if await _is_cancelled(task_id):
                logger.info(f"[export] 작업 취소됨 task_id={task_id}")
                return
            await _update_export_task(task_id, step=f"{device.name} 처리 중 ({idx}/{len(devices)})")
```

루프가 끝난 직후, 엑셀 생성 시작 전에도 한 번 더 체크한다. 기존:

```python
        await _update_export_task(task_id, step="엑셀 생성 중...")
        today = date.today().strftime("%Y-%m-%d")
```

를 다음으로 교체:

```python
        if await _is_cancelled(task_id):
            logger.info(f"[export] 작업 취소됨 task_id={task_id}")
            return

        await _update_export_task(task_id, step="엑셀 생성 중...")
        today = date.today().strftime("%Y-%m-%d")
```

- [ ] **Step 2: 취소 엔드포인트 추가**

`backend/app/api/api_v1/endpoints/devices.py` 상단 import에 `cancel_export_task` 추가:

```python
from app.services.export.tasks import run_export_task, cancel_export_task
```

`GET /export-tasks/{task_id}` 라우트 다음에 취소 라우트를 추가:

```python
@router.post("/export-tasks/{task_id}/cancel")
async def cancel_export_task_endpoint(task_id: int, db: AsyncSession = Depends(get_db)):
    """진행 중인 직접 추출 작업을 취소합니다. 실행 중인 네트워크 호출을 즉시 끊지는
    못하지만, 작업을 즉시 실패 처리하고 다음 장비로 넘어가기 전에 스스로 멈추게 합니다."""
    task = await db.get(models.ExportTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Export task not found")
    cancelled = await cancel_export_task(task_id)
    if not cancelled:
        raise HTTPException(status_code=409, detail="이미 완료되었거나 실패한 작업입니다.")
    return {"cancelled": True}
```

- [ ] **Step 3: 수동 검증**

```bash
cd /Users/hoon/Code/firewall-analysis-tool
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 &
sleep 2
```

브라우저에서 로그인 후 Devices 페이지 → 존재하는 장비 하나로 "사용이력" 직접 추출 시작 → 진행 중 패널에 스피너가 뜨면 개발자도구 Network나 아래 curl로 취소:

```bash
curl -s -X POST http://localhost:8000/api/v1/devices/export-tasks/<방금 시작한 task_id>/cancel -H "Authorization: Bearer <토큰>"
```

Expected: 응답 `{"cancelled": true}`. UI의 스피너가 WebSocket 브로드캐스트를 받아 "추출 실패 — 사용자가 취소했습니다."로 바뀐다(Task 3에서 취소 버튼을 붙이면 curl 없이 버튼으로 바로 확인 가능).

이미 끝난 작업에 다시 취소를 호출하면 `409`가 오는지도 확인한다.

- [ ] **Step 4: 전체 회귀 확인**

```bash
cd backend && ../.venv/bin/python -m pytest -v 2>&1 | tail -10
../.venv/bin/python -c "from app.services.export import tasks; from app.api.api_v1.endpoints import devices; print('import ok')"
```

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/export/tasks.py backend/app/api/api_v1/endpoints/devices.py
git commit -m "$(cat <<'EOF'
feat: 진행 중인 직접 추출(정책/객체/사용이력) 취소 엔드포인트 추가

지금까지 진행 중인 추출을 중간에 멈출 방법이 전혀 없었다. 장비와의
네트워크 호출을 안전하게 즉시 끊을 수 없어, 상태를 먼저 failure로
바꿔 UI가 즉시 반응하게 하고 실행 루프가 다음 장비로 넘어가기 전에
스스로 멈추는 협조적 취소로 구현.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 프론트엔드 — 진행 중 항목에 취소 버튼 추가

**Files:**
- Modify: `frontend/src/api/devices.ts`
- Modify: `frontend/src/components/pages/DevicesPage.tsx`

**Interfaces:**
- Consumes: `POST /devices/export-tasks/{taskId}/cancel` (Task 2에서 정의).
- Produces: `cancelExportTask(taskId: number): Promise<void>` — `frontend/src/api/devices.ts`.

- [ ] **Step 1: API 함수 추가**

`frontend/src/api/devices.ts`의 `downloadExportResult` 정의 다음에 추가:

```typescript
export const cancelExportTask = async (taskId: number): Promise<void> => {
  await apiClient.post(`/devices/export-tasks/${taskId}/cancel`)
}
```

- [ ] **Step 2: DevicesPage.tsx에 취소 버튼 추가**

import에 `cancelExportTask` 추가:

```typescript
import { listDevices, createDevice, updateDevice, deleteDevice, testConnection, syncAll, downloadDeviceTemplate, bulkImportDevices, getActiveExportTasks, downloadExportResult, cancelExportTask, type Device, type DeviceCreate, type DeviceUpdate, type DirectExportType } from '@/api/devices'
```

취소 뮤테이션을 다른 뮤테이션들(`createMutation` 등) 근처에 추가:

```typescript
const cancelExportMutation = useMutation({
  mutationFn: (taskId: number) => cancelExportTask(taskId),
  onError: (e: Error) => toast.error(e.message),
})
```

진행 중 항목 렌더 블록(`Loader2` 스피너가 있는 마지막 `return` 블록)을 기존:

```tsx
            return (
              <div key={t.id} className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 shrink-0 text-ds-tertiary animate-spin" />
                <span className="text-[11px] text-ds-on-surface-variant shrink-0">
                  {t.deviceLabel && <span className="font-semibold">{t.deviceLabel}</span>} {exportTypeLabel(t.exportType)} 추출
                </span>
                <span className="text-[11px] text-ds-on-surface-variant/70 truncate flex-1">{t.step ?? '대기 중...'}</span>
                <span className="text-[11px] font-semibold tabular-nums text-ds-on-surface-variant shrink-0">
                  {t.progressCurrent} / {t.progressTotal}
                </span>
              </div>
            )
```

를 다음으로 교체 (취소 버튼 한 개 추가):

```tsx
            return (
              <div key={t.id} className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 shrink-0 text-ds-tertiary animate-spin" />
                <span className="text-[11px] text-ds-on-surface-variant shrink-0">
                  {t.deviceLabel && <span className="font-semibold">{t.deviceLabel}</span>} {exportTypeLabel(t.exportType)} 추출
                </span>
                <span className="text-[11px] text-ds-on-surface-variant/70 truncate flex-1">{t.step ?? '대기 중...'}</span>
                <span className="text-[11px] font-semibold tabular-nums text-ds-on-surface-variant shrink-0">
                  {t.progressCurrent} / {t.progressTotal}
                </span>
                <button
                  onClick={() => cancelExportMutation.mutate(t.id)}
                  disabled={cancelExportMutation.isPending}
                  className="shrink-0 text-[11px] font-semibold text-ds-error hover:bg-ds-error/10 rounded-md px-2 py-0.5 transition-colors disabled:opacity-50"
                >
                  취소
                </button>
              </div>
            )
```

- [ ] **Step 3: 타입체크 + 린트 + 빌드**

```bash
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```

Expected: 전부 에러 없이 통과.

- [ ] **Step 4: 수동 검증 (실제 브라우저)**

Devices 페이지에서 실제 장비로 "사용이력" 직접 추출을 시작하고, 진행 중 패널에 뜨는 "취소" 버튼을 눌러 즉시 "추출 실패 — 사용자가 취소했습니다."로 바뀌는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/api/devices.ts frontend/src/components/pages/DevicesPage.tsx
git commit -m "$(cat <<'EOF'
feat: 진행 중인 직접 추출 항목에 취소 버튼 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 사용자가 보고한 두 가지(재시작 후 영구 스피너, 취소 기능 부재)를 각각 Task 1, Task 2·3이 커버.
- **플레이스홀더 스캔**: 없음.
- **타입 일관성**: `cancel_export_task(task_id) -> bool`이 서비스 정의·엔드포인트 사용처에서 일치. `cancelExportTask(taskId): Promise<void>`가 프론트 정의·사용처에서 일치.
- **의도적으로 하지 않은 것**: `AnalysisTask`/동기화도 같은 BackgroundTasks 구조라 잠재적으로 같은 "재시작 후 고아 상태" 문제가 있을 수 있음 — 이번 사용자 보고 범위(사용이력 추출)를 벗어나므로 손대지 않고 로드맵에 후속 이슈로 기록한다. 실행 중인 네트워크 호출 자체를 즉시 끊는 하드 취소(예: `asyncio.Task.cancel()` + executor 스레드 강제 종료)는 구현 복잡도·위험도가 높아 범위에서 제외하고 협조적 취소로 한정했다.
