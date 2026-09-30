# 자잘한 버그 수정 1차분 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로드맵 항목 8(버그/UX 점검) 조사에서 발견한 항목 중 심각도가 높은 2건을 수정한다: (1) 대량 삭제 시 SQLite IN절 청킹 누락으로 동기화가 죽을 수 있는 백엔드 버그, (2) 프론트엔드 ErrorBoundary가 문서와 달리 앱 전체를 감싸고 있어 페이지 하나의 렌더 에러로 전체 화면이 멈추는 UX 버그.

**Architecture:** 두 수정 모두 기존 프로젝트 컨벤션을 그대로 따른다 — 백엔드는 `policy_indexer.py`가 이미 쓰고 있는 "리스트를 슬라이스해서 반복 `delete().where(.in_(chunk))`" 패턴을 `sync/tasks.py`에 동일 적용. 프론트엔드는 이미 존재하는 `ErrorBoundary` 컴포넌트를 `AppLayout`의 `<Outlet />` 주위로 옮겨 라우트(페이지) 단위로 격리한다.

**Tech Stack:** 기존 스택 그대로 — 새 의존성 없음.

**Spec:** `docs/superpowers/plans/2026-09-30-production-readiness-roadmap.md` (항목 8, 하위 발견 사항)

## Global Constraints

- 이번 배치에서는 조사에서 나온 5건 중 심각도가 높은 2건만 다룬다. 나머지 3건(설정 파싱 실패 무음 처리, tzinfo 폴백 추정 이슈, `get_kst_now()` 3중 중복, 쿼리키 하드코딩)은 로드맵 "발견된 추가 이슈"에 백로그로 남기고 이번엔 손대지 않는다.
- 기존 동작(정상 삭제 케이스)을 절대 깨서는 안 된다 — 청킹은 결과가 완전히 동일해야 하는 순수 최적화/안정성 수정이다.
- 프론트엔드 수정은 기존 `ErrorBoundary` 컴포넌트 자체를 수정하지 않는다 (내용은 이미 적절함) — 감싸는 위치만 옮긴다.

---

## File Structure

- Modify: `backend/app/services/sync/tasks.py` — 삭제 대상 ID 청킹 헬퍼 추가 + 4개 `.in_(ids_to_delete)` 호출부 적용.
- Test: `backend/tests/test_sync_tasks_chunking.py` — 청킹 헬퍼 단위 테스트.
- Modify: `frontend/src/components/layout/AppLayout.tsx` — `<Outlet />`을 `ErrorBoundary`로 감싸기.

---

### Task 1: 백엔드 — 삭제 대상 ID SQLite IN절 청킹

**Files:**
- Modify: `backend/app/services/sync/tasks.py`
- Test: `backend/tests/test_sync_tasks_chunking.py`

**Interfaces:**
- Produces: `_chunked(items: list, size: int) -> Iterator[list]` (module-private 헬퍼, `sync/tasks.py`에 정의).

**배경:** `sync/tasks.py`의 동기화 4단계(삭제 처리)에서 `ids_to_delete`(정수 리스트)를 `PolicyAddressMember.policy_id.in_(ids_to_delete)`, `PolicyServiceMember.policy_id.in_(ids_to_delete)`, `RedundancyPolicySet.policy_id.in_(ids_to_delete)`, `model.id.in_(ids_to_delete)` 네 곳에서 청킹 없이 그대로 사용한다. `policy_indexer.py:163-169`는 같은 상황(정책 ID 리스트로 대량 삭제)에서 이미 `SQLITE_MAX_VARIABLES` 단위로 슬라이스해서 반복 실행하는데, `sync/tasks.py`만 이 컨벤션이 빠져 있다. 장비 하나를 재동기화할 때 800개 이상의 정책이 한꺼번에 사라지는 경우(예: 정책 대량 정리 후 첫 동기화) SQLite 바인딩 변수 한도를 넘어 동기화 태스크 전체가 예외로 실패할 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_sync_tasks_chunking.py`:

```python
from app.services.sync.tasks import _chunked


def test_chunked_splits_into_expected_sizes():
    items = list(range(2001))
    chunks = list(_chunked(items, 800))
    assert [len(c) for c in chunks] == [800, 800, 401]
    assert [x for c in chunks for x in c] == items


def test_chunked_handles_empty_list():
    assert list(_chunked([], 800)) == []


def test_chunked_handles_list_smaller_than_chunk_size():
    items = [1, 2, 3]
    assert list(_chunked(items, 800)) == [[1, 2, 3]]
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_sync_tasks_chunking.py -v
```

Expected: `ImportError: cannot import name '_chunked' from 'app.services.sync.tasks'`로 전부 실패.

- [ ] **Step 3: 청킹 헬퍼 추가 + 4개 호출부 적용**

`backend/app/services/sync/tasks.py`에서 `_device_sync_semaphore` 전역 변수 선언 다음에 헬퍼 추가:

```python
# SQLite 바인딩 변수 한도를 넘지 않도록 대량 삭제 시 IN절을 청킹 (policy_indexer.py와 동일 기준)
_SQLITE_IN_CHUNK = 800


def _chunked(items: list, size: int):
    """items를 size 단위 리스트로 잘라서 순서대로 내놓는다."""
    for i in range(0, len(items), size):
        yield items[i:i + size]
```

기존 삭제 블록:

```python
            if ids_to_delete:
                if data_type == "policies":
                    await db.execute(delete(PolicyAddressMember).where(PolicyAddressMember.policy_id.in_(ids_to_delete)))
                    await db.execute(delete(PolicyServiceMember).where(PolicyServiceMember.policy_id.in_(ids_to_delete)))
                    # ... (기존 주석 그대로)
                    orphan_set_keys = (await db.execute(
                        select(RedundancyPolicySet.task_id, RedundancyPolicySet.set_number)
                        .where(RedundancyPolicySet.policy_id.in_(ids_to_delete))
                        .distinct()
                    )).all()
                    if orphan_set_keys:
                        sets_by_task: Dict[int, set] = {}
                        for task_id_, set_number_ in orphan_set_keys:
                            sets_by_task.setdefault(task_id_, set()).add(set_number_)
                        for task_id_, set_numbers in sets_by_task.items():
                            await db.execute(
                                delete(RedundancyPolicySet).where(
                                    RedundancyPolicySet.task_id == task_id_,
                                    RedundancyPolicySet.set_number.in_(set_numbers),
                                )
                            )
                await db.execute(delete(model).where(model.id.in_(ids_to_delete)))
```

를 다음으로 교체 (로직은 동일, `.in_(ids_to_delete)` 네 곳만 청크 반복으로 변경):

```python
            if ids_to_delete:
                if data_type == "policies":
                    for chunk in _chunked(ids_to_delete, _SQLITE_IN_CHUNK):
                        await db.execute(delete(PolicyAddressMember).where(PolicyAddressMember.policy_id.in_(chunk)))
                        await db.execute(delete(PolicyServiceMember).where(PolicyServiceMember.policy_id.in_(chunk)))
                    # SQLite는 PRAGMA foreign_keys=ON이 아니라서 ondelete="CASCADE"가 실제로
                    # 동작하지 않는다. 명시적으로 지우지 않으면 중복분석 결과가 삭제된
                    # policy_id를 참조하는 고아 행으로 남아 이후 export에서 조용히 누락된다.
                    # 단, policy_id만 지우면 같은 set_number의 짝(상위/하위 정책)이 남아
                    # 파트너 없는 singleton 세트가 되어 "항상 유지"로 오분류되므로,
                    # 삭제된 정책이 속한 세트(task_id, set_number) 전체를 함께 지운다.
                    orphan_set_keys = []
                    for chunk in _chunked(ids_to_delete, _SQLITE_IN_CHUNK):
                        orphan_set_keys.extend((await db.execute(
                            select(RedundancyPolicySet.task_id, RedundancyPolicySet.set_number)
                            .where(RedundancyPolicySet.policy_id.in_(chunk))
                            .distinct()
                        )).all())
                    if orphan_set_keys:
                        sets_by_task: Dict[int, set] = {}
                        for task_id_, set_number_ in orphan_set_keys:
                            sets_by_task.setdefault(task_id_, set()).add(set_number_)
                        for task_id_, set_numbers in sets_by_task.items():
                            await db.execute(
                                delete(RedundancyPolicySet).where(
                                    RedundancyPolicySet.task_id == task_id_,
                                    RedundancyPolicySet.set_number.in_(set_numbers),
                                )
                            )
                for chunk in _chunked(ids_to_delete, _SQLITE_IN_CHUNK):
                    await db.execute(delete(model).where(model.id.in_(chunk)))
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_sync_tasks_chunking.py -v
```

Expected: 3개 모두 PASS.

- [ ] **Step 5: 전체 회귀 확인 + 임포트 확인**

```bash
cd backend && ../.venv/bin/python -m pytest -v
../.venv/bin/python -c "from app.services.sync import tasks; print('import ok')"
```

Expected: 전체 테스트 PASS, import 에러 없음.

**참고:** `sync/tasks.py`의 동기화 파이프라인 전체(수집→변환→DB 반영)에 대한 통합 테스트는 이번 범위 밖이다 (DB 픽스처, 가짜 collector 등 인프라가 필요 — 로드맵 항목 6에서 다룰 성격). 이번 수정은 청킹 헬퍼의 순수 로직만 단위 테스트하고, 나머지는 코드 리뷰로 검증한다: 청크 단위로 순차 `delete()`를 여러 번 실행하는 것은 한 번에 실행하는 것과 최종 결과가 동일하다 (같은 트랜잭션 내에서 대상 집합을 N개로 쪼개 순서대로 지우는 것뿐).

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/sync/tasks.py backend/tests/test_sync_tasks_chunking.py
git commit -m "$(cat <<'EOF'
fix: 동기화 삭제 처리에 SQLite IN절 청킹 적용 (대량 삭제 시 동기화 실패 방지)

policy_indexer.py가 이미 쓰던 청킹 컨벤션이 sync/tasks.py에는 빠져 있어
800개 이상 정책이 한 번에 삭제되는 재동기화에서 SQLite 바인딩 변수
한도 초과로 태스크 전체가 실패할 수 있었다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 프론트엔드 — ErrorBoundary를 라우트(페이지) 단위로 격리

**Files:**
- Modify: `frontend/src/components/layout/AppLayout.tsx`

**배경:** `ErrorBoundary.tsx`의 주석과 `CLAUDE.md`는 "라우트 레벨 `ErrorBoundary`"라고 문서화하지만, 실제로는 `App.tsx`에서 `<Routes>` 전체(로그인 페이지, `AppLayout`의 네비게이션 포함)를 단 하나의 `ErrorBoundary`로 감싸고 있다. 페이지 하나에서 렌더 예외가 나면 네비게이션까지 포함한 화면 전체가 폴백 UI로 바뀌어, 사용자가 다른 메뉴로 이동해 우회할 방법 없이 강제 새로고침해야 한다. `ErrorBoundary`의 폴백 UI 자체는 `min-h-[60vh]`짜리 컨테이너라 전체 화면을 채우지 않으므로, `<Outlet />` 주위로 옮기면 자연스럽게 `Navbar` 아래 콘텐츠 영역에만 표시된다.

- [ ] **Step 1: `AppLayout.tsx` 수정**

`frontend/src/components/layout/AppLayout.tsx`의 기존:

```tsx
import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-ds-surface text-ds-on-surface">
      <div className="fixed top-0 inset-x-0 z-50 h-13">
        <Navbar />
      </div>
      <main className="mt-13">
        <div className="px-4 py-4 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
```

를 다음으로 교체:

```tsx
import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-ds-surface text-ds-on-surface">
      <div className="fixed top-0 inset-x-0 z-50 h-13">
        <Navbar />
      </div>
      <main className="mt-13">
        <div className="px-4 py-4 md:px-8 md:py-8">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
```

`App.tsx`의 최상위 `ErrorBoundary`(로그인 페이지 등 `AppLayout` 바깥 영역을 위한 안전망)는 그대로 둔다 — 제거하지 않는다.

- [ ] **Step 2: 타입체크 + 린트**

```bash
cd frontend && npm run lint && npx tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 빌드 확인**

```bash
cd frontend && npm run build
```

Expected: 정상 빌드 완료.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/layout/AppLayout.tsx
git commit -m "$(cat <<'EOF'
fix: ErrorBoundary를 AppLayout Outlet 단위로 옮겨 실제 라우트 레벨 격리로 수정

기존엔 App.tsx의 Routes 전체를 하나의 ErrorBoundary로 감싸고 있어
페이지 하나의 렌더 에러로 네비게이션까지 포함한 화면 전체가 멈췄다.
ErrorBoundary.tsx 주석/CLAUDE.md가 말하는 "라우트 레벨" 동작과
실제 구현을 일치시킴.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 조사 결과 5건 중 심각도 높은 2건(백엔드 청킹, 프론트 ErrorBoundary 범위)을 Task 1·2가 커버. 나머지 3건은 로드맵 백로그로 명시적으로 이월.
- **플레이스홀더 스캔**: 없음.
- **타입 일관성**: `_chunked(items, size)` 시그니처가 테스트와 구현에서 일치.
- **의도적으로 하지 않은 것**: `sync/tasks.py` 전체 파이프라인 통합 테스트, `ErrorBoundary.tsx` 컴포넌트 자체 수정 — 둘 다 이번 수정 범위를 벗어남.
