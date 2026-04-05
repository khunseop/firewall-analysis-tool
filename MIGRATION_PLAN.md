# FAT Frontend Migration: Vanilla JS → React + Tailwind CSS

## Context

현재 FAT(Firewall Analysis Tool)는 FastAPI가 서빙하는 Vanilla JS + Bulma SPA입니다.
`new_fat_migration_plan.md`에 따라 프론트엔드만 React + Tailwind CSS + shadcn/ui로 전환합니다.
백엔드(FastAPI, 40+ REST/WS 엔드포인트)는 **변경 없음**. 기능 회귀 없이 UI 고도화가 목표입니다.

---

## 현황 파악

| 항목 | 현재 |
|------|------|
| 위치 | `firewall_manager/app/frontend/` (FastAPI `/app` 마운트) |
| 페이지 | 8개 (dashboard, devices, policies, objects, analysis, schedules, settings, deletion_workflow) |
| JS | ~6,800 LOC, hash-based SPA routing (`#/dashboard`) |
| 그리드 | AG Grid Community (모든 페이지) |
| 멀티셀렉트 | Tom Select |
| 차트 | ApexCharts (dashboard) |
| 엑셀 | ExcelJS (클라이언트 생성) |
| 인증 | JWT → localStorage `fat_token` + `access_token` 쿠키 |
| WS | `/api/v1/ws/sync-status?token={jwt}` (dashboard 동기화 상태) |

---

## 타겟 스택

- **빌드**: Vite + React 18 + TypeScript
- **스타일**: Tailwind CSS v3 + shadcn/ui
- **라우팅**: React Router v6 (hash → path 전환)
- **상태**: Zustand (auth/알림) + TanStack Query v5 (API 캐싱)
- **API**: Axios + 기존 엔드포인트 그대로
- **그리드**: `@ag-grid-community/react` (AG Grid 유지, React wrapper만 교체)
- **멀티셀렉트**: react-select
- **차트**: react-apexcharts
- **알림**: Sonner (notification ticker 대체)
- **아이콘**: `@fortawesome/react-fontawesome`

---

## 신규 디렉토리 구조

```
frontend/                        # 프로젝트 루트에 신규 생성
├── public/
│   └── fonts/                   # Pretendard woff 파일 복사 (현재 /app/styles/fonts/)
├── src/
│   ├── main.tsx
│   ├── App.tsx                  # QueryClientProvider + BrowserRouter + Toaster
│   ├── index.css                # Tailwind + font-face + shadcn CSS vars
│   ├── lib/
│   │   ├── utils.ts             # cn() helper
│   │   ├── excelExport.ts       # ExcelJS 클라이언트 내보내기 (utils/excel.js 이식)
│   │   └── analysis/            # 분석 칼럼 정의 + 행 ID 유틸 (utils/analysis/ 이식)
│   ├── api/
│   │   ├── client.ts            # Axios 인스턴스 + 인터셉터
│   │   ├── auth.ts
│   │   ├── devices.ts
│   │   ├── firewall.ts
│   │   ├── analysis.ts
│   │   ├── schedules.ts
│   │   ├── settings.ts
│   │   ├── notifications.ts
│   │   ├── deletionWorkflow.ts
│   │   └── excel.ts             # downloadBlob 헬퍼
│   ├── store/
│   │   ├── authStore.ts         # Zustand: token, setToken, logout
│   │   └── notificationStore.ts # Zustand: notify() (Sonner + backend log)
│   ├── hooks/
│   │   ├── useDevices.ts
│   │   ├── usePolicies.ts
│   │   ├── useObjects.ts
│   │   ├── useAnalysis.ts
│   │   ├── useSchedules.ts
│   │   ├── useSettings.ts
│   │   ├── useDashboardStats.ts
│   │   ├── useDeletionWorkflow.ts
│   │   ├── useWebSocket.ts      # WS 훅 (재연결 로직 포함)
│   │   └── usePageState.ts      # localStorage 상태 유지 (storage.js 대체)
│   └── components/
│       ├── ui/                  # shadcn/ui 자동생성 파일
│       ├── layout/
│       │   ├── AppLayout.tsx    # 네비게이션 쉘
│       │   ├── Navbar.tsx
│       │   └── ProtectedRoute.tsx
│       ├── shared/
│       │   ├── AgGridWrapper.tsx      # AG Grid React 공통 래퍼
│       │   ├── DeviceSelect.tsx       # react-select 장비 선택
│       │   ├── ConfirmDialog.tsx      # promise 기반 확인 다이얼로그
│       │   ├── ObjectDetailModal.tsx  # 객체 상세 모달
│       │   ├── StatusBadge.tsx        # 동기화 상태 뱃지
│       │   └── FileDownloadButton.tsx # Blob 파일 다운로드
│       └── pages/
│           ├── LoginPage.tsx
│           ├── DashboardPage.tsx
│           ├── DevicesPage.tsx
│           ├── PoliciesPage.tsx
│           ├── ObjectsPage.tsx
│           ├── AnalysisPage.tsx
│           ├── SchedulesPage.tsx
│           ├── SettingsPage.tsx
│           └── DeletionWorkflowPage.tsx
└── vite.config.ts
```

---

## 단계별 구현 계획

### Phase 0: 프로젝트 초기화

```bash
# 프로젝트 루트에서
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install tailwindcss@3 postcss autoprefixer
npm install react-router-dom@6 zustand @tanstack/react-query@5 axios sonner
npm install @ag-grid-community/react @ag-grid-community/core @ag-grid-community/client-side-row-model @ag-grid-community/csv-export
npm install react-apexcharts apexcharts react-select exceljs
npm install @fortawesome/react-fontawesome @fortawesome/free-solid-svg-icons @fortawesome/fontawesome-svg-core
npm install -D class-variance-authority clsx tailwind-merge lucide-react tailwindcss-animate
npx shadcn@latest init
npx shadcn@latest add button input label card badge separator tabs dialog alert-dialog select checkbox textarea table tooltip skeleton progress
```

**폰트 이전**: `firewall_manager/app/frontend/styles/fonts/*.woff` → `frontend/public/fonts/`
(현재 `/app/styles/fonts/`에 서빙되던 파일들을 React 빌드에 포함)

**`vite.config.ts`** — 개발 시 API 프록시:
```ts
server: {
  proxy: {
    '/api': 'http://localhost:8000',
    '/ws': { target: 'ws://localhost:8000', ws: true },
  }
}
```

---

### Phase 1: API 레이어

**`frontend/src/api/client.ts`** — Axios 인스턴스:
- 요청 인터셉터: Zustand `authStore.getState().token` → `Authorization: Bearer {token}` 헤더
- 응답 인터셉터: 401 → `authStore.logout()` + `navigate('/login')`
- 에러 unwrap: `err.response.data.detail` → `Promise.reject(detail)`

**각 도메인 모듈**은 현재 `api.js`의 named export를 1:1 매핑:
- `api/devices.ts`: `listDevices`, `getDashboardStats`, `createDevice`, `updateDevice`, `deleteDevice`, `testConnection`, `syncAll`, `getSyncStatus`, `downloadDeviceTemplate`, `bulkImportDevices`
- `api/firewall.ts`: `searchPolicies`, `getPolicies`, `getPolicyCount`, `getNetworkObjects`, `getNetworkGroups`, `getServices`, `getServiceGroups`, `searchObjects`, `getObjectDetails`, `exportToExcel`
- `api/analysis.ts`: `startAnalysis`, `getAnalysisStatus`, `getAnalysisResults`, `getLatestAnalysisResult`
- 나머지는 동일 패턴

**`store/authStore.ts`** — Zustand + persist 미들웨어:
- localStorage 키 `fat_token` 유지 (기존 로그인 상태 보존)
- `setToken()`: localStorage 저장 + `access_token` 쿠키 설정 (FastAPI AuthMiddleware 대응)
- `logout()`: 쿠키 삭제 + 토큰 초기화

---

### Phase 2: 라우팅

Hash routes → 일반 path routes (`BrowserRouter`):

| 구 hash | 신 path |
|---------|---------|
| `#/dashboard` | `/` |
| `#/devices` | `/devices` |
| `#/policies` | `/policies` |
| `#/objects` | `/objects` |
| `#/analysis` | `/analysis` |
| `#/schedules` | `/schedules` |
| `#/settings` | `/settings` |
| `#/deletion-workflow` | `/deletion-workflow` |

`ProtectedRoute`: Zustand token 없으면 `/login`으로 redirect.

---

### Phase 3: 공유 컴포넌트

**`AgGridWrapper.tsx`** — 핵심 공유 컴포넌트:
- `ModuleRegistry.registerModules([ClientSideRowModelModule, CsvExportModule])` 한번만 등록
- `ag-theme-quartz` CSS 임포트
- `defaultColDef`: `resizable`, `filter`, `sortable`
- `onFirstDataRendered`에서 `autoSizeAllColumns` 호출 (현재 `grid.js`의 `createGridEventHandlers` 동작 그대로)
- `ref` forward로 부모에 `gridApi` 노출

**`DeviceSelect.tsx`** — react-select 래퍼:
- `devices: Device[]` → `{ value: id, label: name }` 변환
- `isMulti` prop으로 단일/다중 전환
- Tailwind `classNames` prop으로 스타일링

**`useWebSocket.ts`** — dashboard sync 상태:
```ts
// ws(s)://{host}/api/v1/ws/sync-status?token={jwt}
// reconnect: onclose 시 setTimeout 5초 재연결
// React StrictMode: isMounted ref로 double-invoke 방어
```

---

### Phase 4: 페이지 마이그레이션 순서

복잡도 낮은 순서로 진행 (총 9개 페이지, Deletion Workflow 제외):

1. **LoginPage** — shadcn Card + Input + Button, `useMutation(login)`
2. **AppLayout + Navbar** — 네비게이션 쉘
3. **SettingsPage** — shadcn Tabs(3개) + Form, AG Grid 없음
4. **SchedulesPage** — AG Grid + CRUD Dialog, 가장 단순한 그리드 페이지
5. **DashboardPage** — StatCard, ApexCharts donut, AgGrid + WebSocket
6. **DevicesPage** — AgGrid + DeviceFormDialog + BulkImportDialog + file upload
7. **ObjectsPage** — DeviceSelect(multi) + shadcn Tabs(4개) + AgGrid × 4
8. **PoliciesPage** — DeviceSelect(multi) + PolicySearchModal + AgGrid + ObjectDetailModal
9. **AnalysisPage** — 6가지 분석 타입 조건부 파라미터 UI + status polling + AgGrid

> **Deletion Workflow는 이관 제외**: 특정 고객 전용 서비스로, 별도 일정에 추후 마이그레이션.
> 전환 완료 후에도 `/app/deletion-workflow` 경로는 기존 Vanilla JS로 유지.

**분석 페이지 핵심 패턴**:
- 분석 시작 → `useMutation(startAnalysis)`
- 완료까지 `useQuery(getAnalysisStatus, { refetchInterval: 2000, enabled: isPolling })`
- 완료 시 `getLatestAnalysisResult` 호출 → AgGrid 데이터 업데이트
- 칼럼 정의: `utils/analysis/columns/` → `src/lib/analysis/` TypeScript 이식

---

### Phase 5: FastAPI 연동 (`firewall_manager/app/main.py` 수정)

```python
# 추가할 상수
REACT_DIST_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

# _PUBLIC_PREFIXES 업데이트 (/assets/는 Vite 빌드 결과물)
_PUBLIC_PREFIXES = ("/api/v1/auth/", "/static/", "/docs", "/redoc", "/assets/")

# 기존 /app mount 교체 (신규 React 빌드 서빙)
app.mount("/assets", StaticFiles(directory=str(REACT_DIST_DIR / "assets")), name="react-assets")
app.mount("/fonts", StaticFiles(directory=str(REACT_DIST_DIR / "fonts")), name="fonts")

# 기존 @app.get("/login"), @app.get("/") 대체
# BrowserRouter 지원용 catch-all (api_router include 이후에 선언)
@app.get("/{full_path:path}", include_in_schema=False)
def serve_react(full_path: str):
    return FileResponse(REACT_DIST_DIR / "index.html")
```

**전환 전략 (점진적)**:
1. 초기: React 빌드를 `/react` 경로로 임시 마운트해 기존 `/app`과 병행 테스트
2. 검증 완료 후: catch-all을 `/`로 변경, 기존 `/app` mount와 `/login`, `/`, `/analysis` 라우트 제거

---

## 검증 방법

1. **개발 중**: `cd frontend && npm run dev` → Vite dev server(5173) + FastAPI(8000) 프록시로 전체 기능 테스트
2. **빌드 후**: `npm run build` → `frontend/dist/` 생성 → FastAPI 재시작 → 브라우저에서 각 페이지 접속 확인
3. **기능 체크리스트**:
   - [ ] 로그인 → 쿠키 설정 확인
   - [ ] Dashboard WebSocket 동기화 상태 실시간 업데이트
   - [ ] Devices CRUD + Excel 대량 등록
   - [ ] Policies 고급 검색 + 객체 클릭 → 상세 모달
   - [ ] Objects 4탭 + 멀티 장비 선택
   - [ ] Analysis 6가지 분석 타입 실행 + 결과 조회
   - [ ] Schedules CRUD
   - [ ] 새로고침 후 로그인 상태 유지 (localStorage 토큰)
   - [ ] 401 응답 → 로그인 페이지 자동 리다이렉트

---

## 핵심 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `firewall_manager/app/main.py` | React dist 서빙 + catch-all 라우트 추가 |
| `frontend/` (신규) | React 프로젝트 전체 |
| `firewall_manager/app/frontend/` | 단계적 제거 (전환 완료 후) |
