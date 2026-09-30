# Policy Builder 실제 장비 검증 — "활성여부" 오탐 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Policies 편집모드(Policy Builder)에서 "실제 장비 검증"을 실행하면 실제 값이 같아도 `enable`(활성여부) 필드가 항상 불일치로 표시되는 버그를 고친다.

**Architecture:** `verify_pending_changes_against_candidate`는 계획된 정책 행(`row`, DB `Policy.enable` = Python `bool`/`None`)과 장비에서 방금 조회한 candidate 정책 행(`candidate_row`, Palo Alto 파서가 만드는 `enable` = 문자열 `"Y"`/`"N"`)을 비교한다. 두 값을 그냥 `str()`로 캐스팅해서 비교하면 `str(True)`(`"True"`)와 `"Y"`가 절대 같을 수 없어 `enable` 필드가 실제 값과 무관하게 항상 불일치로 뜬다. 필드별 값을 비교 전에 정규화하는 순수 함수를 추가해 이 형식 차이를 흡수한다.

**Tech Stack:** 기존 스택 그대로 — 새 의존성 없음.

**Spec:** 사용자 보고 — "Policies 편집모드에서 실제장비 검증할 때, 활성여부 값이 running과 candidate가 달라서 무조건 문제있는거로 표시됨"

## Global Constraints

- `enable` 이외의 `DIFF_FIELDS`(action/source/destination/service/description/user/application/security_profile/category)는 이미 양쪽 다 문자열이라 정규화가 필요 없다 — `enable`만 처리한다.
- `app/services/live_policy_diff.py`의 `get_live_running_candidate_diff`(실시간 running/candidate 비교, 양쪽 다 같은 파서를 쓰므로 이미 둘 다 `"Y"`/`"N"` 문자열)는 이 버그가 없다 — 건드리지 않는다.

---

## File Structure

- Modify: `backend/app/services/policy_builder/live_verify.py` — 필드 정규화 헬퍼 추가 + 비교 루프에 적용.
- Test: `backend/tests/test_live_verify.py`

---

### Task 1: `enable` 필드 정규화 + 단위 테스트

**Files:**
- Modify: `backend/app/services/policy_builder/live_verify.py`
- Test: `backend/tests/test_live_verify.py`

**Interfaces:**
- Produces: `_normalize_diff_value(field: str, value: Any) -> str` (module-private 헬퍼).

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_live_verify.py`:

```python
from app.services.policy_builder.live_verify import _normalize_diff_value


def test_enable_true_normalizes_to_Y():
    assert _normalize_diff_value("enable", True) == "Y"


def test_enable_false_normalizes_to_N():
    assert _normalize_diff_value("enable", False) == "N"


def test_enable_already_string_passthrough():
    # candidate_row 쪽은 이미 "Y"/"N" 문자열이라 그대로 통과해야 한다.
    assert _normalize_diff_value("enable", "Y") == "Y"
    assert _normalize_diff_value("enable", "N") == "N"


def test_enable_none_becomes_empty_string():
    assert _normalize_diff_value("enable", None) == ""


def test_non_enable_field_falls_back_to_plain_str():
    assert _normalize_diff_value("action", "allow") == "allow"
    assert _normalize_diff_value("action", None) == ""


def test_true_and_Y_are_now_treated_as_equal_after_normalization():
    # 이 테스트가 실제 버그를 재현·고정한다: 정규화 전에는
    # str(True) == "True" != "Y" 라서 항상 불일치로 오판했다.
    assert _normalize_diff_value("enable", True) == _normalize_diff_value("enable", "Y")
    assert _normalize_diff_value("enable", False) == _normalize_diff_value("enable", "N")
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_live_verify.py -v
```

Expected: `ImportError: cannot import name '_normalize_diff_value'`로 전부 실패.

- [ ] **Step 3: 정규화 헬퍼 추가 + 비교 루프에 적용**

`backend/app/services/policy_builder/live_verify.py`의 기존:

```python
        mismatches = []
        for field in DIFF_FIELDS:
            expected = str(row.get(field, "")) if row.get(field) is not None else ""
            actual = str(candidate_row.get(field, "")) if candidate_row.get(field) is not None else ""
            if expected != actual:
                mismatches.append({"field": field, "expected": expected, "actual": actual})
```

를 다음으로 교체:

```python
        mismatches = []
        for field in DIFF_FIELDS:
            expected = _normalize_diff_value(field, row.get(field))
            actual = _normalize_diff_value(field, candidate_row.get(field))
            if expected != actual:
                mismatches.append({"field": field, "expected": expected, "actual": actual})
```

같은 파일 상단, `LiveVerifyError` 클래스 정의 다음에 헬퍼 함수를 추가:

```python
def _normalize_diff_value(field: str, value: Any) -> str:
    """DIFF_FIELDS 비교 전 값을 문자열로 정규화한다.

    계획된 정책 행(row)의 ``enable``은 DB 컬럼(Policy.enable)에서 온
    Python bool/None인 반면, 장비에서 조회한 candidate 행의 ``enable``은
    Palo Alto 파서가 만드는 "Y"/"N" 문자열이다. 그냥 str()로 캐스팅하면
    str(True) == "True" != "Y"라서 실제 값이 같아도 항상 불일치로
    오판하는 버그가 있었다 — 여기서 형식을 맞춘 뒤 비교한다.
    """
    if value is None:
        return ""
    if field == "enable" and isinstance(value, bool):
        return "Y" if value else "N"
    return str(value)
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_live_verify.py -v
```

Expected: 6개 모두 PASS.

- [ ] **Step 5: 전체 회귀 확인**

```bash
cd backend && ../.venv/bin/python -m pytest -v 2>&1 | tail -10
../.venv/bin/python -c "from app.services.policy_builder import live_verify; print('import ok')"
```

Expected: 전체 테스트 PASS, import 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/policy_builder/live_verify.py backend/tests/test_live_verify.py
git commit -m "$(cat <<'EOF'
fix: Policy Builder 실제 장비 검증에서 enable 필드 형식 불일치로 인한 상시 오탐 수정

계획된 정책 행의 enable은 Python bool(DB 컬럼)인 반면 candidate 조회
결과의 enable은 "Y"/"N" 문자열이라, str() 캐스팅만으로 비교하면
str(True) != "Y"가 되어 실제 값이 같아도 항상 불일치로 표시되고
있었다. 사용자 보고로 발견.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 사용자가 보고한 정확한 증상(활성여부가 항상 불일치)을 Task 1이 수정.
- **플레이스홀더 스캔**: 없음.
- **영향 범위 확인**: `DIFF_FIELDS`를 쓰는 또 다른 곳인 `live_policy_diff.py`의 `get_live_running_candidate_diff`는 양쪽 다 같은 파서(`export_security_rules`)를 써서 이미 `"Y"`/`"N"` 문자열끼리 비교하므로 이 버그의 영향을 받지 않는다 — 수정 대상에서 제외했다.
