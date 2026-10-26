# 통합검색(`/` 키) 설계

## 목적

어느 화면에서나 `/` 키로 검색 팔레트를 열어 **페이지**와 **장비**로 바로 이동한다.
정책·객체·분석 이력 검색은 범위 밖이다(정책은 Policies 페이지의 범위 기반 검색이 이미 담당).

## 결정 사항

- 프론트엔드만 변경한다. 백엔드·DB 변경 없음.
- 새 라이브러리(`cmdk` 등)를 추가하지 않는다. 기존 `components/ui/dialog.tsx`(Radix Dialog) 위에 만든다.
- 장비 항목 실행 = 해당 장비 **하나만** 전역 선택(`useDeviceStore.setSelectedIds([id])`)하고 `/policies`로 이동. 기존 선택은 대체된다.

## 구성

| 파일 | 역할 |
| :--- | :--- |
| `frontend/src/lib/globalSearch.ts` (신규) | 페이지 목록(`NAV_PAGES`), 항목 타입, 필터·정렬 순수 함수 |
| `frontend/src/components/shared/GlobalSearch.tsx` (신규) | 팔레트 모달 UI, `/` 단축키 리스너 |
| `frontend/src/components/layout/AppLayout.tsx` | `<GlobalSearch />`를 한 번 마운트 (인증된 화면에만 노출) |
| `frontend/src/components/layout/Navbar.tsx` | "검색 `/`" 힌트 버튼 추가. `NAV_ITEMS`를 `lib/globalSearch.ts`의 목록으로 대체해 한 곳에서 관리 |

팔레트 열림 상태는 `GlobalSearch` 내부 상태이다. Navbar 버튼이 열 수 있도록 `AppLayout`이 `open` 상태를 소유하고 두 컴포넌트에 내려준다.

## 열기·닫기

`document`의 `keydown`에서 `/`를 감지하되 다음 경우는 무시한다.

- 포커스가 `input`, `textarea`, `select`, `[contenteditable]`에 있을 때
- Ctrl / Meta / Alt가 함께 눌렸을 때
- 이미 다른 모달(`[role="dialog"]`)이 열려 있을 때
- `event.isComposing`(한글 조합 입력 중)일 때

열릴 때 `preventDefault()`로 `/` 문자가 입력창에 들어가지 않게 한다.
`Esc`, 바깥 클릭, 항목 실행 시 닫힌다. 포커스 복귀는 `dialog.tsx`의 기존 로직이 처리한다.

## 검색 대상과 매칭

| 종류 | 출처 | 매칭 필드 |
| :--- | :--- | :--- |
| 페이지 | `NAV_PAGES` (Dashboard, Devices, Policies, Objects, Analysis, Policy Diff, Schedules, Guide, Notifications, Settings) | 라벨 |
| 장비 | `useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })` 캐시 | 이름, IP, 그룹, 호스트명 |

- 입력을 소문자로 바꾸고 공백으로 나눈 **모든 단어가 포함**되어야 일치(예: `서울 fw`). 퍼지 매칭 없음.
- 정렬: 이름/라벨이 입력으로 시작하는 항목 → 그 외 부분일치. 같은 순위 안에서는 페이지가 장비보다 앞.
- 입력이 비어 있으면 페이지 전체 + 장비는 이름순 상위 몇 개만.
- 장비 표시 상한 8개. 넘으면 "N개 더 있음" 안내 행을 표시(선택 불가).
- 장비 쿼리가 로딩 중이거나 실패해도 팔레트는 열리고 페이지 항목은 동작한다.

## 실행 동작

- 페이지: `navigate(path)`
- 장비: `setSelectedIds([device.id])` 후 `navigate('/policies')`. 행 오른쪽에 "정책 보기" 문구를 표시해 이동 목적지를 알린다.

## 접근성·표시

- `role="combobox"` 입력 + `role="listbox"` 목록, `aria-activedescendant`로 활성 항목 표시.
- `↑↓`로 순환 이동, `Enter` 실행, 마우스 hover 시 해당 항목 활성화.
- 결과가 없으면 "일치하는 항목이 없습니다".
- 기존 디자인 토큰(`ds-*`)과 `dialog.tsx` 스타일을 사용.

## 검증

프론트엔드에 테스트 러너가 없고 이번 작업에서 새로 도입하지 않는다. 대신:

1. `cd frontend && npx tsc -b`, `npm run lint`, `npm run build` 통과
2. 필터·정렬 순수 함수는 `lib/globalSearch.ts`에 분리해 입력/출력만으로 확인 가능하게 하고, 구현 중 임시 스크립트(scratchpad)로 케이스를 돌려 본다: 다중 단어, 대소문자, IP 부분일치, 빈 입력, 상한 초과
3. 브라우저에서 수동 확인: `/`로 열림, 입력창·텍스트 영역에서는 안 열림, 한글 조합 중 안 열림, 모달이 열려 있을 때 안 열림, 장비 선택 후 `/policies`에서 해당 장비만 선택됨

## 범위 밖

정책/객체/분석 이력 검색, 최근 검색 기록, 퍼지 매칭, 백엔드 검색 API, 단축키 사용자 설정.
