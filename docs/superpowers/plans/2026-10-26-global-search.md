# 통합검색(`/` 키) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어느 화면에서나 `/` 키로 검색 팔레트를 열어 페이지와 장비로 바로 이동한다.

**Architecture:** 필터·정렬·단축키 판정은 DOM에 의존하지 않는 순수 함수(`lib/globalSearch.ts`)로 분리하고, UI(`GlobalSearch.tsx`)는 기존 Radix 기반 `ui/dialog.tsx` 위에 얹는다. 열림 상태는 `AppLayout`이 소유해 `/` 키와 Navbar 버튼이 같은 팔레트를 연다.

**Tech Stack:** React 19, TypeScript, React Router v6, TanStack React Query, Zustand(`useDeviceStore`), Radix Dialog, Tailwind. 프론트엔드만 변경.

**Spec:** `docs/superpowers/specs/2026-10-26-global-search-design.md`

## Global Constraints

- 새 라이브러리 추가 금지(`cmdk` 등). 백엔드·DB 변경 금지.
- React Query 쿼리키는 `src/api/queryKeys.ts`의 `queryKeys.devices`만 사용(문자열 하드코딩 금지).
- 장비 항목 실행 = `useDeviceStore.setSelectedIds([device.id])` 후 `/policies`로 이동(기존 선택 대체).
- 장비 결과 표시 상한 8개, 초과분은 "N개 더 있음" 안내 행(선택 불가).
- `/`는 input / textarea / select / contenteditable 포커스, Ctrl·Meta·Alt 조합, 다른 모달 열림, 한글 조합 입력(`isComposing`) 중에는 열지 않는다.
- 테스트 러너가 없으므로 도입하지 않는다. 순수 함수는 scratchpad 임시 스크립트(`node --experimental-strip-types`)로 검증한다.
- 프론트 검증 명령: `cd frontend && npx tsc -b && npm run lint && npm run build`.
- 코드 파일 1000줄 제한, 문서 파일 300줄 제한.

## Review Focus

1. 장비의 `group` / `hostname`이 `null` → 필터가 터지지 않고 해당 필드만 건너뛴다. (Task 1 테스트)
2. 공백만 입력 → 빈 입력과 동일하게 취급(전체 페이지 + 장비 상위 8개). (Task 1 테스트)
3. 이름이 같은 장비 두 대 → 서로 다른 `key`(id 기반)로 렌더되어 React key 충돌이 없다. (Task 1 테스트)
4. 결과 0건에서 Enter / 필터 변경으로 활성 인덱스가 범위를 벗어남 → 아무 일도 안 일어나고 크래시 없음. (Task 2 구현 + 수동 확인)
5. 한글 조합 중 Enter / `/` → 실행·열림이 일어나지 않는다. (Task 1 `shouldOpenSearch` 테스트 + Task 2 `isComposing` 가드)

## File Structure

| 파일 | 책임 |
| :--- | :--- |
| `frontend/src/lib/globalSearch.ts` (신규) | 페이지 목록, 검색 항목 타입, `searchItems`, `shouldOpenSearch`. DOM·React 의존 없음 |
| `frontend/src/components/shared/GlobalSearch.tsx` (신규) | 팔레트 UI, `/` 키 리스너, 항목 실행 |
| `frontend/src/components/layout/AppLayout.tsx` (수정) | `open` 상태 소유, `GlobalSearch` 마운트, Navbar에 `onOpenSearch` 전달 |
| `frontend/src/components/layout/Navbar.tsx` (수정) | `NAV_ITEMS`를 lib에서 import, "검색 /" 버튼 추가 |
| `CLAUDE.md` (수정) | 프론트 구조에 한 줄 추가 |

## Tasks

실행 순서대로 진행한다. Task 1·2는 코드가 길어 별도 파일로 분리했다(문서 300줄 제한).

1. [Task 1: 검색 순수 함수](2026-10-26-global-search/task-1.md) — `lib/globalSearch.ts` + scratchpad 검증 스크립트
2. [Task 2: 팔레트 UI와 연결](2026-10-26-global-search/task-2.md) — `GlobalSearch.tsx`, `AppLayout.tsx`, `Navbar.tsx`
3. Task 3: 문서 반영 (아래)

---

### Task 3: 문서 반영

**Files:**
- Modify: `CLAUDE.md` (프론트엔드 구조 > UI 컴포넌트 항목 아래)

- [ ] **Step 1: 한 줄 추가**

`CLAUDE.md`의 "**UI 컴포넌트**" 줄 바로 아래에 추가:

```
- **통합검색**: `/` 키(또는 Navbar 검색 버튼)로 여는 팔레트 — `components/shared/GlobalSearch.tsx`. 필터·정렬·단축키 판정은 DOM 비의존 순수 함수 `lib/globalSearch.ts`에 있고, Navbar 메뉴 목록(`NAV_ITEMS`)도 여기서 관리. 장비 항목 실행은 `useDeviceStore`에 해당 장비 하나만 선택하고 `/policies`로 이동
```

- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: 통합검색 구조 반영"
```
