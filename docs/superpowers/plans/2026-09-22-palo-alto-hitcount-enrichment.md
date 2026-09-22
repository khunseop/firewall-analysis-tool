# Palo Alto SSH 히트카운트 수집 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SSH 기반 정책 히트카운트 수집(`export_last_hit_date_ssh`)에서 `first_hit_date`/
`rule_create_date`/`unused_days`까지 확보해 `policies` 테이블에 영구 저장하고, Devices
페이지 "직접 추출"(사용이력)이 seq 순서로 정렬된 확장 컬럼 엑셀을 내보내도록 한다.

**Architecture:** 파싱(`paloalto.py`) → DB 스키마(`Policy` 모델 + 마이그레이션) → 동기화 병합
(`sync/tasks.py`) → 직접추출 enrichment(`export/tasks.py`)의 4단계 파이프라인. 각 단계는
독립적으로 테스트 가능하다(파싱은 합성 셸 출력으로, 나머지는 DataFrame/DB 픽스처로).

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy(비동기) + Alembic, pandas, paramiko.
프로젝트에 pytest 등 테스트 프레임워크가 설치/구성되어 있지 않으므로(기존 관례), 각 태스크의
검증은 `assert` 기반 standalone 스크립트를 `python3`로 직접 실행하는 방식을 따른다.

**Spec:** `docs/superpowers/specs/2026-09-22-palo-alto-hitcount-enrichment-design.md`

## Global Constraints

- 저장 범위는 `first_hit_date`/`unused_days`/`rule_create_date` 3개뿐이다. Last Reset
  Timestamp/Rule Modify Timestamp/Rule UUID는 저장하지 않는다.
- `미사용여부`(Y/N)는 어디에도 저장하지 않는다. `unused_days`만 저장/노출하고, 판정은
  기존 `deletion_workflow_config`의 `unused_threshold_days`(기본 90)를 읽는 코드가 그때그때
  계산한다 — 이번 변경에서 새로 그 계산 로직을 만들지 않는다.
- SSH 명령 분기(`use_vsys_all_cmd` OS 버전 판단)는 그대로 유지한다. 파싱만 확장한다.
- 확장 정규식이 실패하면 반드시 기존(레거시) 정규식으로 폴백한다 — 구버전 장비 출력 포맷을
  모르는 상태이므로 하위 호환을 깨면 안 된다.
- 신규 DB 컬럼은 전부 nullable. 마이그레이션 후 기존 행은 NULL로 시작해도 정상.
- deletion workflow 쪽 코드(`backend/app/services/deletion_workflow/**`)는 수정하지 않는다.

---

### Task 1: Palo Alto SSH 파싱 확장 (`export_last_hit_date_ssh`)

**Files:**
- Modify: `backend/app/services/firewall/vendors/paloalto.py:477-587`
- Test: `backend/app/services/firewall/vendors/verify_hit_count_parsing.py` (신규, 임시
  검증 스크립트 — pytest 없는 프로젝트 관례에 따름)

**Interfaces:**
- Produces: `export_last_hit_date_ssh(...)`가 반환하는 `pd.DataFrame`에 컬럼
  `vsys, rule_name, hit_count, first_hit_date, last_hit_date, rule_create_date, unused_days`
  (모두 문자열 `'%Y-%m-%d %H:%M:%S'` 또는 `None`, `unused_days`는 `int`). 이후 Task 3/4가
  이 컬럼명을 그대로 소비한다.

- [ ] **Step 1: 검증 스크립트 먼저 작성 (실패 확인용)**

`backend/app/services/firewall/vendors/verify_hit_count_parsing.py` 생성:

```python
"""
export_last_hit_date_ssh()의 정규식 파싱 로직을 합성 셸 출력으로 검증하는 standalone
스크립트. 프로젝트에 pytest가 구성되어 있지 않으므로 `python3 backend/app/services/
firewall/vendors/verify_hit_count_parsing.py`로 직접 실행한다 (테스트 프레임워크 없음).

paloalto.py 내부의 정규식/파싱 함수를 그대로 복붙해서 검증한다(클로저라 임포트 불가).
원본이 바뀌면 이 스크립트도 같이 갱신해야 한다.
"""
import datetime
import re

ts_or_dash = r'(?:[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}|-)'

# --- vsys all 분기 정규식 ---
EXTENDED_ALL = re.compile(
    rf'^(\S+)\s+(\S+)\s+(\d+)\s+({ts_or_dash})\s+({ts_or_dash})\s+({ts_or_dash})\s+({ts_or_dash})'
)
LEGACY_ALL = re.compile(rf'^(\S+)\s+(\S+)\s+(\d+)\s+({ts_or_dash})')

# --- per-vsys(else) 분기 정규식 ---
EXTENDED_PER_VSYS = re.compile(
    rf'^([a-zA-Z0-9/._-]+)\s+(\d+)\s+({ts_or_dash})\s+({ts_or_dash})\s+({ts_or_dash})\s+({ts_or_dash})'
)
LEGACY_PER_VSYS = re.compile(rf'^([a-zA-Z0-9/._-]+)\s+(\d+)\s+({ts_or_dash})')


def parse_timestamp(timestamp_str, rule_name):
    if timestamp_str is None or timestamp_str == '-':
        return None
    normalized_ts = re.sub(r'\s+', ' ', timestamp_str)
    dt_obj = datetime.datetime.strptime(normalized_ts, '%a %b %d %H:%M:%S %Y')
    return dt_obj.strftime('%Y-%m-%d %H:%M:%S')


def compute_unused_days(last_hit_date_str):
    if not last_hit_date_str:
        return 99999
    last_hit_dt = datetime.datetime.strptime(last_hit_date_str, '%Y-%m-%d %H:%M:%S')
    return (datetime.datetime.now() - last_hit_dt).days


# === 시나리오 1: vsys all, 확장 포맷(9컬럼) ===
line_extended = (
    "Allow-Web-Outbound  vsys1  1523  Tue Nov  4 00:50:48 2026  "
    "Mon Jan  5 09:00:00 2026  Wed Jan  1 08:00:00 2025  Wed Jan  1 08:00:00 2025  "
    "Fri Jun 12 14:22:10 2026  a1b2c3d4-e5f6-7890-abcd-ef1234567890"
)
m = EXTENDED_ALL.match(line_extended)
assert m is not None, "확장 포맷(vsys all)이 EXTENDED_ALL에 안 걸림"
rule_name, vsys, hit_count, last_hit, _last_reset, first_hit, rule_create = m.groups()
assert rule_name == "Allow-Web-Outbound"
assert vsys == "vsys1"
assert hit_count == "1523"
assert parse_timestamp(last_hit, rule_name) == "2026-11-04 00:50:48"
assert parse_timestamp(first_hit, rule_name) == "2025-01-01 08:00:00"
assert parse_timestamp(rule_create, rule_name) == "2025-01-01 08:00:00"
assert compute_unused_days(parse_timestamp(last_hit, rule_name)) >= 0
print("OK: vsys all 확장 포맷 파싱")

# === 시나리오 2: vsys all, last_hit이 '-'(미사용) ===
line_dash = (
    "Deny-Legacy-FTP  vsys1  0  -  -  -  Tue Feb 10 11:11:11 2020  -  "
    "0f1e2d3c-4b5a-6978-8899-aabbccddeeff"
)
m = EXTENDED_ALL.match(line_dash)
assert m is not None
rule_name, vsys, hit_count, last_hit, _last_reset, first_hit, rule_create = m.groups()
assert parse_timestamp(last_hit, rule_name) is None
assert parse_timestamp(first_hit, rule_name) is None
assert parse_timestamp(rule_create, rule_name) == "2020-02-10 11:11:11"
assert compute_unused_days(parse_timestamp(last_hit, rule_name)) == 99999
print("OK: vsys all '-' 처리 + unused_days 기본값")

# === 시나리오 3: vsys all, 레거시(구버전, 4컬럼만) 폴백 ===
line_legacy = "Old-Rule  vsys1  42  Tue Nov  4 00:50:48 2026"
m = EXTENDED_ALL.match(line_legacy)
assert m is None, "레거시 포맷인데 확장 정규식에 매치되면 안 됨"
m = LEGACY_ALL.match(line_legacy)
assert m is not None, "레거시 정규식 폴백 실패"
rule_name, vsys, hit_count, last_hit = m.groups()
assert rule_name == "Old-Rule" and hit_count == "42"
print("OK: vsys all 레거시 폴백")

# === 시나리오 4: per-vsys(else) 분기, 확장 포맷 ===
line_per_vsys_ext = (
    "Allow-DNS  98214  Sun Sep 21 23:59:59 2026  -  "
    "Thu Mar  2 03:03:03 2023  Thu Mar  2 03:03:03 2023  -  "
    "11223344-5566-7788-99aa-bbccddeeff00"
)
m = EXTENDED_PER_VSYS.match(line_per_vsys_ext)
assert m is not None
rule_name, hit_count, last_hit, _last_reset, first_hit, rule_create = m.groups()
assert rule_name == "Allow-DNS" and hit_count == "98214"
assert parse_timestamp(first_hit, rule_name) == "2023-03-02 03:03:03"
print("OK: per-vsys 확장 포맷 파싱")

# === 시나리오 5: per-vsys(else) 분기, 레거시(구버전) 폴백 ===
line_per_vsys_legacy = "Old-Rule-2  7  -"
m = EXTENDED_PER_VSYS.match(line_per_vsys_legacy)
assert m is None
m = LEGACY_PER_VSYS.match(line_per_vsys_legacy)
assert m is not None
rule_name, hit_count, last_hit = m.groups()
assert rule_name == "Old-Rule-2" and hit_count == "7"
print("OK: per-vsys 레거시 폴백")

print("\n전부 통과")
```

- [ ] **Step 2: 실행해서 통과하는지 확인 (정규식/헬퍼 함수 자체 검증)**

Run: `python3 backend/app/services/firewall/vendors/verify_hit_count_parsing.py`
Expected: 5개 `OK:` 줄 + `전부 통과` 출력, exit code 0.

이 단계는 정규식/헬퍼 함수 자체를 `paloalto.py`에 넣기 *전에* 독립적으로 검증하는 것이다.
(paloalto.py 안의 로직은 클로저라 직접 import해서 테스트할 수 없으므로, 이 스크립트가
"명세" 역할을 한다 — Step 3에서 이 로직을 그대로 paloalto.py에 옮긴다.)

- [ ] **Step 3: `paloalto.py`에 실제 반영**

`backend/app/services/firewall/vendors/paloalto.py:477-488` (현재 `parse_timestamp` 정의부)
바로 뒤에 `_compute_unused_days` 헬퍼를 추가:

```python
            def parse_timestamp(timestamp_str: str, rule_name: str) -> str | None:
                if timestamp_str == '-':
                    return None
                try:
                    # 날짜 사이의 중복 공백(한 자리 일자 대비)을 단일 공백으로 치환
                    normalized_ts = re.sub(r'\s+', ' ', timestamp_str)
                    # "%a %b %d %H:%M:%S %Y" 형식으로 파싱
                    dt_obj = datetime.datetime.strptime(normalized_ts, '%a %b %d %H:%M:%S %Y')
                    return dt_obj.strftime('%Y-%m-%d %H:%M:%S')
                except ValueError:
                    self.logger.warning(f"규칙 '{rule_name}'의 타임스탬프 파싱 실패: '{timestamp_str}'")
                    return None

            def compute_unused_days(last_hit_date_str: str | None) -> int:
                """API 버전(export_last_hit_date)과 동일한 규칙: 마지막 히트 이후 경과일.
                히트 이력이 없으면(한 번도 안 쓰임) 99999로 표시."""
                if not last_hit_date_str:
                    return 99999
                last_hit_dt = datetime.datetime.strptime(last_hit_date_str, '%Y-%m-%d %H:%M:%S')
                return (datetime.datetime.now() - last_hit_dt).days
```

`backend/app/services/firewall/vendors/paloalto.py:490` (`ts_or_dash = ...` 다음) 바로 뒤에
확장/레거시 정규식 2쌍 정의를 추가:

```python
            ts_or_dash = r'(?:[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}|-)'

            # 확장 포맷: Rule Name, Vsys, Hit Count, Last Hit, Last Reset(무시),
            # First Hit, Rule Create [, Rule Modify, Rule UUID(끝까지 앵커링 안 하므로 무시)]
            extended_row_pattern_all_vsys = re.compile(
                rf'^(\S+)\s+(\S+)\s+(\d+)\s+({ts_or_dash})\s+({ts_or_dash})\s+({ts_or_dash})\s+({ts_or_dash})'
            )
            # 레거시(구버전) 포맷: Rule Name, Vsys, Hit Count, Last Hit Timestamp만 존재
            legacy_row_pattern_all_vsys = re.compile(
                rf'^(\S+)\s+(\S+)\s+(\d+)\s+({ts_or_dash})'
            )
            extended_row_pattern_per_vsys = re.compile(
                rf'^([a-zA-Z0-9/._-]+)\s+(\d+)\s+({ts_or_dash})\s+({ts_or_dash})\s+({ts_or_dash})\s+({ts_or_dash})'
            )
            legacy_row_pattern_per_vsys = re.compile(
                rf'^([a-zA-Z0-9/._-]+)\s+(\d+)\s+({ts_or_dash})'
            )
```

기존 `row_pattern = re.compile(rf'^(\S+)\s+(\S+)\s+(\d+)\s+({ts_or_dash})')` 한 줄
(현재 507-509줄, `# Last Reset/First Hit/...` 주석 포함)은 삭제한다(위에서 이미
`legacy_row_pattern_all_vsys`로 대체 정의됨).

`backend/app/services/firewall/vendors/paloalto.py:530-544` (vsys-all 분기의 매칭 부분)을
교체:

```python
                    match = extended_row_pattern_all_vsys.match(line)
                    if match:
                        rule_name, vsys_name, hit_count_str, last_hit_ts, _last_reset_ts, first_hit_ts, rule_create_ts = match.groups()
                    else:
                        match = legacy_row_pattern_all_vsys.match(line)
                        if not match:
                            continue
                        rule_name, vsys_name, hit_count_str, last_hit_ts = match.groups()
                        first_hit_ts, rule_create_ts = None, None

                    if target_vsys_list and vsys_name not in target_vsys_list:
                        continue

                    last_hit_date = parse_timestamp(last_hit_ts, rule_name)
                    all_results.append({
                        "vsys": vsys_name,
                        "rule_name": rule_name,
                        "hit_count": int(hit_count_str),
                        "first_hit_date": parse_timestamp(first_hit_ts, rule_name) if first_hit_ts is not None else None,
                        "last_hit_date": last_hit_date,
                        "rule_create_date": parse_timestamp(rule_create_ts, rule_name) if rule_create_ts is not None else None,
                        "unused_days": compute_unused_days(last_hit_date),
                    })
```

`backend/app/services/firewall/vendors/paloalto.py:574-587` (per-vsys/else 분기의 매칭
부분)을 교체:

```python
                        match = extended_row_pattern_per_vsys.match(line)
                        if match:
                            rule_name, hit_count_str, last_hit_ts, _last_reset_ts, first_hit_ts, rule_create_ts = match.groups()
                        else:
                            match = legacy_row_pattern_per_vsys.match(line)
                            if not match:
                                continue
                            rule_name, hit_count_str, last_hit_ts = match.groups()
                            first_hit_ts, rule_create_ts = None, None

                        last_hit_date = parse_timestamp(last_hit_ts.strip(), rule_name)
                        all_results.append({
                            "vsys": vsys_name,
                            "rule_name": rule_name,
                            "hit_count": int(hit_count_str),
                            "first_hit_date": parse_timestamp(first_hit_ts, rule_name) if first_hit_ts is not None else None,
                            "last_hit_date": last_hit_date,
                            "rule_create_date": parse_timestamp(rule_create_ts, rule_name) if rule_create_ts is not None else None,
                            "unused_days": compute_unused_days(last_hit_date),
                        })
```

(위 블록은 기존 `if match:` 들여쓰기 안, `for line in lines:` 루프 안에 있던 것을
대체한다 — 들여쓰기 레벨 그대로 유지.)

- [ ] **Step 4: 문법 검증 + 검증 스크립트 재실행**

Run: `python3 -c "import ast; ast.parse(open('backend/app/services/firewall/vendors/paloalto.py').read()); print('OK')"`
Expected: `OK`

Run: `python3 backend/app/services/firewall/vendors/verify_hit_count_parsing.py`
Expected: 이전과 동일하게 전부 통과(Step 3에서 옮긴 로직이 Step 1 스크립트와 동일해야 함).

- [ ] **Step 5: 검증 스크립트 삭제 (임시 파일이므로 커밋에 남기지 않음)**

Run: `rm backend/app/services/firewall/vendors/verify_hit_count_parsing.py`

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/firewall/vendors/paloalto.py
git commit -m "$(cat <<'EOF'
paloalto: SSH 히트카운트 파싱에서 first_hit/rule_create/unused_days도 수집

기존엔 Rule Name/Vsys/Hit Count/Last Hit Timestamp 4개만 뽑고 나머지 컬럼은
버렸는데, First Hit Timestamp/Rule Create Timestamp도 캡처하고 unused_days를
계산해 API 기반 수집(export_last_hit_date)과 동등한 정보를 SSH 경로에서도
얻도록 확장. 구버전 장비의 실제 출력 포맷이 불확실해 확장 정규식이 안 맞으면
기존 3~4컬럼 레거시 정규식으로 폴백한다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `policies` 테이블에 컬럼 3개 추가

**Files:**
- Modify: `backend/app/models/policy.py:49-52`
- Modify: `backend/app/schemas/policy.py:21-38`
- Create: `backend/alembic/versions/<autogen>_add_hit_history_fields_to_policies.py` (alembic이 생성)

**Interfaces:**
- Consumes: 없음 (독립 태스크, Task 1과 병행 가능하나 순서상 먼저 끝내는 게 안전).
- Produces: `Policy` ORM 모델과 `schemas.PolicyCreate`/`schemas.Policy`에
  `first_hit_date: datetime | None`, `unused_days: int | None`,
  `rule_create_date: datetime | None` 필드. Task 3(`dataframe_to_pydantic`)이
  이 필드들을 그대로 사용한다.

- [ ] **Step 1: ORM 모델에 컬럼 추가**

`backend/app/models/policy.py:49-52`를 다음으로 교체:

```python
    # 정책 사용이력의 마지막 히트 시간 (동기화 시 수집)
    last_hit_date = Column(DateTime, nullable=True)
    # 정책 히트 횟수 (Palo Alto 전용, 동기화 시 수집)
    hit_count = Column(Integer, nullable=True)
    # 최초 히트 시간 (API/SSH 모두 지원, Palo Alto 전용)
    first_hit_date = Column(DateTime, nullable=True)
    # 마지막 히트 이후 경과일수 (동기화 시점 기준 스냅샷, Palo Alto 전용)
    unused_days = Column(Integer, nullable=True)
    # 정책 생성 시각 (SSH 기반 수집만 지원, API/NGF/MF2는 NULL)
    rule_create_date = Column(DateTime, nullable=True)
```

- [ ] **Step 2: Pydantic 스키마에 필드 추가**

`backend/app/schemas/policy.py:21-38` (`PolicyBase`)를 다음으로 교체:

```python
# Base schema for policy attributes
class PolicyBase(BaseModel):
    rule_name: str
    source: str
    destination: str
    service: str
    action: str
    vsys: Optional[str] = None
    seq: Optional[int] = None
    enable: Optional[bool] = None
    user: Optional[str] = None
    application: Optional[str] = None
    security_profile: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    last_hit_date: Optional[datetime] = None
    hit_count: Optional[int] = None
    first_hit_date: Optional[datetime] = None
    unused_days: Optional[int] = None
    rule_create_date: Optional[datetime] = None
    from_zone: Optional[str] = None
    to_zone: Optional[str] = None
    log_setting: Optional[str] = None
```

- [ ] **Step 3: Alembic 마이그레이션 생성**

`backend/migrate.py`는 upgrade/downgrade/current/history/stamp/heads만 지원하고
`revision --autogenerate`는 없으므로, `alembic.ini`가 있는 `backend/` 디렉터리에서 alembic
CLI를 직접 실행한다(`backend/alembic/env.py`가 자체적으로 `backend/`를 `sys.path`에 넣으므로
별도 `PYTHONPATH` 설정 불필요):

Run:
```bash
cd backend && alembic revision --autogenerate -m "add hit history fields to policies"
```

- [ ] **Step 4: 생성된 마이그레이션 파일 검토**

생성된 파일(`backend/alembic/versions/<revision>_add_hit_history_fields_to_policies.py`)을
읽어서 `op.add_column('policies', sa.Column('first_hit_date', sa.DateTime(), nullable=True))`
형태의 3개 `add_column`이 정확히 들어있는지, `downgrade()`에 대응하는 `drop_column` 3개가
있는지 확인한다. autogenerate가 관계없는 변경(다른 테이블 diff 등)을 같이 잡아냈다면
이 3개 컬럼 관련 라인만 남기고 수동으로 정리한다.

- [ ] **Step 5: 마이그레이션 적용**

Run: `python backend/migrate.py`
Expected: 마지막 줄에 새 revision id로 업그레이드됐다는 로그.

Run: `python backend/migrate.py current`
Expected: 방금 생성한 revision이 현재 head로 표시됨.

- [ ] **Step 6: DB에 컬럼이 실제로 생겼는지 확인**

Run:
```bash
python3 -c "
import sqlite3
con = sqlite3.connect('backend/fat.db')
cols = [r[1] for r in con.execute('PRAGMA table_info(policies)')]
assert 'first_hit_date' in cols
assert 'unused_days' in cols
assert 'rule_create_date' in cols
print('OK: 컬럼 3개 확인됨', cols)
"
```
Expected: `OK: 컬럼 3개 확인됨 [...]`

- [ ] **Step 7: 커밋**

```bash
git add backend/app/models/policy.py backend/app/schemas/policy.py backend/alembic/versions/
git commit -m "$(cat <<'EOF'
policies 테이블에 first_hit_date/unused_days/rule_create_date 컬럼 추가

SSH 기반 히트카운트 수집이 이제 이 값들을 반환하므로(이전 커밋) 영구 저장할
컬럼을 추가. 전부 nullable — API/NGF/MF2 등 이 값을 못 받는 경로는 계속 NULL.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 동기화 파이프라인에 신규 필드 병합

**Files:**
- Modify: `backend/app/services/sync/tasks.py:214-217` (fields_to_compare 제외 집합)
- Modify: `backend/app/services/sync/tasks.py:476-522` (`_merge_hit_dates`)
- Test: `backend/app/services/sync/verify_merge_hit_dates.py` (신규, 임시 검증 스크립트)

**Interfaces:**
- Consumes: Task 1의 `export_last_hit_date_ssh` 반환 컬럼(`first_hit_date`,
  `rule_create_date`, `unused_days`), Task 2의 `schemas.PolicyCreate` 필드.
  API 경로(`export_last_hit_date`)는 이미 `first_hit_date`/`unused_days` 컬럼을
  반환하고 있음(기존 코드, 변경 없음) — `rule_create_date`는 API 경로엔 없음.
- Produces: `_merge_hit_dates(policies_df, hit_date_df) -> pd.DataFrame`가 입력에 이
  컬럼들이 있으면 `first_hit_date`/`unused_days`/`rule_create_date` 컬럼을 채워서
  반환(없으면 기존 policies_df 값 그대로 유지, 즉 이번 동기화에서 못 받은 필드는
  건드리지 않음 — `hit_count`의 기존 동작과 다르게, 이 3개는 "정보가 있을 때만 덮어쓰기").

- [ ] **Step 1: 검증 스크립트 작성 (Task 1과 동일하게, 먼저 기대 동작을 스크립트로 고정)**

`backend/app/services/sync/verify_merge_hit_dates.py` 생성:

```python
"""
_merge_hit_dates()가 first_hit_date/unused_days/rule_create_date를 올바르게
병합하는지 확인하는 standalone 검증 스크립트. pytest 미설치 프로젝트라 직접 실행:
python3 backend/app/services/sync/verify_merge_hit_dates.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # backend/ 를 sys.path에

import pandas as pd
from app.services.sync.tasks import _merge_hit_dates

# 시나리오 1: SSH 경로 — first_hit_date/rule_create_date/unused_days 전부 있음
policies_df = pd.DataFrame([
    {"vsys": "vsys1", "rule_name": "Allow-Web", "hit_count": None, "last_hit_date": None},
    {"vsys": "vsys1", "rule_name": "Deny-Old", "hit_count": None, "last_hit_date": None},
])
hit_date_df = pd.DataFrame([
    {
        "vsys": "vsys1", "rule_name": "Allow-Web", "hit_count": 1523,
        "last_hit_date": "2026-11-04 00:50:48", "first_hit_date": "2025-01-01 08:00:00",
        "rule_create_date": "2025-01-01 08:00:00", "unused_days": 10,
    },
])
merged = _merge_hit_dates(policies_df.copy(), hit_date_df.copy())
row = merged[merged["rule_name"] == "Allow-Web"].iloc[0]
assert row["hit_count"] == 1523, row["hit_count"]
assert str(row["first_hit_date"])[:10] == "2025-01-01"
assert str(row["rule_create_date"])[:10] == "2025-01-01"
assert row["unused_days"] == 10, row["unused_days"]
row2 = merged[merged["rule_name"] == "Deny-Old"].iloc[0]
assert pd.isna(row2["first_hit_date"]) or row2["first_hit_date"] is None
print("OK: SSH 경로(3개 필드 전부) 병합")

# 시나리오 2: API 경로 — rule_create_date 컬럼이 아예 없음
hit_date_df_api = pd.DataFrame([
    {
        "vsys": "vsys1", "rule_name": "Allow-Web", "hit_count": 200,
        "last_hit_date": "2026-11-04 00:50:48", "first_hit_date": "2025-06-01 00:00:00",
        "unused_days": 5,
    },
])
merged_api = _merge_hit_dates(policies_df.copy(), hit_date_df_api.copy())
assert "rule_create_date" not in merged_api.columns or merged_api["rule_create_date"].isna().all()
row_api = merged_api[merged_api["rule_name"] == "Allow-Web"].iloc[0]
assert row_api["unused_days"] == 5
print("OK: API 경로(rule_create_date 없음) 병합 — 없는 컬럼은 안 건드림")

print("\n전부 통과")
```

- [ ] **Step 2: 지금 실행해서 실패하는지 확인 (아직 `_merge_hit_dates`가 신규 필드를 안 다룸)**

Run: `python3 backend/app/services/sync/verify_merge_hit_dates.py`
Expected: `AssertionError` (row["first_hit_date"]가 KeyError 또는 값 불일치로 실패) —
현재 `_merge_hit_dates`는 `hit_count`/`last_hit_date`만 병합하므로 실패해야 정상.

- [ ] **Step 3: `fields_to_compare` 제외 집합에 3개 필드 추가**

`backend/app/services/sync/tasks.py:216-217`을 다음으로 교체:

```python
                    fields_to_compare = set(update_data.keys())
                    if data_type == "policies":
                        # 순서/히트 정보는 매 동기화마다 갱신되는 스냅샷 값이라 주요 변경 비교에서 제외
                        fields_to_compare -= {
                            'seq', 'last_hit_date', 'hit_count',
                            'first_hit_date', 'unused_days', 'rule_create_date',
                        }
```

- [ ] **Step 4: `_merge_hit_dates` 확장**

`backend/app/services/sync/tasks.py:476-522` 전체를 다음으로 교체:

```python
def _merge_hit_dates(policies_df: pd.DataFrame, hit_date_df: pd.DataFrame) -> pd.DataFrame:
    """수집된 히트 정보(last_hit_date/hit_count/first_hit_date/unused_days/rule_create_date)를
    정책 DataFrame에 병합합니다 (순수 pandas 연산). hit_date_df에 없는 컬럼은 건드리지 않는다
    (예: API 경로는 rule_create_date가 없으므로 기존 policies_df 값을 그대로 유지)."""
    def normalize_rule_name(name):
        if pd.isna(name): return None
        s = str(name).strip()
        return s if s and s.lower() not in {"nan", "none", "-", ""} else None

    def normalize_vsys(vsys_val):
        if pd.isna(vsys_val): return None
        s = str(vsys_val).strip().lower()
        return s if s and s.lower() not in {"nan", "none", "-", ""} else None

    policies_df['rule_name_normalized'] = policies_df['rule_name'].apply(normalize_rule_name)
    hit_date_df['rule_name_normalized'] = hit_date_df['rule_name'].apply(normalize_rule_name)

    if 'vsys' in policies_df.columns:
        policies_df['vsys_normalized'] = policies_df['vsys'].apply(normalize_vsys)
    if 'vsys' in hit_date_df.columns:
        hit_date_df['vsys_normalized'] = hit_date_df['vsys'].apply(normalize_vsys)

    # 히트 정보가 있는 레코드만 필터링 후 병합
    hit_date_df = hit_date_df[hit_date_df['rule_name_normalized'].notna()].copy()

    hit_date_df['last_hit_date_new'] = pd.to_datetime(hit_date_df['last_hit_date'], errors='coerce')

    merge_keys = ['vsys_normalized', 'rule_name_normalized'] if 'vsys_normalized' in policies_df.columns and 'vsys_normalized' in hit_date_df.columns else ['rule_name_normalized']

    merge_cols = merge_keys + ['last_hit_date_new']

    has_hit_count = 'hit_count' in hit_date_df.columns
    if has_hit_count:
        hit_date_df = hit_date_df.rename(columns={'hit_count': 'hit_count_new'})
        merge_cols = merge_cols + ['hit_count_new']

    has_first_hit = 'first_hit_date' in hit_date_df.columns
    if has_first_hit:
        hit_date_df['first_hit_date_new'] = pd.to_datetime(hit_date_df['first_hit_date'], errors='coerce')
        merge_cols = merge_cols + ['first_hit_date_new']

    has_rule_create = 'rule_create_date' in hit_date_df.columns
    if has_rule_create:
        hit_date_df['rule_create_date_new'] = pd.to_datetime(hit_date_df['rule_create_date'], errors='coerce')
        merge_cols = merge_cols + ['rule_create_date_new']

    has_unused_days = 'unused_days' in hit_date_df.columns
    if has_unused_days:
        hit_date_df = hit_date_df.rename(columns={'unused_days': 'unused_days_new'})
        merge_cols = merge_cols + ['unused_days_new']

    merged_df = pd.merge(policies_df, hit_date_df[merge_cols], on=merge_keys, how="left")

    def choose_latest(row):
        new_val = row.get('last_hit_date_new')
        if pd.notna(new_val):
            return new_val.to_pydatetime() if hasattr(new_val, 'to_pydatetime') else new_val
        return None

    def to_pydatetime_or_none(v):
        if pd.isna(v):
            return None
        return v.to_pydatetime() if hasattr(v, 'to_pydatetime') else v

    merged_df['last_hit_date'] = merged_df.apply(choose_latest, axis=1)
    drop_cols = ['last_hit_date_new', 'rule_name_normalized', 'vsys_normalized']
    if has_hit_count:
        merged_df['hit_count'] = merged_df['hit_count_new'].apply(lambda v: int(v) if pd.notna(v) else None)
        drop_cols.append('hit_count_new')
    if has_first_hit:
        merged_df['first_hit_date'] = merged_df['first_hit_date_new'].apply(to_pydatetime_or_none)
        drop_cols.append('first_hit_date_new')
    if has_rule_create:
        merged_df['rule_create_date'] = merged_df['rule_create_date_new'].apply(to_pydatetime_or_none)
        drop_cols.append('rule_create_date_new')
    if has_unused_days:
        merged_df['unused_days'] = merged_df['unused_days_new'].apply(lambda v: int(v) if pd.notna(v) else None)
        drop_cols.append('unused_days_new')
    return merged_df.drop(columns=drop_cols, errors='ignore')
```

- [ ] **Step 5: 검증 스크립트 재실행**

Run: `python3 backend/app/services/sync/verify_merge_hit_dates.py`
Expected: `OK: SSH 경로(3개 필드 전부) 병합`, `OK: API 경로(rule_create_date 없음) 병합 — 없는 컬럼은 안 건드림`, `전부 통과` 출력, exit code 0.

- [ ] **Step 6: 검증 스크립트 삭제**

Run: `rm backend/app/services/sync/verify_merge_hit_dates.py`

- [ ] **Step 7: 커밋**

```bash
git add backend/app/services/sync/tasks.py
git commit -m "$(cat <<'EOF'
sync: first_hit_date/unused_days/rule_create_date를 정책 동기화에 반영

_merge_hit_dates가 hit_count/last_hit_date와 동일한 패턴으로 신규 3개 필드를
병합하도록 확장. hit_date_df에 해당 컬럼이 없으면(API 경로의 rule_create_date
등) 건드리지 않고 기존 값을 유지한다. dirty 체크 제외 집합에도 추가해 이
필드들만 바뀌어도 정책 변경 이력 로그가 안 남게 한다(seq/last_hit_date/
hit_count와 동일 취급).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Devices 직접추출(hit_dates) — seq 정렬 + 컬럼 확장

**Files:**
- Modify: `backend/app/services/export/tasks.py:33-46` (`_POLICY_COL_MAP` 근처에 새 맵 추가)
- Modify: `backend/app/services/export/tasks.py:145-149` (`_collect_db_hit_dates`)
- Modify: `backend/app/services/export/tasks.py:282-311` (`run_export_task` 내 수집 루프)
- Test: `backend/app/services/export/verify_hit_dates_export.py` (신규, 임시 검증 스크립트)

**Interfaces:**
- Consumes: Task 2의 `Policy.seq`/`Policy.first_hit_date`/`Policy.unused_days`,
  Task 1/3이 채운 `hit_count`/`first_hit_date`/`last_hit_date`/`unused_days` 컬럼(SSH/API
  라이브 수집 DataFrame 또는 DB).
- Produces: hit_dates export의 최종 DataFrame이 `(vsys, seq)` 순 정렬 + 컬럼
  `VSYS, #, Rule Name, Hit Count, First Hit Date, Last Hit Date, Unused Days`로 렌더링됨.
  `Rule Name`/`Unused Days` 철자는 `policy_usage_processor.py`가 그대로 소비하므로
  변경 금지.

- [ ] **Step 1: 검증 스크립트 작성**

`backend/app/services/export/verify_hit_dates_export.py` 생성:

```python
"""
hit_dates export의 seq 정렬 + 컬럼 정규화 로직을 DB 없이(sqlite in-memory 픽스처로)
검증하는 standalone 스크립트. pytest 미설치 프로젝트라 직접 실행:
python3 backend/app/services/export/verify_hit_dates_export.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # backend/ 를 sys.path에

import pandas as pd
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.db.session import Base
# 반드시 app.models 패키지 전체를 임포트해야 한다 — Policy는
# PolicyAddressMember/RedundancyPolicySet 등을 문자열 relationship으로 참조하므로,
# 해당 클래스들이 임포트돼 있지 않으면 첫 쿼리 시 SQLAlchemy가 매퍼 설정에 실패한다.
from app.models import Device, Policy
from app.services.export.tasks import _enrich_hit_dates_with_seq, _normalize_hit_dates_df, _collect_db_hit_dates


async def main():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        device = Device(
            name="test-dev", ip_address="1.2.3.4", vendor="paloalto",
            username="u", password="p",
        )
        db.add(device)
        await db.flush()

        # seq=30인 정책이 먼저, seq=10인 정책이 나중에 오도록 일부러 순서를 뒤섞어 저장
        db.add_all([
            Policy(device_id=device.id, vsys="vsys1", seq=30, rule_name="Rule-C",
                   action="allow", source="any", destination="any", service="any"),
            Policy(device_id=device.id, vsys="vsys1", seq=10, rule_name="Rule-A",
                   action="allow", source="any", destination="any", service="any",
                   hit_count=5, unused_days=3),
            Policy(device_id=device.id, vsys="vsys1", seq=20, rule_name="Rule-B",
                   action="allow", source="any", destination="any", service="any"),
        ])
        await db.commit()

        # === 시나리오 1: 라이브(SSH/API) 수집 결과를 seq로 join+정렬 ===
        live_df = pd.DataFrame([
            {"vsys": "vsys1", "rule_name": "Rule-C", "hit_count": 1, "last_hit_date": None,
             "first_hit_date": None, "unused_days": 99999},
            {"vsys": "vsys1", "rule_name": "Rule-A", "hit_count": 5, "last_hit_date": None,
             "first_hit_date": None, "unused_days": 3},
            {"vsys": "vsys1", "rule_name": "Unknown-Rule", "hit_count": 0, "last_hit_date": None,
             "first_hit_date": None, "unused_days": 99999},
        ])
        enriched = await _enrich_hit_dates_with_seq(db, device.id, live_df)
        ordered_names = enriched["rule_name"].tolist()
        # Rule-A(seq10) -> Rule-C(seq30) -> Unknown-Rule(seq 없음, 원래 순서 유지하며 맨 뒤)
        assert ordered_names == ["Rule-A", "Rule-C", "Unknown-Rule"], ordered_names
        print("OK: 라이브 수집 seq join + 정렬 (미매칭 행은 뒤로)")

        normalized = _normalize_hit_dates_df(enriched)
        assert list(normalized.columns) == ["VSYS", "#", "Rule Name", "Hit Count", "First Hit Date", "Last Hit Date", "Unused Days"], list(normalized.columns)
        print("OK: 컬럼 정규화 (Rule Name/Unused Days 철자 확인)")

        # === 시나리오 2: source=db 경로 — Policy 테이블에서 바로 seq 순 정렬 ===
        db_df = await _collect_db_hit_dates(db, device.id)
        assert db_df["rule_name"].tolist() == ["Rule-A", "Rule-B", "Rule-C"], db_df["rule_name"].tolist()
        print("OK: source=db 경로 seq 순 정렬")

    await engine.dispose()
    print("\n전부 통과")


asyncio.run(main())
```

- [ ] **Step 2: 실행해서 실패 확인 (아직 함수가 없음/기존 동작이 다름)**

Run: `python3 backend/app/services/export/verify_hit_dates_export.py`
Expected: `ImportError` (`_enrich_hit_dates_with_seq`가 아직 없음).

- [ ] **Step 3: hit_dates 전용 컬럼 맵 + 정규화 함수 추가**

`backend/app/services/export/tasks.py:33-46` (`_POLICY_COL_MAP` 딕셔너리) 바로 뒤에 추가:

```python
_HIT_DATE_COL_MAP = {
    "vsys": "VSYS",
    "seq": "#",
    "rule_name": "Rule Name",
    "hit_count": "Hit Count",
    "first_hit_date": "First Hit Date",
    "last_hit_date": "Last Hit Date",
    "unused_days": "Unused Days",
}


def _normalize_hit_dates_df(df: pd.DataFrame) -> pd.DataFrame:
    """hit_dates 엑셀 컬럼을 deletion workflow 호환 이름으로 정규화한다.
    'Rule Name'/'Unused Days' 철자는 policy_usage_processor.py의 폴백 로직이
    정확히 이 이름을 찾으므로 절대 바꾸면 안 된다."""
    df = df.copy()
    cols_in_order = [c for c in ["vsys", "seq", "rule_name", "hit_count", "first_hit_date", "last_hit_date", "unused_days"] if c in df.columns]
    df = df[cols_in_order]
    return df.rename(columns={k: v for k, v in _HIT_DATE_COL_MAP.items() if k in df.columns})
```

- [ ] **Step 4: seq join 헬퍼 추가**

같은 파일에서 `_collect_db_hit_dates` 함수(현재 145-149줄) 바로 앞에 추가:

```python
async def _enrich_hit_dates_with_seq(db, device_id: int, df: pd.DataFrame) -> pd.DataFrame:
    """SSH/API로 받아온 사용이력 결과에 이미 동기화된 Policy의 seq를 매칭해 붙이고
    (vsys, seq) 순으로 정렬한다. 장비 출력 자체엔 seq가 없어서 DB의 기존 정책과
    (vsys, rule_name)으로 조인한다. 매칭되는 정책이 없으면(신규 장비 등) seq 없이
    원래 순서를 유지한 채 정렬 시 뒤로 보낸다."""
    if df.empty:
        return df
    policies = await crud.policy.get_policies_by_device(db, device_id=device_id)
    seq_map = {
        (str(p.vsys or '').strip().lower(), str(p.rule_name or '').strip()): p.seq
        for p in policies
    }
    df = df.reset_index(drop=True).copy()
    df['seq'] = df.apply(
        lambda row: seq_map.get((str(row.get('vsys') or '').strip().lower(), str(row.get('rule_name') or '').strip())),
        axis=1,
    )
    df = df.sort_values(by=['vsys', 'seq'], na_position='last', kind='stable')
    return df.reset_index(drop=True)
```

- [ ] **Step 5: `_collect_db_hit_dates`에 seq/hit_count/first_hit_date/unused_days 포함 + 정렬**

`backend/app/services/export/tasks.py:145-149` 전체를 다음으로 교체:

```python
async def _collect_db_hit_dates(db, device_id: int) -> pd.DataFrame:
    policies = await crud.policy.get_policies_by_device(db, device_id=device_id)
    policies = sorted(policies, key=lambda p: (p.vsys or '', p.seq if p.seq is not None else float('inf')))
    rows = [{
        "vsys": p.vsys, "seq": p.seq, "rule_name": p.rule_name, "hit_count": p.hit_count,
        "first_hit_date": p.first_hit_date, "last_hit_date": p.last_hit_date,
        "unused_days": p.unused_days,
    } for p in policies]
    return pd.DataFrame(rows)
```

- [ ] **Step 6: 검증 스크립트 재실행**

Run: `python3 backend/app/services/export/verify_hit_dates_export.py`
Expected: `OK: 라이브 수집 seq join + 정렬 (미매칭 행은 뒤로)`, `OK: 컬럼 정규화 (Rule Name/Unused Days 철자 확인)`, `OK: source=db 경로 seq 순 정렬`, `전부 통과`.

- [ ] **Step 7: `run_export_task`의 수집 루프에 enrichment 연결**

`backend/app/services/export/tasks.py:282-311` 근처, `run_export_task` 내부의
device 순회 루프(`if source == "db": ... else: per_device_data[device.id] = await
_collect_live_export(...)` 부분)를 다음으로 교체:

```python
            if source == "db":
                async with SessionLocal() as db:
                    if export_type == "policies":
                        per_device_data[device.id] = _normalize_policy_df(await _collect_db_policies(db, device.id))
                    elif export_type == "objects":
                        per_device_data[device.id] = await _collect_db_objects(db, device.id)
                    else:
                        per_device_data[device.id] = _normalize_hit_dates_df(await _collect_db_hit_dates(db, device.id))
            else:
                data = await _collect_live_export(device, export_type, use_ssh, loop, timeout)
                if export_type == "hit_dates":
                    async with SessionLocal() as db:
                        data = await _enrich_hit_dates_with_seq(db, device.id, data)
                    data = _normalize_hit_dates_df(data)
                per_device_data[device.id] = data
```

(정확한 줄 번호는 현재 파일 상태에 따라 약간 다를 수 있으니, `if source == "db":`로
시작하는 블록 전체를 찾아서 교체한다. `_normalize_policy_df`/`_collect_db_objects`
분기는 그대로 둔다.)

- [ ] **Step 8: 문법 검증**

Run: `python3 -c "import ast; ast.parse(open('backend/app/services/export/tasks.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 9: 백엔드 기동 확인 (import 사이클/오타 등 런타임 오류 조기 발견)**

Run:
```bash
cd /Users/hoon/Code/firewall-analysis-tool
nohup uvicorn app.main:app --app-dir backend --port 8002 > /tmp/uvicorn_verify.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8002/docs
kill %1 2>/dev/null
```
Expected: `200`

- [ ] **Step 10: 검증 스크립트 삭제**

Run: `rm backend/app/services/export/verify_hit_dates_export.py`

- [ ] **Step 11: 커밋**

```bash
git add backend/app/services/export/tasks.py
git commit -m "$(cat <<'EOF'
export: 직접추출(사용이력)을 seq 순 정렬 + 확장 컬럼으로 내보내기

장비 SSH/API 출력엔 seq가 없어서 이미 동기화된 Policy 테이블과 (vsys,
rule_name)으로 조인해 seq를 붙이고 (vsys, seq) 순으로 정렬한다. 미동기화
정책은 seq 없이 원래 순서를 유지한 채 뒤로 보낸다. Hit Count/First Hit
Date/Unused Days 컬럼을 추가하고 'Rule Name'/'Unused Days' 철자를 deletion
workflow의 기존 폴백 로직과 맞춰서, 별도 코드 변경 없이 이 엑셀을 사용이력
파일로 그대로 재사용할 수 있게 한다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## 최종 확인 (전체 태스크 완료 후)

- [ ] `git log --oneline -6`으로 4개 커밋(Task 1~4)이 순서대로 들어갔는지 확인.
- [ ] `python3 -c "import ast; [ast.parse(open(f).read()) for f in ['backend/app/services/firewall/vendors/paloalto.py','backend/app/services/sync/tasks.py','backend/app/services/export/tasks.py','backend/app/models/policy.py','backend/app/schemas/policy.py']]; print('OK')"` — 전체 파일 문법 재확인.
- [ ] `python backend/migrate.py current` — 마이그레이션이 최신 head인지 재확인.
- [ ] 임시 검증 스크립트(`verify_*.py`) 3개가 전부 삭제되어 `git status`에 안 남아있는지 확인.
