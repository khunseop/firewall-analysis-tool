# 삭제 워크플로우 Phase 3 — 자동연장예외 요청 (Task 19)

> **작성 목적**: Task 19(자동연장예외파일 생성) 상세 로직 검증용  
> **최종 수정**: 2026-07-13  
> **상위 문서**: [방화벽 정책 삭제 워크플로우 운영 매뉴얼](./방화벽_정책_삭제_워크플로우_운영_매뉴얼.md)

---

## 1. 목적

Phase 2(Task 18 공지대상분류)까지 끝나면 "장기미사용", "중복정책 삭제", "중복정책 공지" 세 갈래로 삭제/공지 대상 정책이 확정된다. 이 정책들의 **GSAMS 신청번호**를 모아 타 부서에 "자동연장예외 처리"를 요청하기 위한 파일이 **자동연장예외파일**이다.

Task 19는 이 파일을 생성하는 첫 단계로, 신청번호를 F-prefix(일반신청건)만 남기고, 실제로 GSAMS 상 자동연장 대상(REQUEST_STATUS 91/99)인 것만 추려 중복 제거·정렬한다.

---

## 2. 입력 (4개, 전부 자동 리졸빙 — 사용자 파일 선택 불필요)

| 순번 | 파일 | 출처 | 신청번호 컬럼 | 비고 |
|---|---|---|---|---|
| 1 | 장기미사용정책(공지용) | Task 18 output (`*_장기미사용정책(공지용).xlsx`) | `REQUEST_ID` | 파일명에 "장기미사용" 포함 여부로 탐색 (슬롯 인덱스는 카테고리 존재 여부에 따라 가변적) |
| 2 | 중복정책_삭제 | Task 14 output_1 (`*_삭제.xlsx`) | `Request ID` | `작업구분` 컬럼 보유 |
| 3 | 중복정책_공지 | Task 14 output_0 (`*_공지.xlsx`) | `Request ID` | `작업구분` 컬럼 보유 |
| 4 | GSAMS 취합 결과(Conv) | Task 7 output_0 (`Conv_*.xlsx`) | `REQUEST_ID` | `REQUEST_STATUS` 컬럼 보유 |

**주의**: 장기미사용 파일은 `REQUEST_ID`(대문자, 언더스코어), 중복삭제/중복공지 파일은 `Request ID`(공백 포함)로 컬럼명이 서로 다르다. 이는 파이프라인 앞 단계에서 컬럼명이 재구성되기 때문이며(`Request ID`는 Task 10/11에서 drop되고 `REQUEST_ID`가 신규 부여됨), Task 19 구현에서는 파일별로 정확한 컬럼명을 하드코딩해서 참조한다.

---

## 3. 처리 로직 (구현: `processors/auto_renewal_exception_generator.py`)

```
1. 장기미사용 파일에서 REQUEST_ID 값 중 'F'로 시작하는 것 전부 수집
   (F-prefix = Request ID 첫 글자 기준 "일반신청건"/GENERAL, request_parser.py의 타입 매핑과 동일 기준)

2. 중복정책_삭제 파일에서 작업구분 == '삭제' 인 행만 필터
   → 그 중 Request ID 값이 'F'로 시작하는 것 수집

3. 중복정책_공지 파일에서 작업구분 == '삭제' 인 행만 필터
   → 그 중 Request ID 값이 'F'로 시작하는 것 수집
   (주의: '_공지.xlsx' 파일이라도 내부에 작업구분='유지'인 행이 섞여 있을 수 있어
    파일 종류가 아니라 작업구분 컬럼 값으로 직접 필터링해야 함)

4. 1~3에서 모은 신청번호를 하나의 리스트로 합침 (이 시점에는 dedup 하지 않음 — 5번에서 한 번만 수행)

5. Conv 파일에서 REQUEST_STATUS in [91, 99] 인 행의 REQUEST_ID를 "허용 집합"으로 구성
   - 99 = 자동연장정책 (코드/매뉴얼에 기존 정의됨)
   - 91 = 반영완료 (추후 자동연장될 대상) — GSAMS 담당자 확인 기준으로 채택

6. 4의 리스트를 5의 허용 집합에 포함된 것만 남기고 필터링
   (Conv 파일에 아예 없는 신청번호, 혹은 상태가 91/99가 아닌 신청번호는 제거)

7. 최종적으로 중복 제거 + 문자열(사전순) 오름차순 정렬
```

**단순화 결정**: 원래 "1차 합친 직후 dedup, 2차 최종 dedup" 2단계로 검토했으나, 부분집합 필터링은 새 중복을 만들지 않으므로 수학적으로 마지막 1회 dedup만으로 결과가 동일하다. 구현은 마지막 1회만 수행한다.

---

## 4. 출력: 자동연장예외파일.xlsx (4개 시트)

| 시트명 | 내용 |
|---|---|
| `자동연장예외` | 컬럼 1개(`신청번호`) — 위 로직으로 필터·dedup·정렬된 최종 신청번호 목록 |
| `장기미사용 결과내용` | 장기미사용 입력 파일을 가공 없이 원본 그대로 |
| `중복삭제 결과내용` | 중복정책_삭제 입력 파일을 가공 없이 원본 그대로 |
| `중복공지 결과내용` | 중복정책_공지 입력 파일을 가공 없이 원본 그대로 |

3개의 "결과내용" 시트는 **증빙자료 용도**로, 필터링/가공 없이 원본을 그대로 옮겨 담는다 (F-prefix 필터링·중복제거는 `자동연장예외` 시트를 만드는 계산 과정에만 적용되고, 원본 시트 자체는 변경하지 않음).

---

## 5. 검증용 예시

다음은 실제 구현을 대상으로 실행한 검증 케이스다 (F9999는 Conv에 없어 제거, F2002는 상태값이 91/99가 아니라서 제거되는 것이 핵심 검증 포인트).

**입력**
| 파일 | 데이터 |
|---|---|
| 장기미사용 | `REQUEST_ID`: F1001, F1002, P2001, F1002(중복) |
| 중복삭제 | `Request ID`/`작업구분`: F2001/삭제, F2002/유지, F9999/삭제 |
| 중복공지 | `Request ID`/`작업구분`: F1001/삭제, S3001/삭제, F2003/유지 |
| Conv | `REQUEST_ID`/`REQUEST_STATUS`: F1001/99, F1002/91, F2001/99, F2002/50, F2003/91, S3001/99 |

**단계별 결과**
1. 장기미사용 F-prefix: `F1001, F1002, F1002` (P2001 제외 — F로 시작 안 함)
2. 중복삭제 작업구분==삭제 & F-prefix: `F2001, F9999` (F2002 제외 — 작업구분=유지)
3. 중복공지 작업구분==삭제 & F-prefix: `F1001` (S3001 제외 — F로 시작 안 함, F2003 제외 — 작업구분=유지)
4. 합친 리스트: `F1001, F1002, F1002, F2001, F9999, F1001`
5. Conv 허용집합(91/99): `{F1001, F1002, F2001, F2003, S3001}` (F2002 제외 — 상태 50, F9999는 Conv에 없어 애초에 집합에 없음)
6. 필터링 후: `F1001, F1002, F1002, F2001` (F9999 제거됨)
7. dedup + 정렬 → **최종: `F1001, F2001, F1002` → 정렬 후 `F1001, F1002, F2001`**

이 케이스는 `2026-07-13` 구현 시 실제 프로세서를 실행해 위와 동일한 결과(`F1001, F1002, F2001`)가 나옴을 확인했다.

---

## 6. 파이프라인 등록 위치 (코드 참조)

| 파일 | 변경 내용 |
|---|---|
| `backend/app/services/deletion_workflow/processors/auto_renewal_exception_generator.py` | 신규 — `AutoRenewalExceptionGenerator` 프로세서 |
| `backend/app/services/deletion_workflow/task_meta.py` | `TASK_META[19]` 등록 (Phase 3, `input_count: 4`) |
| `backend/app/services/deletion_workflow/core/pipeline.py` | import + `TaskRegistry` 딕셔너리에 `19` 등록 |
| `backend/app/services/deletion_workflow/core/input_resolver.py` | `task_id == 19` 분기 — 장기미사용은 파일명 패턴 탐색, 나머지는 고정 슬롯(`task_14.output_0/1`, `task_7.output_0`) |
| `frontend/src/components/pages/deletion-workflow/taskMeta.ts` | `PHASE3_TASKS` 배열 신설, `EXECUTION_ORDER`/`ALL_TASK_META`에 반영 |
| `frontend/src/components/pages/deletion-workflow/TaskCard.tsx` | `phase` prop 타입 `1\|2` → `1\|2\|3` |
| `frontend/src/components/pages/DeletionWorkflowDetailPage.tsx` | Phase 3 섹션 렌더링 + 진행률 표시 |

---

## 7. 오류 상황 대처

| 상황 | 원인/확인 사항 |
|---|---|
| "필수 파일 없음: Task 18 / 장기미사용정책(공지용) 파일" | Task 18 실행 결과 중 장기미사용 대상이 0건이면 해당 파일 자체가 생성되지 않음(`_filter_and_save`가 빈 결과는 저장하지 않음). Task 18을 재확인하거나, 장기미사용 대상이 실제로 없는 것이 맞는지 확인 |
| "'REQUEST_ID' 컬럼이 없습니다" (장기미사용 파일) | fpat.yaml/Settings의 `columns.all`이 커스텀 설정되어 있고 그 목록에 `REQUEST_ID`가 빠져있는 경우 (Task 18의 `_filter_and_save`가 지정 컬럼만 남김). 설정에 `REQUEST_ID`를 포함하거나 `columns.all`을 비워 전체 컬럼을 유지하도록 조정 |
| "중복정책_삭제/공지 파일에 '작업구분' 컬럼이 없습니다" | Task 14 결과 파일이 아닌 다른 파일이 잘못 매핑된 경우. `input_resolver.py`의 `task_14, output_0/1` 슬롯이 실제로 공지/삭제 파일인지 확인 |
| "Conv 파일에 'REQUEST_ID' 또는 'REQUEST_STATUS' 컬럼이 없습니다" | Task 7 실행 시 `policy_processing.aggregation.final_columns` 설정에 두 컬럼이 포함되어 있는지 확인 |
| 자동연장예외 시트가 비어있음 | 3개 소스에 F-prefix 신청번호 자체가 없거나, Conv 파일의 91/99 허용집합과 전혀 겹치지 않는 경우 — 원본 3개 "결과내용" 시트를 열어 신청번호 존재 여부부터 확인 |

---

## 8. 보류 사항

- `complete_project`(최종 완료 ZIP) 엔드포인트에 Task 19 산출물 포함 여부는 Phase 3 후속 단계(자동연장예외 요청 후 실제 반영 처리 등)가 확정된 뒤 결정한다. 현재는 미포함.
- REQUEST_STATUS `91`의 정확한 업무적 의미("반영완료 — 추후 자동연장될 대상")는 코드베이스에 문서화된 근거가 없어 담당자 확인으로 채택한 값이다. GSAMS 시스템 스펙 변경 시 재확인 필요.
