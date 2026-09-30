# 핵심 모듈(파서/인덱서/삭제 워크플로우) 테스트 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로드맵 항목 6 — 회귀에 취약하고 자동 검증이 전혀 없던 핵심 순수 로직 3곳(IP/포트 파싱, 그룹 재귀 확장 인덱서, 삭제 워크플로우 신청정보 파서)에 단위 테스트를 추가한다.

**Architecture:** 세 모듈 모두 DB나 네트워크 I/O 없이 동작하는 순수 함수/메서드를 갖고 있어, 픽스처 인프라(가짜 DB, mock collector 등) 없이 곧바로 단위 테스트가 가능하다. `Resolver.pre_resolve_objects`는 SQLAlchemy 모델 대신 `types.SimpleNamespace`로 흉내 낸 객체를 넣어 테스트한다 (속성 접근만 하고 타입 체크를 하지 않는 duck-typed 코드라 가능).

**Tech Stack:** 기존 스택 그대로 — 새 의존성 없음.

**Spec:** `docs/superpowers/plans/2026-09-30-production-readiness-roadmap.md` (항목 6)

## Global Constraints

- 프로덕션 코드는 수정하지 않는다 — 순수 테스트 추가만 한다 (이번 계획은 리팩터링이나 버그 수정을 포함하지 않는다).
- `RequestParser` 테스트에 쓰는 정규식 패턴은 실제 운영 패턴이 아닌 합성(synthetic) 패턴이다 — 그룹 추출·타입 매핑·날짜 변환 등 조립 로직만 검증하는 목적이며, 테스트 코드에 그 사실을 주석으로 명시한다.

---

## File Structure

- Test: `backend/tests/test_normalize.py` — 파서 (IP/포트 숫자 범위 변환).
- Test: `backend/tests/test_policy_indexer_resolver.py` — 인덱서 (그룹 재귀 확장 Resolver).
- Test: `backend/tests/test_request_parser.py` — 삭제 워크플로우 (신청정보 파싱 프로세서).

---

### Task 1: 파서 — `app/services/normalize.py`

**Files:**
- Test: `backend/tests/test_normalize.py`

`app/services/normalize.py`는 `policy_indexer`(인덱싱)와 범위 기반 검색(`crud_policy.py`)이 공유하는 IP/포트 파싱 함수다. 지금까지 자동 테스트가 전혀 없었다.

- [ ] **Step 1: 테스트 작성**

`backend/tests/test_normalize.py`:

```python
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric


def test_parse_ipv4_numeric_any_returns_full_range():
    assert parse_ipv4_numeric("any") == (4, 0, (2 ** 32) - 1)
    assert parse_ipv4_numeric("ANY") == (4, 0, (2 ** 32) - 1)


def test_parse_ipv4_numeric_single_ip():
    version, start, end = parse_ipv4_numeric("10.0.0.1")
    assert version == 4
    assert start == end


def test_parse_ipv4_numeric_cidr():
    version, start, end = parse_ipv4_numeric("10.0.0.0/24")
    assert version == 4
    assert end - start == 255


def test_parse_ipv4_numeric_dash_range():
    version, start, end = parse_ipv4_numeric("10.0.0.1-10.0.0.5")
    assert version == 4
    assert end - start == 4


def test_parse_ipv4_numeric_fqdn_returns_none():
    assert parse_ipv4_numeric("firewall.example.com") == (None, None, None)


def test_parse_ipv4_numeric_ipv6_returns_none():
    assert parse_ipv4_numeric("::1") == (None, None, None)


def test_parse_ipv4_numeric_empty_returns_none():
    assert parse_ipv4_numeric("") == (None, None, None)


def test_parse_ipv4_numeric_garbage_returns_none():
    assert parse_ipv4_numeric("not-an-ip!!") == (None, None, None)


def test_parse_port_numeric_any_variants():
    assert parse_port_numeric("any") == (0, 65535)
    assert parse_port_numeric("*") == (0, 65535)
    assert parse_port_numeric("ANY") == (0, 65535)


def test_parse_port_numeric_single_port():
    assert parse_port_numeric("443") == (443, 443)


def test_parse_port_numeric_range():
    assert parse_port_numeric("8000-9000") == (8000, 9000)


def test_parse_port_numeric_comma_separated_returns_none():
    assert parse_port_numeric("80,443") == (None, None)


def test_parse_port_numeric_empty_returns_none():
    assert parse_port_numeric("") == (None, None)


def test_parse_port_numeric_garbage_returns_none():
    assert parse_port_numeric("abc") == (None, None)
```

- [ ] **Step 2: 테스트 실행 → 통과 확인 (이미 존재하는 코드라 바로 통과해야 함)**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_normalize.py -v
```

Expected: 13개 모두 PASS. 하나라도 FAIL하면 테스트 자체가 실제 함수 동작과 다르게 작성된 것이니 `app/services/normalize.py`를 다시 읽고 테스트를 고친다 (프로덕션 코드를 고치지 않는다 — 이 Task는 기존 동작을 문서화하는 것이 목적).

- [ ] **Step 3: 커밋**

```bash
git add backend/tests/test_normalize.py
git commit -m "$(cat <<'EOF'
test: normalize.py의 IP/포트 파싱 함수 단위 테스트 추가

policy_indexer와 범위 기반 검색이 공유하는 핵심 파서인데 자동 테스트가
전혀 없었다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 인덱서 — `app/services/policy_indexer.py`의 `Resolver`

**Files:**
- Test: `backend/tests/test_policy_indexer_resolver.py`

`Resolver.pre_resolve_objects`는 CLAUDE.md가 "DFS 기반 그룹 재귀 확장"이라고 설명하는 핵심 로직이다. 순환 참조 가드가 있는데 이를 검증하는 테스트가 없었다.

- [ ] **Step 1: 테스트 작성**

`backend/tests/test_policy_indexer_resolver.py`:

```python
from types import SimpleNamespace as NS

from app.services.policy_indexer import Resolver


def test_simple_group_expands_to_member_values():
    net_objects = [
        NS(name="H1", ip_address="10.0.0.1"),
        NS(name="H2", ip_address="10.0.0.2"),
    ]
    net_groups = [NS(name="G1", members="H1,H2")]

    resolver = Resolver()
    addr_map, _ = resolver.pre_resolve_objects(net_objects, net_groups, [], [])

    assert addr_map["G1"] == {"10.0.0.1", "10.0.0.2"}
    assert addr_map["H1"] == {"10.0.0.1"}


def test_nested_group_expands_recursively():
    net_objects = [
        NS(name="H1", ip_address="10.0.0.1"),
        NS(name="H2", ip_address="10.0.0.2"),
    ]
    # G2는 G1(그룹)과 H3(존재하지 않는 객체)을 멤버로 갖는다.
    net_groups = [
        NS(name="G1", members="H1,H2"),
        NS(name="G2", members="G1,H3"),
    ]

    resolver = Resolver()
    addr_map, _ = resolver.pre_resolve_objects(net_objects, net_groups, [], [])

    # G1의 확장값 + 존재하지 않는 H3은 리터럴 이름 그대로 폴백
    assert addr_map["G2"] == {"10.0.0.1", "10.0.0.2", "H3"}


def test_empty_group_gets_marker_value():
    net_groups = [NS(name="EMPTY", members="")]

    resolver = Resolver()
    addr_map, _ = resolver.pre_resolve_objects([], net_groups, [], [])

    assert addr_map["EMPTY"] == {"__GROUP__:EMPTY"}


def test_circular_group_reference_terminates_without_error():
    # A -> B -> A 순환 참조. 무한 재귀 없이 종료해야 한다.
    net_groups = [
        NS(name="A", members="B"),
        NS(name="B", members="A"),
    ]

    resolver = Resolver()
    addr_map, _ = resolver.pre_resolve_objects([], net_groups, [], [])

    assert set(addr_map.keys()) == {"A", "B"}
    # 순환 참조 시 두 그룹 모두 같은 폴백 값(둘 중 하나의 이름) 하나로 수렴한다.
    assert addr_map["A"] == addr_map["B"]
    assert len(addr_map["A"]) == 1
    assert next(iter(addr_map["A"])) in {"A", "B"}


def test_service_group_expands_protocol_port_values():
    svc_objects = [NS(name="S1", protocol="tcp", port="80")]
    svc_groups = [NS(name="SG1", members="S1")]

    resolver = Resolver()
    _, svc_map = resolver.pre_resolve_objects([], [], svc_objects, svc_groups)

    assert svc_map["SG1"] == {"tcp/80"}
    assert svc_map["S1"] == {"tcp/80"}
```

- [ ] **Step 2: 테스트 실행 → 통과 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_policy_indexer_resolver.py -v
```

Expected: 5개 모두 PASS. FAIL하면 (특히 순환 참조 테스트) `Resolver._expand_groups`의 실제 캐싱/방문 순서 동작을 다시 확인하고 테스트의 기대값을 그 실제 동작에 맞게 수정한다 — 이 Task는 기존 동작을 고정(회귀 방지)하는 것이 목적이지, 동작을 바꾸는 것이 아니다.

- [ ] **Step 3: 커밋**

```bash
git add backend/tests/test_policy_indexer_resolver.py
git commit -m "$(cat <<'EOF'
test: policy_indexer.py의 Resolver 그룹 재귀 확장 단위 테스트 추가

중첩 그룹 확장, 빈 그룹 마커, 순환 참조 가드를 커버 — 지금까지
자동 테스트가 없던 핵심 인덱싱 로직.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 삭제 워크플로우 — `RequestParser` 신청정보 파싱

**Files:**
- Test: `backend/tests/test_request_parser.py`

CLAUDE.md는 "과거 FPAT 이관 작업 중 예외처리·신청유형 제한 로직이 유실되었다가 나중에 복원된 사례 있음"이라고 명시한다 — 바로 이 영역(신청정보 파싱)이 그런 이관 버그가 나기 쉬운 곳이다. `RequestParser.parse_request_info`/`convert_to_date`는 순수 함수에 가깝고(`self.config.get(...)`만 참조), `ConfigManager(config_dict=...)`로 파일 없이 바로 생성할 수 있어 테스트가 쉽다.

- [ ] **Step 1: 테스트 작성**

`backend/tests/test_request_parser.py`:

```python
from app.services.deletion_workflow.core.config_manager import ConfigManager
from app.services.deletion_workflow.processors.request_parser import RequestParser

# 아래 정규식은 실제 운영 패턴이 아니라, group 추출 → 필드 매핑 → 타입 코드 변환
# 조립 로직만 검증하기 위한 합성(synthetic) 패턴이다.
_SYNTHETIC_PATTERN = r"^RS(\d+)_(\d{8})_(\d{8})_(\w+)_([A-Za-z0-9v-]+)(?:_(\d+))?$"


def _parser(pattern: str | None = None) -> RequestParser:
    config_dict = {}
    if pattern is not None:
        config_dict = {
            "policy_processing": {
                "request_parsing": {"gsams_3_pattern": pattern}
            }
        }
    return RequestParser(ConfigManager(config_dict=config_dict))


def test_convert_to_date_valid_format():
    assert _parser().convert_to_date("20240101") == "2024-01-01"


def test_convert_to_date_invalid_format_returns_unchanged():
    assert _parser().convert_to_date("not-a-date") == "not-a-date"


def test_parse_request_info_returns_unknown_default_when_no_patterns_configured():
    result = _parser().parse_request_info("any-rule", "any description")
    assert result["Request Type"] == "Unknown"
    assert result["Request ID"] is None


def test_parse_request_info_returns_default_for_null_description():
    result = _parser().parse_request_info("any-rule", None)
    assert result["Request Type"] == "Unknown"


def test_parse_request_info_extracts_fields_and_maps_type_code():
    parser = _parser(_SYNTHETIC_PATTERN)

    result = parser.parse_request_info("rule-1", "RS100_20240101_20241231_alice_F123_5555")

    assert result["Ruleset ID"] == "100"
    assert result["Start Date"] == "2024-01-01"
    assert result["End Date"] == "2024-12-31"
    assert result["Request User"] == "alice"
    assert result["Request ID"] == "F123"
    assert result["Request Type"] == "GENERAL"
    assert result["MIS ID"] == "5555"


def test_parse_request_info_unknown_type_code_maps_to_unknown():
    parser = _parser(_SYNTHETIC_PATTERN)

    result = parser.parse_request_info("rule-1", "RS100_20240101_20241231_alice_Z999")

    assert result["Request Type"] == "Unknown"


def test_parse_request_info_truncates_after_version_marker():
    parser = _parser(r"^RS(\d+)_(\d{8})_(\d{8})_(\w+)_([A-Za-z0-9v-]+)$")

    result = parser.parse_request_info("rule-1", "RS100_20240101_20241231_alice_P1v2-99-88")

    # "v"가 포함된 Request ID는 첫 두 '-' 구간만 남기고 잘린다.
    assert result["Request ID"] == "P1v2-99"
    assert result["Request Type"] == "GROUP"  # type_code "P"
```

- [ ] **Step 2: 테스트 실행 → 통과 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_request_parser.py -v
```

Expected: 7개 모두 PASS. FAIL하면 `parse_request_info`의 실제 그룹 인덱스/조립 순서를 다시 확인하고 테스트를 그 실제 동작에 맞춘다 (이 Task는 회귀 방지 목적이며 동작 변경이 아니다).

- [ ] **Step 3: 커밋**

```bash
git add backend/tests/test_request_parser.py
git commit -m "$(cat <<'EOF'
test: 삭제 워크플로우 RequestParser 신청정보 파싱 단위 테스트 추가

날짜 변환, 기본값 폴백, GSAMS 스타일 패턴 매칭 시 그룹 추출/타입
코드 매핑/버전 마커 처리 로직을 합성 패턴으로 커버.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 전체 회귀 확인

- [ ] **Step 1: 전체 테스트 스위트 실행**

```bash
cd backend && ../.venv/bin/python -m pytest -v 2>&1 | tail -20
```

Expected: 이번 계획에서 추가한 25개(13+5+7) + 기존 19개 = 44개 전부 PASS.

---

## Self-Review 메모

- **스펙 커버리지**: 로드맵 항목 6이 요구하는 "파서/인덱서/삭제 워크플로우" 세 카테고리를 Task 1~3이 각각 커버.
- **플레이스홀더 스캔**: 없음.
- **주의**: 이 계획은 프로덕션 코드를 전혀 바꾸지 않는다 — 테스트 실행 중 실패가 나오면 (버그를 고치는 게 아니라) 테스트의 기대값을 실제 코드 동작에 맞게 수정하는 것이 원칙이다. 만약 테스트 작성 중 실제 버그로 보이는 동작을 발견하면, 고치지 말고 로드맵의 "발견된 추가 이슈"에 기록만 하고 사용자에게 보고한다.
