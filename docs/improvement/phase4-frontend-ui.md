# Phase 4 — 프론트엔드 UI 일관성 · 구조 개선

기능 변화 없는 구조·일관성 개선. 항목별 커밋 분리, 완료 후 화면 회귀 확인.

---

## 4-1. 공통 상태 컴포넌트 도입 (ErrorBoundary · EmptyState · 로딩 표준화)

- [x] 완료

**대상**: 신규 `frontend/src/components/shared/ErrorBoundary.tsx`, `EmptyState.tsx`,
기존 `shared/Skeleton.tsx` vs `ui/skeleton.tsx`

**문제**:
- ErrorBoundary 0건 — 렌더 에러 시 화이트스크린.
- 빈 상태 문구 40건 하드코딩 분산, 에러 상태 렌더 59건 산재(누락 포함), 로딩 표현 파일마다 제각각.
- 스켈레톤 컴포넌트 2종 병존.

**개선 방법**:
1. `ErrorBoundary` 신설, `App.tsx` 라우트 레벨에 적용(3-1의 Suspense와 함께 배치).
2. `EmptyState`(아이콘 + 문구 + 선택적 액션 버튼) 신설, 하드코딩 빈 상태를 점진 치환
   — 우선 주요 페이지(정책/장비/객체/분석)부터.
3. 스켈레톤을 `ui/skeleton.tsx`로 일원화, `shared/Skeleton.tsx` 사용처 치환 후 제거.
4. 페이지 공통 패턴 "isLoading → Skeleton / isError → 에러 표시 / 빈 배열 → EmptyState"를
   정리한 가이드 주석 또는 래퍼(`QueryStateGate` 등)를 도입하되 과추상화 주의 —
   래퍼가 3개 이상 페이지에 자연스럽게 맞을 때만 도입.

**검증**: 의도적 렌더 에러 발생 시 ErrorBoundary 폴백 표시,
API 실패/빈 결과 시 각 페이지 표시 일관성 육안 확인.

---

## 4-2. 1000줄+ 페이지 3개 분해

- [x] SettingsPage 완료
- [x] DevicesPage 완료
- [x] DeletionWorkflowDetailPage 완료

**대상**:
- `frontend/src/components/pages/SettingsPage.tsx` (1275줄, 인라인 컴포넌트 9개)
- `frontend/src/components/pages/DevicesPage.tsx` (1253줄, 인라인 컴포넌트 8개)
- `frontend/src/components/pages/DeletionWorkflowDetailPage.tsx` (1250줄)

**개선 방법** (순수 파일 분해 — 로직 변경 금지):
1. `SettingsPage`: 탭별 파일로 분리 → `pages/settings/` 디렉터리에
   `GeneralSettings.tsx`, `RiskyPortsSettings.tsx`, `AccountSettings.tsx`, `LogSettings.tsx`,
   `DeletionWorkflowSettings.tsx` 등. 공용 하위 컴포넌트(`ExceptionTable`, `DeviceSearchSelect`,
   `DuplicatePolicyTable`)는 같은 디렉터리에 개별 파일로.
2. `DevicesPage`: 다이얼로그 4종(`DeviceFormDialog`, `BulkOptionsDialog`, `BulkGroupDialog`,
   `DirectExportDialog`)과 셀 컴포넌트를 `pages/devices/` 하위로 분리.
   분리하면서 셀 컴포넌트에 `React.memo` 적용(3-2와 연계).
3. `DeletionWorkflowDetailPage`: `TaskCard`, `Task0Section`, `ExternalFileUpload`,
   유틸 함수를 `pages/deletion-workflow/` 하위로 분리.
4. 분해 후 각 파일 1000줄 이하 확인.

**검증**: 분해 전후 각 페이지 전 기능(탭 전환, 다이얼로그 열기/저장, 워크플로우 단계 진행)
동작 동일 확인. `npm run build` + `npm run lint` 통과.

---

## 4-3. DeviceSelector 4중 구현 통합

- [x] 완료

**대상**: `frontend/src/components/shared/DeviceSelect.tsx`, `DeviceSelector.tsx`,
`DeviceSelectorSingle.tsx`, `GroupedDeviceMultiSelect.tsx`

**문제**: 장비 선택 컴포넌트 4종 병존. 특히 `DeviceSelector`(멀티)와
`DeviceSelectorSingle`(단일)은 `VENDOR_DOT` 맵, `DeviceItem` 등이 복붙 수준으로 동일.

**개선 방법**:
1. 1단계: `DeviceSelector` + `DeviceSelectorSingle`을 `mode: 'single' | 'multi'` prop을 가진
   단일 컴포넌트로 통합. 공유 부품(`VENDOR_DOT`, `DeviceItem`)은 파일 내 공통화.
2. 2단계: `DeviceSelect.tsx`(react-select 기반)와 `GroupedDeviceMultiSelect.tsx`의
   사용처를 확인해 통합 컴포넌트로 흡수 가능하면 치환, 그룹 선택 요구가 다르면 유지.
   react-select 의존 제거 가능 여부도 이때 판단.
3. 사용처 치환: `ObjectsPage`, `PoliciesPage`, `DashboardPage`, `AnalysisListPage`,
   `DeletionWorkflowListPage`, `SchedulesPage`.

**검증**: 각 사용 페이지에서 장비 선택(단일/멀티/그룹) 동작 및 선택 상태 유지 확인.

---

## 4-4. 잡무 정리 (다운로드 헬퍼 · 네이밍)

- [x] 완료

**대상**: `frontend/src/api/client.ts`, `firewall.ts:276,303`, `deletionWorkflow.ts`, `devices.ts`,
`frontend/src/store/notificationStore.ts`

**문제**:
- blob → `a.click()` 다운로드 패턴이 `client.ts`의 `downloadBlob`/`downloadBlobPost` 외에
  API 모듈들에서 개별 반복.
- `notificationStore.ts`는 store가 아니라 `notify()` 헬퍼 — 네이밍 부정확.

**개선 방법**:
1. 다운로드 로직을 `client.ts` 헬퍼로 일원화, 개별 구현 치환.
2. `notificationStore.ts` → `lib/notify.ts` 등으로 이동/개명(import 경로 일괄 치환).

**검증**: 각 다운로드 기능(정책 내보내기, 워크플로우 Excel 등) 정상 동작,
toast 알림 정상 표시.

---

## 완료 기준

- 전 항목 체크 완료, 1000줄 초과 tsx 파일 0개
  (`find frontend/src -name "*.tsx" | xargs wc -l | sort -n`).
- `npm run build` + `npm run lint` 통과.
- 전 페이지 육안 회귀 확인(로딩/에러/빈 상태 포함).
