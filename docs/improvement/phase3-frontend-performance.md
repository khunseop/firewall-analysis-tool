# Phase 3 — 프론트엔드 성능 (번들 · 렌더링 · 상태관리)

각 항목 완료 후 `npm run build` + `npm run lint` 통과를 기본 검증으로 한다.

---

## 3-1. 라우트 코드 스플리팅 + 번들 정리

- [x] 완료

**대상**: `frontend/src/App.tsx`, `frontend/vite.config.ts`, `frontend/package.json`

**문제**:
- 14개 페이지 전부 정적 import — `React.lazy`/`Suspense`/동적 `import()` 0건. 단일 대형 번들.
- `apexcharts` + `react-apexcharts`가 `DashboardPage.tsx:7-8`에서 정적 import — 대시보드 전용인데 초기 번들 포함.
- `exceljs`(4.4)가 dependencies에 있으나 src에서 import 0건 — 죽은 의존성.
- `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`가 devDependencies에 오분류(런타임 import됨).
- 아이콘 라이브러리 2종 병존(`lucide-react` + `@fortawesome/*`).

**개선 방법**:
1. App.tsx의 페이지 import를 `React.lazy` + `<Suspense fallback={...}>`으로 전환
   (로그인/레이아웃 등 최초 진입 필수 컴포넌트는 정적 유지).
2. `vite.config.ts`에 `build.rollupOptions.output.manualChunks`로
   ag-grid, apexcharts 등 대형 벤더 청크 분리.
3. `exceljs` 제거(`npm uninstall`).
4. devDependencies 오분류 4종을 dependencies로 이동.
5. fortawesome 사용처를 lucide-react로 치환 후 `@fortawesome/*` 제거
   (사용처가 많으면 별도 커밋으로 분리).

**검증**: `npm run build` 후 dist 청크 구성 확인(페이지별 청크 생성 여부),
빌드 전후 초기 로드 JS 크기 비교. 각 페이지 라우팅 이동 시 정상 렌더 확인.

---

## 3-2. AgGridWrapper 렌더링 최적화

- [x] 완료

**대상**: `frontend/src/components/shared/AgGridWrapper.tsx` 및 호출부
(`PoliciesPage.tsx:598`, `DashboardPage.tsx:527`, `DevicesPage.tsx:1133`, `ObjectsPage.tsx:368`, `AnalysisDetailPage.tsx:365`)

**문제**:
- `getRowId`가 각 호출부에서 인라인 정의 — 매 렌더 새 함수 생성.
- `rowData` 변경마다 `requestAnimationFrame`으로 `autoSizeAllColumns`/`sizeColumnsToFit` 실행
  (`AgGridWrapper.tsx:96-107`) — 대량 데이터에서 비용 큼.
- pagination/rowBuffer 등 대량 데이터 튜닝 없음(ClientSideRowModel 전 데이터 메모리 로드).

**개선 방법**:
1. 호출부 `getRowId`를 컴포넌트 밖 상수 또는 `useCallback`으로 안정화.
2. autoSize를 최초 데이터 로드 시 1회만 실행(이후 rowData 갱신 시 스킵),
   또는 `onFirstDataRendered`로 이동.
3. 정책/객체 등 대량 페이지에 `pagination` 활성화 검토(UX 확인 후 결정).
4. 그리드 셀 렌더러 컴포넌트(`DeviceNameCell`, `ResourceWarningBadge` 등) `React.memo` 적용.

**검증**: 대량 정책 장비 조회 시 스크롤/필터 반응성 체감 비교,
React DevTools Profiler로 rowData 갱신 시 리렌더 범위 확인.

---

## 3-3. 서버 상태 단일화 (React Query) + 쿼리키 팩토리

- [x] 완료

**대상**: `frontend/src/store/policySearchStore.ts`, `frontend/src/components/pages/PoliciesPage.tsx:177-186`,
신규 `frontend/src/api/queryKeys.ts`

**문제**:
- `policySearchStore`가 대용량 검색 결과(`policies`/`changeLogEntries`/`validObjectNames`)를
  zustand에 저장 — React Query 캐시와 역할 중복. 새로고침 시 store가 비어
  `PoliciesPage`가 빈 deps `useEffect`(eslint-disable)로 재검색하는 우회 구조.
- `queryKey: ['devices']` 문자열이 8개+ 파일에 하드코딩
  (`PoliciesPage:175`, `ObjectsPage:75`, `SchedulesPage:33`, `DevicesPage:750`,
  `PolicyDiffPage:223`, `DeviceSelector:52`, `DeviceSelectorSingle:54` 등).
  `['network-objects', deviceId]` 등도 동일.
- React Query / zustand / `usePageState`(localStorage) 3중 상태 소스 혼재.

**개선 방법**:
1. `src/api/queryKeys.ts` 신설: `queryKeys.devices.all`, `queryKeys.networkObjects(deviceId)` 등
   팩토리로 정의하고 전 호출부 치환(무효화 호출부 포함 grep 전수 확인).
2. 정책 검색 결과를 `useQuery`(검색 파라미터를 queryKey에 포함)로 이전 —
   store에는 **검색 조건만** 남기고 결과 데이터 저장 제거.
   새로고침 재검색 useEffect 제거(React Query 캐시가 대체).
3. `useDeviceStore`의 미사용 `groups` 기능 사용처 확인 후 죽은 코드면 제거.

**검증**: 정책 검색 → 상세 → 뒤로가기 → 검색 결과 유지 확인.
새로고침 시 동작 확인. 장비 추가/삭제 후 관련 목록 무효화(자동 갱신) 확인.

---

## 3-4. useWebSocket 훅 안정화

- [x] 완료

**대상**: `frontend/src/hooks/useWebSocket.ts`

**문제**:
- 재연결이 고정 5초 간격(`:42`) — 서버 다운 시 무한 재시도, 지수 백오프 없음.
- `onerror` 핸들러 없음, 연결 상태(connected/disconnected)를 컴포넌트에 노출하지 않음.
- 토큰을 URL 쿼리스트링에 노출(`:31`) — 서버 로그에 남을 우려.

**개선 방법**:
1. 지수 백오프(예: 1s → 2s → 4s … 최대 30s) + 성공 시 리셋.
2. `onerror`/`onopen` 처리 및 `isConnected` 상태 반환 — 소비 컴포넌트에서 연결 표시 가능하게.
3. 토큰 전달 방식은 백엔드 WebSocket 인증 방식과 맞물리므로,
   변경 시 백엔드(`websocket_manager.py` 인증부)와 함께 수정 — 범위 커지면 별도 항목으로 분리.

**검증**: 백엔드 재시작 시 재연결 간격이 백오프대로 늘어나는지 콘솔 확인,
재연결 후 동기화 진행 상태 수신 정상 확인.

---

## 완료 기준

- 4개 항목 체크 완료, `npm run build` + `npm run lint` 통과.
- 초기 로드 번들 크기 감소 수치 기록(변경 전후 비교).
- 주요 페이지(정책/장비/객체/대시보드/분석) 스모크 테스트.
