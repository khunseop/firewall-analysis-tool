# Phase 1 — 긴급 수정 (버그 + 최대 성능 레버리지)

코드 변경량은 작지만 정확성과 성능에 미치는 영향이 가장 큰 항목들.
모든 항목은 서로 독립적이며 개별 커밋으로 진행 가능.

---

## 1-1. BackgroundTasks에 닫힌 DB 세션 전달 수정 (버그)

- [ ] 완료

**대상**: `backend/app/api/api_v1/endpoints/analysis.py` (약 :23-37, :167, :191, :216, :238, :261 — 6곳)

**문제**: `db: AsyncSession = Depends(get_db)`로 주입받은 요청 스코프 세션을
`background_tasks.add_task(run_xxx_analysis_task, db, device_id)`로 전달.
`get_db`는 응답 완료 시 세션을 닫으므로, 응답 이후 실행되는 BackgroundTask는
닫힌(또는 닫히는 중인) 세션을 사용하게 된다. 간헐적 실패·커넥션 오류의 원인.

**개선 방법**:
- 각 분석 태스크 함수가 인자로 세션을 받지 않고, 내부에서
  `async with SessionLocal() as db:`로 자체 세션을 연다.
  (`backend/app/services/sync/tasks.py`의 `run_sync_all_orchestrator`가 이미 이 패턴을 사용 — 동일하게 맞춤)
- 엔드포인트에서는 태스크 등록 전 검증(장비 존재 확인 등)에만 요청 세션을 사용.

**검증**: 분석 실행 API 호출 → `analysistasks` 진행률이 정상 갱신되고 완료까지 도달하는지 확인.
서버 로그에 세션 관련 경고/에러 없는지 확인.

---

## 1-2. `Policy` 복합 인덱스 추가 (성능)

- [ ] 완료

**대상**: `backend/app/models/policy.py`, Alembic 마이그레이션

**문제**: 거의 모든 정책 조회가 `WHERE device_id = ? AND is_active = 1`
(`crud_policy.py:21,28,268`)이고 `ORDER BY device_id, vsys, seq, rule_name`(`:278,:674`)로 정렬하는데,
`device_id`는 FK만 있고 명시적 인덱스가 없어 풀스캔 + 정렬 비용 발생.

**개선 방법**:
1. `models/policy.py`에 복합 인덱스 추가:
   `Index("ix_policies_device_active", "device_id", "is_active")`
   (정렬까지 커버하려면 `("device_id", "vsys", "seq")` 추가 검토 — EXPLAIN으로 판단)
2. CLAUDE.md의 DB 스키마 변경 체크리스트 준수:
   스키마 동기화 → `alembic revision --autogenerate -m "add policy device/active index"`
   → 생성 파일 검토 → `python backend/migrate.py` → `DATABASE.md` 갱신.

**검증**: 마이그레이션 적용 후
`EXPLAIN QUERY PLAN SELECT * FROM policies WHERE device_id=? AND is_active=1`이
인덱스를 타는지 확인. 정책 검색 API 응답 시간 비교(대량 데이터 장비 기준).

---

## 1-3. O(n²) 분석 엔진의 이벤트 루프 블로킹 해소 (성능)

- [ ] 완료

**대상**:
- `backend/app/services/analysis/redundancy.py:356-358` — 전 정책 쌍 비교 이중 루프
- `backend/app/services/analysis/impact.py:372, :563-606` — 중첩 정책 비교, `:118-126, :172-218` 멤버 카티전 곱

**문제**: 분석 태스크가 BackgroundTasks(동일 이벤트 루프)에서 실행되는데
내부가 순수 파이썬 O(n²) 루프라, 수천 개 정책이면 루프가 이벤트 루프를 장시간 점유 →
그 동안 모든 API 요청·동기화·WebSocket이 멈춘다.

**개선 방법**:
- CPU 바운드 비교 구간(DB 접근 없는 순수 계산부)을 함수로 분리한 뒤
  `await loop.run_in_executor(None, ...)`로 실행. (1-1 수정과 함께 진행하면 자연스러움)
- 데이터 로드(selectinload) → 순수 계산(executor) → 결과 저장(async)로 3단 분리.
- GIL로 인해 스레드 executor로도 부분적으로만 해소되면 `ProcessPoolExecutor` 검토
  (단, 정책 데이터 직렬화 비용이 있으므로 실측 후 결정 — 우선 스레드로 충분한지 확인).
- 진행률 갱신(`AnalysisTask`)은 계산 루프 밖(청크 경계)에서 수행.

**검증**: 대량 정책 장비로 redundancy/impact 분석 실행 중에
다른 API(`GET /api/v1/devices` 등)가 즉시 응답하는지 확인.
분석 결과가 수정 전과 동일한지 결과 JSON 비교.

---

## 1-4. sync 카운트 쿼리 비효율 제거 (성능, 소규모)

- [ ] 완료

**대상**: `backend/app/services/sync/tasks.py:642-645`

**문제**: 정책 총개수를 세기 위해 전체 row를 `scalars().all()`로 로드한 뒤 `len()` —
수만 건 정책을 카운트 목적으로 전부 메모리에 올림.

**개선 방법**: `select(func.count()).select_from(Policy).where(...)`로 대체.

**검증**: 동기화 실행 후 정책 개수 표시가 기존과 동일한지 확인.

---

## 완료 기준

- 4개 항목 체크 완료, 각 검증 수행.
- `python backend/migrate.py current`로 마이그레이션 적용 상태 확인.
- 동기화 + 분석 전체 플로우 1회 정상 완주.
