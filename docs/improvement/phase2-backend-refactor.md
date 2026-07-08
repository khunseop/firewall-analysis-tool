# Phase 2 — 백엔드 리팩토링 · 쿼리 효율

구조 변경을 동반하므로 항목별로 커밋을 분리하고, 변경 전후 API 응답 동일성을 확인한다.

---

## 2-1. `search_policies` 쿼리 폭증 해소 + 중복 일원화

- [x] 완료

**대상**: `backend/app/crud/crud_policy.py` (683줄)

**문제**:
- 필터 토큰(IP/서비스)마다 개별 `await db.execute` 반복
  (`:349-359, :365-375, :381-408, :416-461, :498-551, :556-609`) — 토큰 수에 비례해 라운드트립 증가.
- 동일한 "토큰 파싱 → 숫자 범위 변환 → 멤버 테이블 쿼리" 블록이 6~8회 인라인 중복.
  `_collect_addr_ids` / `_collect_svc_ids` 헬퍼(`:496-551`)가 있으나 일부 경로만 사용.
- `Policy.id.in_(final_policy_ids)`에 대량 ID 바인딩 시 SQLite 변수 제한(기본 999) 초과 위험 — 청킹 없음.
- 신형(filter_expression 트리, `:274-284`)과 레거시(`:286-683`) 두 검색 경로 공존.

**개선 방법**:
1. 토큰별 개별 쿼리를 `or_(*conditions)` 단일 쿼리로 통합
   (같은 direction/protocol의 범위 조건들을 OR로 묶음).
2. 모든 경로(overlap/exact/only_within/exclude × src/dst)가
   `_collect_addr_ids` / `_collect_svc_ids`를 경유하도록 일원화.
3. `in_()` 바인딩에 청킹 헬퍼 적용
   (`policy_indexer.py:314-318`의 기존 청킹 패턴 재사용).
4. 레거시 경로와 신형 경로의 공유 로직을 정리하되, 레거시 제거는 프론트 사용처 확인 후 별도 판단.

**검증**: 대표 검색 케이스(단일 IP, CIDR, 다중 토큰, exact/exclude 조합)에 대해
변경 전후 결과 policy id 집합이 동일한지 비교 스크립트로 확인. 응답 시간 비교.

---

## 2-2. CRUD 4형제 제네릭 베이스 통합

- [x] 완료

**대상**: `backend/app/crud/crud_network_object.py`, `crud_network_group.py`,
`crud_service.py`, `crud_service_group.py`

**문제**: `get_X_by_name_and_device`, `get_X`, `get_X_by_device`, `get_all_active_X_by_device`,
`create_Xs`, `update_X`, `delete_X`, `count_X_by_device`, `search_X` —
9개 함수가 4개 파일에서 시그니처까지 동일하게 반복(약 36개 함수).

**개선 방법**:
- `backend/app/crud/base.py`에 제네릭 클래스 `CRUDBase[ModelType, CreateSchema, UpdateSchema]` 신설.
- 4개 파일은 `crud_network_object = CRUDBase(NetworkObject)` 형태 + 모델 고유 로직만 유지.
- **호출부 시그니처는 유지**(기존 함수명을 얇은 래퍼로 남기거나 일괄 치환) —
  services/, endpoints/ 전반이 호출하므로 한 번에 바꾸되 grep으로 전수 확인.

**검증**: 객체 CRUD API(생성/조회/검색/삭제) 전체 스모크 테스트.
동기화 1회 실행(create_Xs bulk 경로 검증).

---

## 2-3. `deletion_workflow.py` 1164줄 분해

- [x] 완료

**대상**: `backend/app/api/api_v1/endpoints/deletion_workflow.py` (1164줄 — 코드 한도 1000줄 초과)

**문제**: 엔드포인트 파일에 xlsx 변환/파일 I/O/비즈니스 로직 혼재.
프로젝트 아키텍처(엔드포인트 → 서비스 → CRUD) 위반.

**개선 방법**:
- xlsx 생성·파일 I/O 로직을 `backend/app/services/deletion_workflow/` 하위로 이동
  (기존 프로세서 파이프라인 구조에 편입).
- 엔드포인트는 요청 검증 + 서비스 호출 + 응답 변환만 담당하도록 축소.
- 파일 I/O는 async 규칙 준수(executor 래핑 또는 aiofiles).

**검증**: 삭제 워크플로우 전 단계 실행 + Excel 내보내기 결과물이 기존과 동일한지 확인.

---

## 2-4. `sync/tasks.py` 상태 업데이트 보일러플레이트 정리

- [x] 완료

**대상**: `backend/app/services/sync/tasks.py:453-660` (`run_sync_all_orchestrator`, 260줄 단일 함수)

**문제**: `async with SessionLocal() as db: device 재조회 → update_sync_status → commit`
블록이 8회 이상 반복. 단일 함수가 연결/수집/HA 병합/동기화/인덱싱/상태보고를 전부 담당.

**개선 방법**:
- `async def _update_status(device_id, status, message)` 헬퍼로 상태 갱신 일원화.
- 오케스트레이터를 단계별 함수(connect/collect/transform/persist/index)로 분리하되,
  트랜잭션 경계와 `_run_with_retry` 동작은 그대로 유지(동작 변경 없는 순수 추출).
- HA last_hit_date 병합 pandas 로직(`:297-427`)은 별도 모듈로 추출만 하고 로직 불변.

**검증**: 단일 장비·다중 장비·HA 구성 동기화 각 1회 실행,
WebSocket 진행 상태 브로드캐스트가 기존과 동일한 단계로 수신되는지 확인.

---

## 2-5. `main.py` 정리 (lifespan · SPA 라우팅 일원화)

- [x] 완료

**대상**: `backend/app/main.py`

**문제**:
- `@app.on_event("startup"/"shutdown")`(`:164-174`) — deprecated.
- SPA 라우트 수동 등록(`_SPA_ROUTES`, `:41-51, :142-148`)과 404 catch-all(`:151-161`)이 역할 중복.
  프론트 라우트 추가 시 백엔드 수정 필요한 유지보수 함정.
- 공개 경로 prefix 목록이 `_PUBLIC_PREFIXES`(`:29-38`)와 `:156`에 이중 정의.

**개선 방법**:
- `lifespan` 컨텍스트 매니저로 전환(스케줄러 start/stop 이동).
- `_SPA_ROUTES` 명시 등록 제거, catch-all 핸들러로 일원화
  (API/정적/문서 경로 제외 로직은 `_PUBLIC_PREFIXES` 하나만 참조).
- `_serve_react`의 매 요청 `index.exists()` 체크 제거(기동 시 1회 확인),
  정적 자산에 캐시 헤더 검토.

**검증**: 로그인 → 각 SPA 경로 직접 URL 접근(새로고침) → 미인증 시 `/login` 리다이렉트,
`/docs`, `/api/v1/*` 정상 동작 확인. 서버 기동/종료 시 스케줄러 로그 확인.

---

## 완료 기준

- 5개 항목 체크 완료.
- 동기화 → 검색 → 분석 → 삭제 워크플로우 전체 플로우 1회 정상 완주.
- 1000줄 초과 백엔드 파일 0개 (`find backend/app -name "*.py" | xargs wc -l`).
