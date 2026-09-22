# Palo Alto SSH 히트카운트 수집 확장 설계

## 배경 및 목표

`export_last_hit_date_ssh`(SSH 기반 사용이력 수집)는 `hit_count`/`last_hit_date`만
반환한다. 같은 벤더의 API 기반 수집(`export_last_hit_date`)은 이미 `first_hit_date`와
`unused_days`까지 반환하고 있어 두 경로 간 정보 비대칭이 있다. 장비의 SSH 셸 출력에는
Last Reset/First Hit/Rule Create/Rule Modify Timestamp, Rule UUID까지 담겨 있지만 현재
파싱 로직은 앞의 4개 컬럼(Rule Name/Vsys/Hit Count/Last Hit Timestamp)만 뽑고 나머지는
버린다.

목표:
1. SSH 경로에서도 `first_hit_date`, `unused_days`, `rule_create_date`(정책 생성일)를
   확보해 `policies` 테이블에 영구 저장한다.
2. Devices 페이지 "직접 추출"(사용이력)의 결과를 정책 seq 순서로 정렬하고, 위 필드들을
   컬럼으로 추가한다.
3. 그 결과 엑셀이 별도 코드 변경 없이 deletion workflow의 "사용이력 파일" 업로드에 그대로
   재사용 가능하도록 컬럼명을 맞춘다.

## 범위 결정 (브레인스토밍에서 확정된 사항)

- 저장 범위: `first_hit_date`, `unused_days`, `rule_create_date` 3개만 저장한다.
  Last Reset Timestamp/Rule Modify Timestamp/Rule UUID는 이번 범위에서 저장하지 않는다
  (YAGNI — 실제로 쓸 곳이 생기면 그때 추가).
- `미사용여부`(Y/N)는 DB에 저장하지 않는다. `unused_days`만 저장하고, 화면/엑셀 출력
  시점에 Settings의 `unused_threshold_days`(기본 90, `deletion_workflow_config` 키)와
  비교해 그때그때 계산한다. 기준을 바꿔도 과거 값이 안 남게 하기 위함 — 기존
  `deletion_workflow`/`unused.py`와 동일한 패턴이다.
- `show rule-hit-count vsys all ...`(OS 10+) / per-vsys 명령(OS<10) 두 SSH 명령 분기는
  그대로 유지한다(각각 장비 hang 회피/구버전 호환 목적으로 이미 확정된 것). 파싱만
  확장한다 — OS<10 장비의 실제 출력이 신규 9~10컬럼 포맷인지 기존 3컬럼 포맷인지 확실치
  않으므로, 확장 정규식을 우선 시도하고 실패하면 기존 3컬럼 레거시 정규식으로 폴백한다.
  두 분기 모두 이 방식을 적용한다.
- Deletion workflow 쪽 코드는 변경하지 않는다. `policy_usage_processor.py`가 이미
  `미사용여부` 컬럼이 없으면 `Unused Days` 컬럼(정확히 이 이름)을 보고 Settings 임계값으로
  자동 계산하는 폴백을 갖고 있으므로, 새 hit_dates 엑셀이 이 컬럼명을 쓰면 그대로 재사용된다.

## 1. SSH 파싱 확장 (`backend/app/services/firewall/vendors/paloalto.py`)

`export_last_hit_date_ssh` 내부:

- 확장 정규식 추가: 기존 4개 그룹(Rule Name/Vsys/Hit Count/Last Hit Timestamp)에 이어
  Last Reset Timestamp(스킵), First Hit Timestamp(캡처), Rule Create Timestamp(캡처)까지
  매칭. Rule Modify Timestamp/Rule UUID는 매칭 대상에서 제외(끝까지 앵커링하지 않으므로
  존재해도 무시됨).
- 레거시 정규식(현재 코드 그대로, 4개 그룹)을 폴백으로 유지.
- 각 데이터 줄 파싱 시 확장 정규식을 먼저 시도 → 실패하면 레거시 정규식 시도 → 그래도
  실패하면 현재처럼 스킵.
- `unused_days` 계산: API 버전(`export_last_hit_date`)과 동일한 규칙 —
  `last_hit_date`가 있으면 `(오늘 - last_hit_date).days`, 없으면 `99999`.
- 반환 DataFrame에 `first_hit_date`, `rule_create_date`, `unused_days` 컬럼 추가
  (레거시 매칭만 된 경우 `first_hit_date`/`rule_create_date`는 `None`, `unused_days`는
  그래도 `last_hit_date` 기준으로 계산 가능하므로 채운다).

## 2. `policies` 테이블 컬럼 추가 (`backend/app/models/policy.py`)

- `first_hit_date` (DateTime, nullable)
- `unused_days` (Integer, nullable)
- `rule_create_date` (DateTime, nullable)

모두 nullable — API/NGF/MF2 등 SSH로 이 값을 못 받는 장비/경로는 계속 NULL.
`alembic revision --autogenerate` 로 마이그레이션 생성 후 `python backend/migrate.py` 적용.

## 3. 동기화 파이프라인 반영 (`backend/app/services/sync/tasks.py`)

- `_collect_last_hit_date_parallel`: SSH 경로는 이미 확장된 컬럼을 포함해 반환하므로 별도
  수집 로직 변경 없음(paloalto.py 변경만으로 흘러들어옴). API 경로는 기존처럼
  `first_hit_date`/`unused_days`만 채워지고 `rule_create_date`는 없음.
- `_merge_hit_dates`: 지금 `hit_count`/`last_hit_date`만 policies DataFrame에 병합하는
  로직을, `first_hit_date`/`unused_days`/`rule_create_date`도 동일한 방식(있으면 병합,
  없으면 기존 값 유지)으로 확장.
- upsert 루프(`run_sync_all_orchestrator` 내 policies 갱신 부분): `update_data`에 3개
  필드 추가. `fields_to_compare -= {...}` 제외 집합에도 3개 필드 추가(현재 `seq`/
  `last_hit_date`/`hit_count`와 동일하게 "매 동기화마다 갱신되는 값"으로 취급해 dirty
  체크·변경 이력 로그 대상에서 제외).

## 4. Devices 직접추출(hit_dates) 개선 (`backend/app/services/export/tasks.py`)

- **seq 정렬**: SSH/API 수집 결과(rule_name, vsys 기준)에 대해 device_id로 이미 동기화된
  `Policy` 테이블에서 `(vsys, rule_name) → seq` 매핑을 조회해 join. 매칭되는 정책이 없으면
  (신규 장비라 동기화 이력이 없는 경우 등) 해당 행의 seq는 비워두고, 정렬 시 seq 없는 행은
  원래 순서를 유지한 채 뒤로 보낸다.
- `source='db'`(이미 동기화된 데이터) 선택 시: `_collect_db_hit_dates`가 이제 Policy의
  `seq`/`hit_count`/`first_hit_date`/`last_hit_date`/`unused_days`를 그대로 읽어온다
  (이미 DB에 있으므로 별도 join 불필요).
- **미사용여부 계산**: `unused_days` + `deletion_workflow_config`의
  `unused_threshold_days`(기본 90)를 비교해 엑셀 생성 시점에 계산. (컬럼 자체는 3번
  섹션에서 정한 대로 `미사용여부`가 아니라 `Unused Days`만 내보내고, deletion workflow
  쪽 폴백 로직이 이 값으로 알아서 판정하게 둔다 — 중복 계산·불일치 방지.)
- **정렬**: 최종 DataFrame을 `(vsys, seq)` 기준 정렬.
- **엑셀 헤더 한글화**: 현재 hit_dates 엑셀은 컬럼명이 영문 원본 그대로 노출된다(`vsys`,
  `rule_name` 등 — `_normalize_policy_df`와 달리 렌더링 매핑이 없었음). "정책" 추출과
  같은 방식으로 매핑 테이블을 추가한다: `VSYS`, `#`, `Rule Name`, `Hit Count`,
  `First Hit Date`, `Last Hit Date`, `Unused Days`. (`Rule Name`/`Unused Days`는 deletion
  workflow 호환을 위해 반드시 이 철자를 유지.)

## 5. Deletion Workflow — 코드 변경 없음

`policy_usage_processor.py`의 기존 폴백 로직(`Unused Days` 컬럼 → Settings 임계값 비교)을
그대로 활용. 4번에서 만든 hit_dates 엑셀을 "사용이력 파일"로 업로드하면 그대로 동작.
별도 확인/변경 불필요.

## 에러 처리

- 파싱: 확장 정규식/레거시 정규식 둘 다 실패한 줄은 현재처럼 조용히 스킵(기존 동작 유지,
  이번 변경으로 더 엄격해지지 않음).
- seq join 실패(동기화 이력 없음): 예외를 내지 않고 seq를 비운 채 진행(내보내기 자체는
  실패하지 않아야 함).
- DB 마이그레이션: 기존 행은 3개 신규 컬럼이 전부 NULL로 시작 — 다음 동기화/직접추출 시
  채워짐. 하위 호환 깨지는 지점 없음.

## 테스트

- 파싱: 확장 포맷/레거시 포맷 두 샘플 모두에 대해 정규식이 올바른 필드를 추출하는지
  단위 테스트(이미 스크래치 스크립트로 확장 포맷 검증한 것을 정식 테스트로 옮김).
- `_merge_hit_dates`: 신규 3개 필드가 있는 경우/없는 경우(API 경로) 각각 policies
  DataFrame에 올바르게 반영되는지.
- export: seq join 성공/실패(미동기화 장비) 두 케이스에서 정렬과 컬럼이 기대대로
  나오는지, `Unused Days` 컬럼명이 정확히 유지되는지.
