# 개선 플랜 (성능 · 리팩토링 · UI)

2026-07-08 코드베이스 전수 조사 결과를 바탕으로 한 순차 개선 플랜.
각 Phase는 독립적으로 실행·검증 가능하며, 완료 시 아래 체크박스를 갱신한다.

## 진행 상태

- [x] [Phase 1 — 긴급 수정 (버그 + 최대 성능 레버리지)](phase1-critical-fixes.md)
- [x] [Phase 2 — 백엔드 리팩토링 · 쿼리 효율](phase2-backend-refactor.md)
- [x] [Phase 3 — 프론트엔드 성능 (번들 · 렌더링 · 상태관리)](phase3-frontend-performance.md)
- [x] [Phase 4 — 프론트엔드 UI 일관성 · 구조 개선](phase4-frontend-ui.md)

## 우선순위 원칙

1. **Phase 1**: 명백한 버그(닫힌 DB 세션을 BackgroundTask에 전달)와
   비용 대비 효과가 가장 큰 성능 개선(복합 인덱스, 이벤트 루프 블로킹 해소)을 최우선 처리.
2. **Phase 2**: 백엔드 검색 쿼리 효율화와 구조적 중복 제거.
   Phase 1과 달리 코드 구조가 바뀌므로 회귀 검증을 동반.
3. **Phase 3**: 프론트엔드 초기 로딩(번들 분할)과 렌더링 성능, 상태관리 단일화.
4. **Phase 4**: UI 일관성(로딩/에러/빈 상태 표준화)과 대형 페이지 분해.
   사용자 체감 품질 개선이지만 기능 변화가 없어 마지막에 배치.

리팩토링(파일 분해, 중복 제거)은 별도 Phase로 빼지 않고
관련 성능/UI 항목과 같은 Phase에 묶어 컨텍스트를 유지한다.

## 공통 규칙

- 코드 파일 1000줄 초과 금지(초과 시 분해), 문서 파일 300줄 초과 금지.
- DB 스키마 변경은 반드시 CLAUDE.md의 체크리스트를 따른다
  (모델 → 스키마 → `alembic revision --autogenerate` → 검토 → `python backend/migrate.py` → DATABASE.md 갱신).
- 각 항목 완료 시 해당 Phase 문서의 체크박스를 갱신하고, 검증 방법을 실제로 수행한다.
- 한 Phase 내 항목들은 문서에 적힌 순서대로 진행을 권장하나, 독립 항목은 순서를 바꿔도 무방하다.

## 조사 요약 (근거)

| 영역 | 핵심 발견 |
|---|---|
| 백엔드 버그 | `endpoints/analysis.py` 6곳에서 요청 스코프 세션을 BackgroundTask에 전달 |
| 백엔드 성능 | `Policy(device_id, is_active)` 복합 인덱스 부재, O(n²) 분석이 이벤트 루프 점유, search_policies 토큰별 쿼리 반복 |
| 백엔드 구조 | CRUD 4개 파일 중복(함수 9개 × 4), `deletion_workflow.py` 1164줄 |
| 프론트 성능 | 코드 스플리팅 0건, `React.memo` 0건, exceljs 죽은 의존성, 상태 3중 관리 |
| 프론트 UI | ErrorBoundary 없음, 로딩/빈/에러 처리 비일관, 1000줄+ 페이지 3개, DeviceSelector 4중 구현 |

## 후속 과제 (플랜 범위 밖 — 필요 시 별도 진행)

- [x] **스키마 드리프트 정리** (2026-07-08 완료): legacy `notifications` 테이블·불용
  `ix_policies_search` 인덱스 드롭, PK 중복 인덱스 선언 제거, NOT NULL/unique 제약 정렬,
  env.py `compare_type=False`. 이제 `alembic autogenerate`가 빈 마이그레이션을 생성한다.
- [x] **WebSocket 토큰 노출** (2026-07-08 완료): 쿠키(access_token) 기반 인증으로 전환,
  쿼리스트링 토큰은 구버전 호환 폴백으로만 유지.
- [x] **usePageState 정리** (2026-07-08 완료): 사용처 0건 죽은 코드 — 삭제.
- [x] **기존 lint 오류** (2026-07-08 완료): 30건 전부 수정 — eslint 0건.
  (다이얼로그 리셋은 렌더 중 상태 조정 패턴으로, QueryBuilder 모델/컴포넌트 분리 등)
- [x] **분석 executor 분리** (2026-07-08 완료): `app/core/executors.py` —
  수집 I/O는 IO_EXECUTOR(8), 분석 CPU는 CPU_EXECUTOR(2)로 분리.
- [x] **deletion_workflow cascade** (2026-07-08 완료): delete_project가 프로젝트 파일을
  함께 삭제하도록 수정 (고아 행 방지).
