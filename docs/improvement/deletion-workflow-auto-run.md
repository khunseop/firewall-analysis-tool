# 삭제 워크플로우 서버 사이드 자동진행 설계 (제안)

> 상태: 설계 초안 (미구현)
> 배경: 현재 "자동진행"은 프론트엔드(`DeletionWorkflowDetailPage.tsx`) 안의 클라이언트 사이드 루프로 동작하여 브라우저 탭이 열려있는 동안에만 진행된다. 여러 프로젝트(A/B/C)를 각각 자동진행 걸어두고 페이지를 이동해도 백그라운드로 계속 진행되게 하려면, 자동진행 로직을 백엔드로 옮겨야 한다.

## 핵심 아이디어

`startAutoRunFrom`(프론트 루프)의 로직을 백엔드로 옮기되, HTTP 엔드포인트를 반복 호출하는 대신 `run_project_task`의 내부 로직을 함수로 추출해 백그라운드 태스크 안에서 직접 호출한다. 실행 단위(`WorkspaceRunner`)의 전역 락은 그대로 두어 프로젝트 간 실제 처리는 자동으로 큐잉되게 한다 — 사용자는 여러 프로젝트에 "자동진행"만 걸어두면 된다.

## 1. DB 모델 변경 (`app/models/deletion_workflow.py`)

`DeletionWorkflowProject`에 컬럼 추가 (Alembic 마이그레이션 필요):

- `auto_run_active: Boolean, default=False` — 자동진행 진행 중 여부
- `auto_run_current_task_id: Integer, nullable` — 현재 실행 중인 태스크 (진행률 표시용)
- `auto_run_blocked_task_id: Integer, nullable` — 필수 업로드 대기로 일시정지된 태스크

기존 `status`(draft/running/completed)는 그대로 두거나 `auto_run_active`로 대체 가능하다. 기존 `running_task_id` 락(수동 실행용)과 자동진행을 구분해야 충돌 방지가 되므로, **자동진행 중에도 `running_task_id`를 갱신**해 기존 수동 실행 잠금 로직을 그대로 재사용한다 (수동으로 다른 태스크를 누르면 409로 막힘 — 이미 구현된 동작).

## 2. 백엔드 리팩터링 (`app/api/api_v1/endpoints/deletion_workflow.py`)

- `run_project_task`의 본문(파일 로드 → WorkspaceRunner 실행 → 결과 저장 → 락 해제)을 `_execute_project_task(db, project, task_id, extra_kwargs) -> TaskRunResult` 같은 내부 함수로 추출한다. 기존 엔드포인트는 이 함수를 호출하도록 리팩터링(동작 변화 없음).
- 신규: `POST /projects/{id}/auto-run` — `asyncio.create_task(_auto_run_project(project_id, from_task_id))`로 백그라운드 코루틴 시작 후 즉시 202 응답.
- 신규: `POST /projects/{id}/auto-run/stop` — 프로세스 전역 `dict[int, asyncio.Event]`(analysis의 `_get_device_analysis_lock` 패턴 재사용)에 취소 신호.

`_auto_run_project` 코루틴 의사코드:

```python
async def _auto_run_project(project_id: int, from_task_id: int | None):
    async with SessionLocal() as db:   # 요청 스코프 세션 전달 금지 규칙 준수
        for task_id in EXECUTION_ORDER[from_idx:]:
            if cancelled:
                break
            if has_output(task_id):
                continue
            if 필수_external_input_없음(task_id):
                project.auto_run_blocked_task_id = task_id
                await db.commit()
                await broadcast(...)
                return
            project.auto_run_current_task_id = task_id
            await db.commit()
            await broadcast(...)
            try:
                await _execute_project_task(db, project, task_id, {})
            except Exception:
                # status="failed" 기록
                await broadcast(error=...)
                return
        project.auto_run_active = False
        await broadcast(completed=...)
```

`EXECUTION_ORDER`/`externalInputs`/`hasOutput` 판정 로직은 현재 프론트(`taskMeta.ts`)에만 있으므로 **백엔드에 동일한 메타데이터를 파이썬으로 이식**해야 한다 (`task_meta.py`에 `EXECUTION_ORDER`, `external_inputs` 추가). 중복 정의를 피하려면 프론트가 이 메타를 백엔드 API(`GET /tasks`)에서 받아오도록 통합하는 것도 고려할 수 있다.

## 3. 동시성

- `WorkspaceRunner._workspace_lock`(threading.Lock)이 이미 전역 직렬화를 보장한다 — A/B/C 프로젝트의 백그라운드 코루틴이 동시에 떠 있어도 실제 `run_in_executor` 호출은 하나씩만 실행된다. 추가 세마포어는 불필요하다.
- Task 3(중복정책 분석, FAT DB 기반)은 이미 `_run_task3_from_db`로 별도 처리 — 자동진행 루프에서도 동일하게 분기해야 한다.

## 4. WebSocket 브로드캐스트 확장 (`websocket_manager.py`)

현재 채널 구분이 없는 전역 브로드캐스트 구조를 그대로 활용하되, 새 메시지 타입을 추가한다:

```json
{
  "type": "deletion_workflow_auto_run",
  "project_id": 12,
  "status": "running|blocked|completed|failed",
  "current_task_id": 9,
  "blocked_task_id": null,
  "error": null
}
```

프론트는 이 메시지를 `project_id`로 필터링해 여러 페이지(목록/상세)에서 동시에 반영한다.

## 5. 프론트 변경

- `startAutoRunFrom`의 `for` 루프를 제거하고 `POST /auto-run` 한 번 호출 후 WS 메시지로 상태를 갱신한다.
- 프로젝트 목록 페이지에 "자동진행 중 / N번 태스크 대기 중" 배지를 추가한다 — A를 걸어두고 B, C로 이동해 각각 걸어두는 사용자 시나리오가 목록에서 한눈에 확인되어야 한다.
- 서버 재시작 시 `auto_run_active=True`로 멈춘 상태가 남을 수 있으므로 `main.py` lifespan 시작 시 정리(리셋) 로직이 필요하다.

## 6. 마이그레이션/문서

- Alembic 마이그레이션 1개(컬럼 3개 추가), `docs/DATABASE.md` 갱신 필요.

## 미결정 사항

**task_meta를 백엔드에 이식할지, 아니면 프론트가 갖고 있는 `EXECUTION_ORDER`/`externalInputs`를 그대로 신뢰하고 백엔드는 "블로킹 여부만 판정"하는 정도로 최소화할지** 결정이 필요하다. 후자가 훨씬 작은 변경이지만, 자동진행 시작 시점의 스냅샷만 프론트에서 넘겨받는 방식이라 그 사이 프론트 로직이 변경되면 백엔드와 어긋날 위험이 있다.
