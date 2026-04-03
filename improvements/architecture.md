# 아키텍처 개선사항

---

## 심각도: 중간

### 1. WebSocket 연결 끊김 시 폴백 없음
- **위치**: `app/services/websocket_manager.py`, `app/frontend/js/` (WebSocket 클라이언트)
- **문제**: WebSocket 연결이 끊기면 프론트엔드가 동기화/분석 진행 상태를 받지 못함. 재연결 로직 없음
- **개선**:
  - 프론트엔드에 자동 재연결 로직 추가 (지수 백오프, 최대 5회)
  - 재연결 실패 시 REST 폴링으로 폴백: `/api/v1/analysis/{task_id}/status` 엔드포인트

### 2. 분석 태스크 큐 메모리 전용
- **위치**: `app/services/analysis/tasks.py`
- **문제**: 실행 중인 분석 태스크 상태가 메모리에만 저장됨. 서버 재시작 시 진행 중이던 분석이 `running` 상태로 DB에 남아 재시작 불가
- **개선**:
  - 서버 시작 시 `running` 상태인 태스크를 `failed`로 초기화하는 startup 훅 추가
  - `app/main.py`의 lifespan 이벤트에서 처리

### 3. 감사 로그 없음
- **위치**: 전체 API 엔드포인트
- **문제**: 장비 자격증명 접근, 정책 데이터 내보내기, 장비 삭제 등 민감한 작업에 대한 기록 없음. 보안 감사나 문제 추적 불가
- **개선**: 인증 구현 후 미들웨어 또는 FastAPI dependency로 `audit_logs` 테이블에 기록
  - 필드: `user_id`, `action`, `resource`, `resource_id`, `ip_address`, `timestamp`

---

## 심각도: 낮음

### 4. 서버 재시작 시 스케줄러 태스크 누락 위험
- **위치**: `app/services/scheduler.py`
- **문제**: APScheduler는 메모리 기반으로 동작. 서버 재시작 시 `sync_schedules` 테이블에서 다시 로드하지만, 재시작 중 놓친 스케줄 실행 여부가 불명확
- **개선**: APScheduler의 `misfire_grace_time` 설정 명시화, 또는 시작 시 마지막 실행 시간 체크 후 누락된 동기화 실행

### 5. SQLite 단일 파일 DB 한계
- **위치**: `app/core/config.py`, `app/db/session.py`
- **문제**: SQLite는 동시 쓰기 제한이 있음. 다수의 동시 동기화 또는 분석 작업 시 `database is locked` 오류 가능
- **개선**:
  - 단기: WAL 모드 활성화 (`PRAGMA journal_mode=WAL`) — 동시 읽기/쓰기 개선
  - 장기: 팀 환경이나 대규모 장비 관리 시 PostgreSQL 전환 검토

### 6. 설정값 분산 관리
- **위치**: `app/core/config.py`, `app/models/settings.py` (Settings DB 테이블)
- **문제**: 일부 설정은 `.env`에, 일부는 DB `settings` 테이블에 저장됨. 어디에 어떤 설정이 있는지 파악 어려움
- **개선**: 설정 계층 문서화 — `.env`(인프라/시크릿), DB settings(운영 설정), 코드 상수(변경 불필요 값)로 명확히 구분
