# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**FAT(Firewall Analysis Tool)** — 멀티 벤더 방화벽 정책 통합 관리 웹 도구.

- **백엔드**: FastAPI + SQLAlchemy + SQLite (`backend/fat.db`) + Alembic
- **프론트엔드**: React 19 + TypeScript + Vite + Tailwind CSS + Ag-Grid
- **지원 벤더**: Palo Alto (XML API + SSH, HA 지원), SECUI MF2 (SSH), SECUI NGF (REST API), Mock

---

## 명령어

### 백엔드

```bash
# 의존성 설치
pip install -r backend/requirements.txt

# DB 마이그레이션 (프로젝트 루트에서 실행)
python backend/migrate.py

# 서버 실행 — 반드시 프로젝트 루트에서 실행
uvicorn app.main:app --reload --app-dir backend

# 특정 마이그레이션 확인
python backend/migrate.py current
python backend/migrate.py history base:head
```

### 프론트엔드

```bash
cd frontend

npm install
npm run dev       # 개발 서버 (Vite)
npm run build     # 프로덕션 빌드 (tsc + vite build)
npm run lint      # ESLint
npm run preview   # 빌드 결과물 미리보기
```

### 프로덕션 통합 실행

프론트엔드를 `npm run build`로 빌드하면 `frontend/dist/`가 생성되고, FastAPI가 이를 직접 서빙합니다. 개발 중에는 Vite dev 서버(`localhost:5173`)와 백엔드(`localhost:8000`)를 별도로 실행하며, Vite의 프록시 설정으로 `/api/v1`을 백엔드로 라우팅합니다.

---

## 아키텍처

### 전체 구조

```
API Endpoints  (backend/app/api/api_v1/endpoints/)
      ↓
Services       (backend/app/services/)
      ↓
CRUD / DAO     (backend/app/crud/)
      ↓
ORM Models     (backend/app/models/)  ──►  SQLite fat.db (via Alembic)
```

### 백엔드 핵심 서브시스템

| 서브시스템 | 위치 | 역할 |
|---|---|---|
| 멀티 벤더 추상화 | `app/services/firewall/` | `FirewallInterface` → Factory → 벤더별 구현. 런타임에 올바른 벤더 결정 |
| 동기화 오케스트레이터 | `app/services/sync/tasks.py` → `run_sync_all_orchestrator` | connect → collect → transform → DB upsert → index → broadcast 파이프라인 |
| 정책 인덱서 | `app/services/policy_indexer.py` | DFS 기반 그룹 재귀 확장(Resolver), IP/포트를 숫자 범위로 변환, bulk 인덱싱 |
| 범위 기반 검색 | `app/crud/crud_policy.py` | `policy_address_members` / `policy_service_members` overlap SQL 쿼리 |
| 분석 엔진 | `app/services/analysis/` | 6개 비동기 엔진 (`redundancy`, `unused`, `impact`, `unreferenced_objects`, `risky_ports`, `over_permissive`). 백그라운드 태스크는 자체 `SessionLocal()` 세션을 열고, CPU 비교 연산은 `CPU_EXECUTOR`에서 실행. `analysistasks` 테이블로 진행률 추적, 결과는 JSON 저장 |
| 삭제 워크플로우 | `app/services/deletion_workflow/` | Config 기반 프로세서 파이프라인. DB→Excel 변환은 `export_service.py`, 설정 연동은 `config_bridge.py`, 태스크 메타는 `task_meta.py` |
| 공용 CRUD | `app/crud/base.py` | 장비 스코프 객체(NetworkObject/Group, Service/Group) 4종의 공통 CRUD 제네릭. 각 `crud_*` 모듈은 얇은 래퍼 |
| 전용 스레드 풀 | `app/core/executors.py` | `IO_EXECUTOR`(수집 SSH/API, 8) / `CPU_EXECUTOR`(분석 연산, 2) — 기본 풀 공유로 인한 상호 굶김 방지 |
| 스케줄러 | `app/services/scheduler.py` | APScheduler. 스케줄은 `sync_schedules` 테이블에 영속 저장 |
| WebSocket 매니저 | `app/services/websocket_manager.py` | 동기화·분석 진행 상태를 모든 클라이언트에 브로드캐스트. 인증은 `access_token` 쿠키 (쿼리 토큰은 폴백) |

### 프론트엔드 구조

- **라우팅**: React Router v6. 페이지는 `App.tsx`에서 `React.lazy` + `Suspense`로 코드 스플리팅되며, 라우트 레벨 `ErrorBoundary`가 렌더 에러를 폴백 UI로 처리. `ProtectedRoute`가 인증 상태 검사
- **상태 관리**:
  - 서버 상태는 TanStack React Query가 단일 소스 (staleTime 30초). 쿼리키는 반드시 `src/api/queryKeys.ts` 팩토리 사용 — 문자열 하드코딩 금지
  - `useAuthStore` (Zustand + persist): JWT 토큰을 localStorage + cookie 이중 저장 (cookie는 백엔드 AuthMiddleware·WebSocket 인증용)
  - `useDeviceStore` (Zustand + persist): 선택된 장비 ID 목록
  - `usePolicySearchStore` (Zustand + persist): 정책 검색 **조건만** 저장 (결과는 React Query 캐시 — persist된 `searchRequest`로 새로고침 시 쿼리 자동 재실행)
  - 토스트+알림 기록: `src/lib/notify.ts`의 `notify()` 헬퍼
- **API 레이어**: `src/api/client.ts` — axios 인스턴스. 요청 인터셉터에서 Bearer 토큰 주입, 401 응답 시 자동 로그아웃 및 `/login` 리다이렉트. 파일 다운로드는 `saveBlob`/`downloadBlob`/`downloadBlobPost` 헬퍼로 일원화
- **실시간 통신**: `src/hooks/useWebSocket.ts` — `useSyncStatusWebSocket` 훅. 쿠키 기반 인증, 지수 백오프(1s→최대 30s) 재연결, `isConnected` 반환
- **UI 컴포넌트**: `src/components/ui/` (Radix UI 기반 shadcn 스타일), `src/components/shared/` (도메인 공유 — `ErrorBoundary`, `EmptyState`, `DeviceSelector` 등)
- **페이지 하위 구조**: 대형 페이지는 디렉터리로 분해 — `pages/settings/`(탭별), `pages/devices/`(다이얼로그·그리드 셀), `pages/deletion-workflow/`(태스크 카드)
- **그리드**: Ag-Grid Community Edition (`AgGridWrapper.tsx`). `getRowId`는 렌더마다 새 함수가 생기지 않도록 모듈 레벨로 정의 (`lib/utils.ts`의 `rowIdFromId`)

### FastAPI SPA 서빙 방식

`backend/app/main.py`의 `AuthMiddleware`가 쿠키의 `access_token`으로 인증을 검사하고 미인증 요청을 `/login`으로 리다이렉트합니다. 빌드된 React 정적 파일은 `/assets`, `/fonts` 경로로 마운트되며, SPA 클라이언트 라우트는 개별 등록 없이 404 catch-all 핸들러가 `index.html`로 폴백합니다 (프론트 라우트 추가 시 백엔드 수정 불필요). 스케줄러 기동/종료는 `lifespan` 컨텍스트에서 처리합니다.

---

## 핵심 제약

- **DB 스키마 변경**: `fat.db` 직접 수정 금지. 반드시 Alembic 마이그레이션 사용 (`alembic revision --autogenerate`).
- **비밀번호 처리**: `app/core/security.py`의 `encrypt_password` / `decrypt_password`만 사용.
- **백엔드 임포트**: `app/` 루트 기준 절대 경로 사용.
  - ✅ `from app.services.sync.tasks import run_sync_all_orchestrator`
  - ❌ `from services.sync.tasks import ...`
- **uvicorn 실행 위치**: 반드시 프로젝트 루트에서 `--app-dir backend` 옵션으로 실행.
- **모든 I/O 작업**: `async/await`로 처리하여 이벤트 루프를 차단하지 않을 것. 동기 라이브러리 호출은 `run_in_executor`로 감싸되, 수집 I/O는 `IO_EXECUTOR`, CPU 연산은 `CPU_EXECUTOR`(`app/core/executors.py`) 사용.
- **벌크 연산**: 수만 건 이상은 `bulk_insert_mappings` 사용. SQLite IN 절 바인딩은 800개 단위 청킹.
- **BackgroundTasks**: 요청 스코프 세션(`Depends(get_db)`)을 전달하지 말 것 — 태스크 내부에서 자체 `SessionLocal()`을 열 것.
- **프론트 쿼리키**: React Query 쿼리키는 `src/api/queryKeys.ts` 팩토리만 사용.

## DB 스키마 변경 체크리스트

1. `app/models/`의 ORM 모델 수정
2. `app/schemas/`의 Pydantic 스키마 동기화
3. `alembic revision --autogenerate -m "변경 설명"` 실행 (프로젝트 루트에서)
4. 생성된 마이그레이션 파일 검토
5. `python backend/migrate.py` 적용
6. `DATABASE.md` 업데이트

## 확장 패턴

- **새 벤더 추가**: `app/services/firewall/` 내 `FirewallInterface`를 상속 구현 후 Factory에 등록.
- **새 분석 엔진 추가**: `app/services/analysis/`에 추가. `AnalysisTask`로 상태를 관리하고 결과를 JSON으로 저장.

## 블라스트 레이디어스 주의 (수정 파급 범위)

다음 파일들은 여러 곳에서 참조되는 공유/싱글턴 모듈이므로, 수정 시 참조하는 모든 곳을 확인할 것:

- `frontend/src/api/queryKeys.ts` — 거의 모든 페이지의 React Query 캐시 키가 여기서 파생됨. 키 구조 변경 시 캐시 무효화/재조회 동작이 전역적으로 바뀔 수 있음.
- `backend/app/core/executors.py` (`IO_EXECUTOR`/`CPU_EXECUTOR`) — 동기화·분석 전 엔진이 공유. 풀 크기나 사용 executor를 바꾸면 관련 없어 보이는 다른 파이프라인의 처리량에 영향.
- `backend/app/services/websocket_manager.py` — 동기화·분석 진행 상태 브로드캐스트를 전담. 메시지 포맷 변경 시 프론트 `useSyncStatusWebSocket` 소비 측도 함께 확인.
- `backend/app/services/sync/tasks.py`의 `run_sync_all_orchestrator` — 전체 동기화 파이프라인의 오케스트레이터. 여기 로직 변경은 모든 벤더의 동기화 흐름에 영향.

큰 이관/리팩토링 직후에는 diff를 다시 검토해 로직이 누락되지 않았는지 확인할 것(예: 과거 FPAT 이관 작업 중 예외처리·신청유형 제한 로직이 유실되었다가 나중에 복원된 사례 있음).
