# 상용화 준비 로드맵

> 이 문서는 "먼저 문서화 → 순차 진행 → 진행 중 발견되는 추가 개선사항은 이 문서를 갱신한 뒤 이어서 진행"하는 방식의 인덱스 문서입니다. 각 하위 항목이 실제 작업 단계로 구체화되면 `docs/superpowers/plans/<날짜>-<주제>.md`로 별도 실행 계획을 만들고, 아래 표에 링크를 겁니다.

**작성일:** 2026-09-30
**배경:** 콘솔 오류 빈발, tasks 번호 증가 방식에 대한 의문을 계기로 상용화 관점에서 백엔드/프론트 전반을 정적 분석한 결과.

## 진행 방식

1. 이 로드맵에서 다음 순서 항목을 고른다.
2. 해당 항목의 상세 실행 계획 문서를 작성(또는 이미 있으면 갱신)한다.
3. 실행 중 새로 발견된 버그/UX 이슈/개선 포인트는 "발견된 추가 이슈" 섹션에 즉시 기록한다 — 코드부터 고치지 않는다.
4. 완료 후 상태 표를 갱신하고 다음 항목으로 넘어간다.

## 상태 표

| # | 항목 | 우선순위 | 상태 | 상세 계획 |
|---|---|---|---|---|
| 1 | 로그인 무차별 대입 방지 (rate limit/lockout) | 높음 | 완료 | `2026-09-30-security-quick-wins.md` |
| 2 | `/docs`, `/redoc`, OpenAPI 스키마 운영 환경 비공개 | 높음 | 완료 | `2026-09-30-security-quick-wins.md` |
| 3 | 백엔드 로그 영속화 (파일 로테이션) | 높음 | 완료 | `2026-09-30-logging-persistence.md` |
| 4 | 헬스체크 엔드포인트 (`/api/v1/health`) | 중간 | 완료 | `2026-09-30-health-check-endpoint.md` |
| 5 | SQLite 백업 전략 (운영 문서/스크립트) | 중간 | 완료 | `2026-09-30-sqlite-backup.md` |
| 6 | 핵심 모듈(파서/인덱서/삭제 워크플로우) 테스트 추가 | 중간 | 완료 | `2026-09-30-core-module-tests.md` |
| 7 | 인증 토큰 저장 방식 강화 (httpOnly 쿠키 전환) | 낮음 (보류) | 보류 | 아래 "재평가" 참고 |
| 8 | 자잘한 버그 / UX·UI 점검 (상시 병행) | 상시 | 2차 점검 완료 | `2026-09-30-bug-fixes-batch-1.md`, `2026-09-30-bug-fixes-batch-2.md`, `2026-09-30-frontend-ux-review-round2.md` |

## 재평가된 항목

최초 검토 시 "쿠키가 `httpOnly`가 아니라서 XSS 시 토큰 탈취 위험이 있다"는 점을 높은 우선순위로 판단했으나, 실제 코드에서 `dangerouslySetInnerHTML`, `eval`, `new Function` 등 XSS 진입점이 전혀 없는 것을 확인했다(`frontend/src`). React가 기본적으로 이스케이프하므로 현재 시점에서 실제 위험도는 낮다. 반면 httpOnly 전환은 `apiClient`, `downloadBlob`, `downloadBlobPost`, `useWebSocket`, `deletionWorkflow.ts` 등 7개 파일에서 Bearer 헤더 방식을 걷어내는 구조 변경이 필요해 비용 대비 효과가 낮다고 재평가했다. **우선순위를 낮추고, 실제 XSS 벡터가 새로 생기는 시점(예: 사용자 입력을 HTML로 렌더링하는 기능 추가)에 재검토한다.**

또한 최초 검토 시 "백엔드 테스트 1개 존재"로 기록했으나 재확인 결과 `pytest` 자체가 설치되어 있지 않고 테스트 파일도 0개다(오검색이었음). 항목 1·3 작업 중 `pytest` 도입 + `backend/tests/` + `backend/pytest.ini`로 인프라 자체는 이미 마련되었으므로, 항목 6은 "인프라 구축"이 아니라 핵심 모듈에 대한 테스트를 추가하는 작업으로 범위를 좁혔다.

## 발견된 추가 이슈 (진행 중 계속 추가)

- `ENVIRONMENT=production` 설정이 실제 배포 시 누락되지 않도록 `docs/DEVELOPMENT.md`(또는 별도 배포 문서)에 운영 배포 체크리스트로 반영 필요 (항목 2 작업 중 발견, 아직 미착수).
- **실행 환경 버그**: CLAUDE.md/README가 안내하는 `uvicorn app.main:app --reload --app-dir backend` 명령을 시스템 Python(`/opt/homebrew/bin/uvicorn`, greenlet 미설치)으로 실행하면 `ValueError: the greenlet library is required...`로 앱 시작 자체가 실패한다. 프로젝트 루트의 `.venv`로 실행하면 정상 동작한다. 문서에 `.venv` 활성화 단계가 빠져 있어 신규 환경에서 재현 가능성이 높음 — `README.md`/`docs/DEVELOPMENT.md`에 `.venv` 사용법을 명시하는 작업 필요 (아직 미착수).
- **버그 발견 및 수정 완료**: `backend/app/services/firewall/vendors/ngf.py`가 모듈 임포트 시점에 `logging.basicConfig(...)`를 호출해 애플리케이션 전체 루트 로거 설정을 암묵적으로 확정시키고 있었다. 어떤 모듈이 먼저 임포트되느냐에 따라 로그 포맷/핸들러가 달라질 수 있는 재현 어려운 버그의 원인 — 항목 3 작업 중 제거함.
- **버그 발견 및 수정 완료**: `uvicorn.error` 로거는 기본적으로 `propagate=True`라 부모 `uvicorn` 로거로 레코드가 전파된다. 파일 핸들러를 두 로거 모두에 직접 붙이면 로그 한 줄이 두 번 기록되는 버그가 실제 서버 구동 검증 중 발견됨 (`Application shutdown complete.`가 중복 출력) — `uvicorn.error`에는 핸들러를 붙이지 않고 `uvicorn`/`uvicorn.access`의 `propagate`를 명시적으로 `False`로 고정해 해결.
- **버그 발견 및 수정 완료**: `backend/smoke_test.py`(레거시 수동 점검 스크립트)가 pytest 기본 collection 패턴(`*_test.py`)에 걸려, `pytest` 실행 시마다 `fixture 'client' not found` 에러로 실패하고 있었다. `backend/pytest.ini`에 `testpaths = tests`를 지정해 의도한 `tests/` 디렉터리만 수집하도록 해결.

### 항목 8 1차 조사 결과 (백엔드/프론트 병렬 조사, 2026-09-30)

**수정 완료** (→ `2026-09-30-bug-fixes-batch-1.md`):
- **(중간~높음, 백엔드)** `app/services/sync/tasks.py`의 삭제 대상 ID를 `.in_(ids_to_delete)` 4곳에서 청킹 없이 사용 — `policy_indexer.py`는 이미 800개 단위로 청킹하는데 여기만 빠져 있어, 대량 삭제(800개↑)가 포함된 재동기화에서 SQLite 바인딩 변수 한도 초과로 동기화 태스크 전체가 실패할 수 있었다.
- **(높음, 프론트)** `App.tsx`가 `ErrorBoundary`로 `Routes` 전체(로그인 페이지, 네비게이션 포함)를 감싸고 있어, 페이지 하나의 렌더 에러로 네비게이션까지 포함한 화면 전체가 멈추고 강제 새로고침 외엔 우회 방법이 없었다. `ErrorBoundary.tsx` 주석/CLAUDE.md가 말하는 "라우트 레벨" 동작과 실제 구현이 불일치했음.

**백로그 4건도 수정 완료** (→ `2026-09-30-bug-fixes-batch-2.md`):
- `app/api/api_v1/endpoints/settings.py:210-217` — 저장된 설정 JSON 파싱 실패를 `except Exception: pass`로 로그 없이 침묵 처리하던 것을 `logger.exception(...)`으로 남기도록 수정.
- `app/crud/crud_policy.py:390-396` — `_naive_seoul` 헬퍼의 `astimezone` 실패 시 로그 없이 원본 tzinfo로 폴백하던 것을 `logger.exception(...)`으로 남기도록 수정.
- `get_kst_now()`/`_kst_now()` 3중 중복 구현을 `app/core/time_utils.py`로 통합 (analysis/tasks.py, deletion_workflow/tasks.py, deletion_workflow.py 엔드포인트 세 곳 모두 이 공유 함수를 사용하도록 교체).
- `frontend/src/components/pages/policy-builder/ObjectGapPanel.tsx:23` — 하드코딩된 쿼리키를 `queryKeys.ts`의 `policyBuilderObjectGaps` 팩토리로 이동.

### 항목 8 2차 점검 (프론트엔드 UX, 실제 dev 서버 + 실제 Chrome, 2026-09-30)

**수정 완료** (→ `2026-09-30-frontend-ux-review-round2.md`):
- **(높음)** `api/auth.ts`의 `login()`이 `apiClient`를 거치지 않는 원시 axios 호출이라 백엔드가 보내는 한국어 실패 사유(아이디/비밀번호 불일치, 비활성 계정, rate limit 등)가 버려지고 axios 제네릭 영어 메시지("Request failed with status code 401")만 토스트에 노출되고 있었다. 실제 Chrome에서 재현·스크린샷 확인 후 수정.

**재현했으나 원인 미확정 — 후속 조사 필요 (수정 안 함)**:
- 로그아웃 상태에서 처음 로그인할 때 간헐적으로, 대시보드가 정상 렌더링되는 것과 동시에 "Request failed with status code 401" 토스트가 한 번 나타남. 동일 조건 재시도 시 재현 안 됨(React Query 캐시 재사용 추정). 로그인 직후 인증 헤더 없이 나가는 초기 REST 요청이 있는 것으로 의심되나 간헐적이라 근본 원인 미확정 — 매번 스토리지/캐시를 완전히 비운 새 탭에서 재현 시도 필요.

**확인했으나 버그 아님 (참고용)**:
- 모든 401 응답마다 Chrome이 자동으로 남기는 "Failed to load resource: 401" 콘솔 오류는 브라우저 표준 동작이라 억제 불가 — 사용자가 원래 언급한 "콘솔에 가끔 오류가 보인다"의 상당 부분이 이것일 가능성.
- 헤드리스 Playwright에서 Sonner 모듈을 수동 `import`해 `toast.error()`를 직접 호출했을 때 화면에 아무것도 안 뜨는 것처럼 보였으나, 실제 Chrome에서 앱의 실제 코드 경로로 트리거하면 정상 동작 — 테스트 방법론상의 오탐이었음(수동 import가 앱과 다른 모듈 인스턴스를 만든 것으로 추정).
- React Router v7 future-flag 경고 2건은 매 페이지 로드마다 콘솔에 찍히지만 기능 영향 없는 사전 안내성 경고 — 저우선순위, 원하면 `<BrowserRouter future={{...}}>`로 조기 옵트인 가능.

### 사용자 보고 버그 수정 (2026-09-30)

- **수정 완료** (→ `2026-09-30-live-verify-enable-mismatch-fix.md`): Policy Builder(Policies 편집모드)의 "실제 장비 검증"에서 `enable`(활성여부) 필드가 실제 값과 무관하게 항상 불일치로 표시되던 버그. 계획된 정책 행의 `enable`은 DB 컬럼에서 온 Python bool인 반면 장비에서 조회한 candidate 값은 `"Y"`/`"N"` 문자열이라, 단순 `str()` 캐스팅 비교 시 `"True" != "Y"`가 되어 상시 오탐이 발생했다. `_normalize_diff_value()` 헬퍼로 형식을 맞춰 해결.

## 참고: 이미 잘 되어 있는 부분 (재작업 불필요)

- 라우터 단위 `Depends(get_current_user)` 일괄 적용으로 API 인증 누락 없음 (`backend/app/api/api_v1/api.py`).
- WebSocket 인증이 쿠키 우선 + 쿼리 토큰 폴백으로 설계되어 로그 노출 최소화 (`backend/app/api/api_v1/endpoints/websocket.py`).
- SQLite WAL 모드 + `busy_timeout` 설정으로 기본적인 동시성 대비 완료 (`backend/app/db/session.py`).
- IO/CPU 전용 스레드풀 분리로 동기화·분석 상호 기아 방지 (`backend/app/core/executors.py`).
