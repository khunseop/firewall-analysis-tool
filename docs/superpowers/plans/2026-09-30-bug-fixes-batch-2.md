# 자잘한 버그 수정 2차분 (백로그 4건) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 항목 8 1차 조사에서 백로그로 남겨뒀던 심각도 낮음~중간 4건을 처리한다: (1) 설정 파싱 실패 무음 처리, (2) tzinfo 변환 실패 무음 폴백, (3) `get_kst_now()` 3중 중복, (4) 프론트 쿼리키 하드코딩.

**Architecture:** 4건 모두 독립적인 작은 수정이다. (1)(2)는 기존 `except Exception: pass`에 로그 한 줄을 추가하는 것으로 끝난다. (3)은 새 공유 유틸 `app/core/time_utils.py`를 만들어 3곳의 중복 정의를 이 함수를 쓰도록 교체한다. (4)는 `queryKeys.ts` 팩토리에 항목을 추가하고 `ObjectGapPanel.tsx`가 이를 쓰도록 바꾼다.

**Tech Stack:** 기존 스택 그대로 — 새 의존성 없음.

**Spec:** `docs/superpowers/plans/2026-09-30-production-readiness-roadmap.md` (항목 8, "발견된 추가 이슈 > 항목 8 1차 조사 결과 > 백로그")

## Global Constraints

- 각 수정은 동작을 바꾸지 않는다 (로그 추가, 중복 제거, 쿼리키 이동은 모두 순수 리팩터/가시성 개선이지 기능 변경이 아니다).
- `get_kst_now()` 통합 시 호출부의 반환값(naive datetime, Asia/Seoul 기준)은 정확히 동일해야 한다.

---

## File Structure

- Modify: `backend/app/api/api_v1/endpoints/settings.py` — 설정 파싱 실패 로그 추가.
- Modify: `backend/app/crud/crud_policy.py` — tzinfo 변환 실패 로그 추가.
- Create: `backend/app/core/time_utils.py` — 공유 `get_kst_now()`.
- Test: `backend/tests/test_time_utils.py`
- Modify: `backend/app/services/analysis/tasks.py`, `backend/app/services/deletion_workflow/tasks.py`, `backend/app/api/api_v1/endpoints/deletion_workflow.py` — 로컬 정의 제거하고 공유 유틸 사용.
- Modify: `frontend/src/api/queryKeys.ts` — `policyBuilderObjectGaps` 팩토리 추가.
- Modify: `frontend/src/components/pages/policy-builder/ObjectGapPanel.tsx` — 하드코딩된 쿼리키를 팩토리로 교체.

---

### Task 1: 설정 파싱 실패 로그 추가

**Files:**
- Modify: `backend/app/api/api_v1/endpoints/settings.py`

`backend/app/api/api_v1/endpoints/settings.py`의 `get_deletion_workflow_config`(약 210번 줄 부근) 기존:

```python
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting:
        try:
            stored = json.loads(setting.value)
            return _deep_merge(_default_config(), stored)
        except Exception:
            pass
    return _load_fpat_yaml()
```

를 다음으로 교체 (파일 상단에 이미 `logger = logging.getLogger(__name__)`가 정의되어 있음):

```python
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting:
        try:
            stored = json.loads(setting.value)
            return _deep_merge(_default_config(), stored)
        except Exception:
            logger.exception(
                "삭제 워크플로우 설정 파싱 실패 (key=%s) — fpat.yaml 기본값으로 폴백", _SETTINGS_KEY
            )
    return _load_fpat_yaml()
```

- [ ] **Step 1: 위 교체 적용**
- [ ] **Step 2: 임포트 확인**

```bash
cd backend && ../.venv/bin/python -c "from app.api.api_v1.endpoints import settings; print('import ok')"
```

Expected: `import ok`.

- [ ] **Step 3: 커밋**

```bash
git add backend/app/api/api_v1/endpoints/settings.py
git commit -m "$(cat <<'EOF'
fix: 삭제 워크플로우 설정 파싱 실패 시 로그 남기도록 수정

기존엔 except Exception: pass로 조용히 기본값 폴백해, 저장된 설정이
깨져도 왜 반영 안 되는지 디버깅이 불가능했다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: tzinfo 변환 실패 로그 추가

**Files:**
- Modify: `backend/app/crud/crud_policy.py`

`backend/app/crud/crud_policy.py` 상단 import 블록:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func, or_, and_
from sqlalchemy.sql import exists
from sqlalchemy.sql.elements import ClauseElement

from app.models.policy import Policy
from app.schemas.policy import PolicyCreate, FilterLeafNode, FilterGroupNode, FilterExprNode
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Union, Optional

from app import models, schemas
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric
```

를 다음으로 교체 (`import logging`과 모듈 로거 추가):

```python
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func, or_, and_
from sqlalchemy.sql import exists
from sqlalchemy.sql.elements import ClauseElement

from app.models.policy import Policy
from app.schemas.policy import PolicyCreate, FilterLeafNode, FilterGroupNode, FilterExprNode
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Union, Optional

from app import models, schemas
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric

logger = logging.getLogger(__name__)
```

같은 파일의 `_naive_seoul` 헬퍼 기존:

```python
    def _naive_seoul(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            try:
                dt = dt.astimezone(ZoneInfo("Asia/Seoul"))
            except Exception:
                pass
            dt = dt.replace(tzinfo=None)
        return dt
```

를 다음으로 교체:

```python
    def _naive_seoul(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            try:
                dt = dt.astimezone(ZoneInfo("Asia/Seoul"))
            except Exception:
                logger.exception(
                    "last_hit_date 필터: tzinfo 변환 실패 — 원본 tzinfo 그대로 naive 처리 (%r)", dt
                )
            dt = dt.replace(tzinfo=None)
        return dt
```

- [ ] **Step 1: 위 교체 두 곳 적용**
- [ ] **Step 2: 회귀 확인**

```bash
cd backend && ../.venv/bin/python -m pytest -v 2>&1 | tail -5
../.venv/bin/python -c "from app.crud import crud_policy; print('import ok')"
```

Expected: 기존 테스트 전부 PASS, import 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add backend/app/crud/crud_policy.py
git commit -m "$(cat <<'EOF'
fix: last_hit_date 필터 tzinfo 변환 실패 시 로그 남기도록 수정

astimezone 실패는 실무에서 거의 안 일어나지만, 발생하면 검색 결과가
조용히 몇 시간 어긋날 수 있어 최소한 로그로 추적 가능하게 함.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `get_kst_now()` 공유 유틸로 통합

**Files:**
- Create: `backend/app/core/time_utils.py`
- Test: `backend/tests/test_time_utils.py`
- Modify: `backend/app/services/analysis/tasks.py`
- Modify: `backend/app/services/deletion_workflow/tasks.py`
- Modify: `backend/app/api/api_v1/endpoints/deletion_workflow.py`

**Interfaces:**
- Produces: `get_kst_now() -> datetime` (naive, Asia/Seoul 기준 현재 시각) — `app/core/time_utils.py`.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_time_utils.py`:

```python
from datetime import datetime

from app.core.time_utils import get_kst_now


def test_get_kst_now_returns_naive_datetime():
    result = get_kst_now()
    assert isinstance(result, datetime)
    assert result.tzinfo is None


def test_get_kst_now_is_close_to_utc_plus_9():
    from datetime import timezone

    result = get_kst_now()
    utc_now = datetime.now(timezone.utc).replace(tzinfo=None)
    # KST = UTC+9. 두 시각의 차이가 9시간에 근접해야 한다 (테스트 실행 지연 감안 오차 허용).
    delta_hours = (result - utc_now).total_seconds() / 3600
    assert 8.9 <= delta_hours <= 9.1
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_time_utils.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.core.time_utils'`.

- [ ] **Step 3: 공유 유틸 구현**

`backend/app/core/time_utils.py`:

```python
"""한국 시간(KST) 관련 공유 유틸.

app/services/analysis/tasks.py, app/services/deletion_workflow/tasks.py,
app/api/api_v1/endpoints/deletion_workflow.py 세 곳에 동일 로직이
복붙되어 있던 것을 이 모듈로 통합했다.
"""
from datetime import datetime
from zoneinfo import ZoneInfo


def get_kst_now() -> datetime:
    """한국 시간(KST) 현재 시간을 naive datetime으로 반환한다."""
    return datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_time_utils.py -v
```

Expected: 2개 모두 PASS.

- [ ] **Step 5: `app/services/analysis/tasks.py`에서 로컬 정의 제거**

기존:

```python
import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo
from typing import List, Optional
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

def get_kst_now():
    """한국 시간(KST) 현재 시간 반환"""
    return datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
```

를 다음으로 교체 (`get_kst_now` 정의를 지우고 공유 유틸 임포트로 대체 — 나머지 30여 개 호출부 `get_kst_now()`는 이름이 동일하므로 수정 불필요):

```python
import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo
from typing import List, Optional
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import get_kst_now
```

- [ ] **Step 6: `app/services/deletion_workflow/tasks.py`에서 로컬 정의 제거**

기존:

```python
from app.services.deletion_workflow.task_meta import TASK_META

logger = logging.getLogger(__name__)


def get_kst_now():
    """한국 시간(KST) 현재 시간 반환"""
    return datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
```

를 다음으로 교체:

```python
from app.core.time_utils import get_kst_now
from app.services.deletion_workflow.task_meta import TASK_META

logger = logging.getLogger(__name__)
```

- [ ] **Step 7: `app/api/api_v1/endpoints/deletion_workflow.py`에서 로컬 정의를 공유 유틸 호출로 교체**

이 파일은 `import datetime`(모듈 전체 임포트) 스타일이라 다른 두 파일과 반환 타입 표기(`datetime.datetime`)만 다를 뿐 로직은 동일하다. 기존:

```python
from app.services.deletion_workflow.config_bridge import load_config_dict


def _kst_now() -> datetime.datetime:
    return datetime.datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
```

를 다음으로 교체 (`_kst_now`라는 이름을 그대로 유지해 호출부 수정을 피하고, 내부만 공유 유틸에 위임):

```python
from app.services.deletion_workflow.config_bridge import load_config_dict
from app.core.time_utils import get_kst_now


def _kst_now() -> datetime.datetime:
    return get_kst_now()
```

- [ ] **Step 8: 전체 회귀 확인**

```bash
cd backend && ../.venv/bin/python -m pytest -v 2>&1 | tail -10
../.venv/bin/python -c "
from app.services.analysis import tasks as analysis_tasks
from app.services.deletion_workflow import tasks as dw_tasks
from app.api.api_v1.endpoints import deletion_workflow
print('imports ok')
print(analysis_tasks.get_kst_now())
print(dw_tasks.get_kst_now())
print(deletion_workflow._kst_now())
"
```

Expected: 테스트 전부 PASS, 세 호출 모두 비슷한 (동일 초 단위) KST naive datetime 출력.

- [ ] **Step 9: 커밋**

```bash
git add backend/app/core/time_utils.py backend/tests/test_time_utils.py backend/app/services/analysis/tasks.py backend/app/services/deletion_workflow/tasks.py backend/app/api/api_v1/endpoints/deletion_workflow.py
git commit -m "$(cat <<'EOF'
refactor: get_kst_now() 3중 중복 구현을 app/core/time_utils.py로 통합

analysis/tasks.py, deletion_workflow/tasks.py, deletion_workflow.py
엔드포인트 세 곳에 동일 로직이 복붙되어 있어, 한 곳만 고치면 나머지와
조용히 불일치할 구조적 위험이 있었다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 프론트엔드 — `ObjectGapPanel.tsx` 쿼리키를 팩토리로 이동

**Files:**
- Modify: `frontend/src/api/queryKeys.ts`
- Modify: `frontend/src/components/pages/policy-builder/ObjectGapPanel.tsx`

**Interfaces:**
- Produces: `queryKeys.policyBuilderObjectGaps(deviceId, rows)` — `frontend/src/api/queryKeys.ts`.

- [ ] **Step 1: `queryKeys.ts`에 항목 추가**

`frontend/src/api/queryKeys.ts`의 기존:

```typescript
  policyBuilderPreviewOrder: (deviceId: number | null | undefined) => ['policy-builder-preview-order', deviceId] as const,
  policyBuilderPendingChanges: (deviceId: number | null | undefined) => ['policy-builder-pending-changes', deviceId] as const,
```

를 다음으로 교체 (한 줄 추가, 기존 두 줄은 그대로):

```typescript
  policyBuilderPreviewOrder: (deviceId: number | null | undefined) => ['policy-builder-preview-order', deviceId] as const,
  policyBuilderPendingChanges: (deviceId: number | null | undefined) => ['policy-builder-pending-changes', deviceId] as const,
  policyBuilderObjectGaps: (deviceId: number | null, rows: unknown) => ['policy-builder-object-gaps', deviceId, rows] as const,
```

- [ ] **Step 2: `ObjectGapPanel.tsx`가 팩토리를 쓰도록 수정**

`frontend/src/components/pages/policy-builder/ObjectGapPanel.tsx`의 import 블록:

```tsx
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkObjectGaps, type NewObjectSpec, type NewPolicyRow } from '@/api/policyBuilder'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
```

를 다음으로 교체 (import 한 줄 추가):

```tsx
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkObjectGaps, type NewObjectSpec, type NewPolicyRow } from '@/api/policyBuilder'
import { queryKeys } from '@/api/queryKeys'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
```

같은 파일의 기존:

```tsx
  const { data: missing = [], isFetching } = useQuery({
    queryKey: ['policy-builder-object-gaps', deviceId, rows],
    queryFn: () => checkObjectGaps(deviceId!, rows),
    enabled: !!deviceId && rows.length > 0,
    staleTime: 0,
  })
```

를 다음으로 교체:

```tsx
  const { data: missing = [], isFetching } = useQuery({
    queryKey: queryKeys.policyBuilderObjectGaps(deviceId, rows),
    queryFn: () => checkObjectGaps(deviceId!, rows),
    enabled: !!deviceId && rows.length > 0,
    staleTime: 0,
  })
```

- [ ] **Step 3: 타입체크 + 린트 + 빌드**

```bash
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```

Expected: 전부 에러 없이 통과.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/api/queryKeys.ts frontend/src/components/pages/policy-builder/ObjectGapPanel.tsx
git commit -m "$(cat <<'EOF'
fix: ObjectGapPanel의 하드코딩된 쿼리키를 queryKeys.ts 팩토리로 이동

CLAUDE.md 컨벤션(쿼리키는 반드시 팩토리 사용)을 따르지 않던 유일한
곳이었다. staleTime: 0이라 실질적 캐시 문제는 없었지만 일관성을 맞춤.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 백로그 4건 모두 Task 1~4로 커버.
- **플레이스홀더 스캔**: 없음.
- **타입 일관성**: `get_kst_now() -> datetime`이 Task 3의 정의·세 호출부에서 동일. `queryKeys.policyBuilderObjectGaps` 시그니처가 Task 4 정의·사용처에서 일치.
- **주의**: Task 3에서 `deletion_workflow.py`의 `_kst_now`라는 이름은 의도적으로 유지했다 — 이 파일 안에서만 쓰이는 private 헬퍼라 이름을 바꿀 필요가 없고, 바꾸면 불필요한 diff가 커진다.
