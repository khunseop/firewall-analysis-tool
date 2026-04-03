# 성능 개선사항

---

## 심각도: 중간

### 1. 정책 검색 N+1 쿼리 패턴
- **위치**: `app/crud/crud_policy.py:131-214`
- **문제**: IP 필터와 서비스 필터를 각각 별도 인덱스 쿼리로 실행한 뒤 Python에서 set 교집합 처리. 각 `parse_ipv4_numeric()` / `parse_port_numeric()` 호출이 동기 함수로 async 컨텍스트에서 실행됨
- **개선**:
  - IP + 서비스 조건을 단일 JOIN 쿼리로 통합
  - 파싱 함수를 쿼리 전에 미리 계산하여 반복 호출 제거
  - 예상 효과: 검색 쿼리 수 50% 감소

### 2. Excel 내보내기 크기 제한 없음
- **위치**: `app/api/api_v1/endpoints/export.py:18-21`
- **문제**: 전체 정책을 메모리에 DataFrame으로 올린 후 BytesIO로 변환. 10만+ 건 내보내기 시 메모리 스파이크 발생 가능
- **개선**:
  - 최대 행 수 제한 (예: 50,000건) + 초과 시 경고 메시지
  - 또는 청크 단위 스트리밍 응답으로 전환
  ```python
  # 개선 예시
  MAX_EXPORT_ROWS = 50000
  if total_count > MAX_EXPORT_ROWS:
      raise HTTPException(400, f"내보내기 한도 초과 ({MAX_EXPORT_ROWS}건). 필터를 적용하세요.")
  ```

### 3. Eager Loading 불일치
- **위치**: `app/crud/crud_analysis.py:54-61`, `app/api/api_v1/endpoints/firewall_query.py:118-148`
- **문제**: 일부 CRUD 함수는 `selectinload()`로 관련 모델을 eager load하지만, 다른 함수는 별도 쿼리로 로드. 코드베이스 전반에 일관성 없음
- **개선**: 연관 모델이 항상 필요한 경우 `selectinload()` 패턴으로 통일. lazy load가 필요한 경우만 명시적으로 구분

---

## 심각도: 낮음

### 4. SQLAlchemy 커넥션 풀 설정 미문서화
- **위치**: `app/db/session.py`
- **문제**: 동시 사용자 증가 시 커넥션 풀 설정(pool_size, max_overflow, pool_recycle) 미조정 상태
- **개선**: SQLite는 단일 커넥션이므로 현재는 큰 문제 없으나, 향후 PostgreSQL 전환 시 pool 설정 추가 필요. 현재 설정을 주석으로 문서화

### 5. 장비 동기화 세마포어 설정 검토
- **위치**: `app/services/sync/tasks.py`
- **문제**: `run_sync_all_orchestrator`의 동시 실행 세마포어 값이 하드코딩되어 있을 수 있음
- **개선**: 세마포어 값을 설정(`.env` 또는 Settings 테이블)에서 읽도록 변경
