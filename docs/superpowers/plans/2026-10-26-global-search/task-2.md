> 이 파일은 `docs/superpowers/plans/2026-10-26-global-search.md`의 작업 상세입니다. 같은 폴더 상위 파일의 Global Constraints / Review Focus가 모든 작업에 적용됩니다.

### Task 2: 팔레트 UI와 연결

**Files:**
- Create: `frontend/src/components/shared/GlobalSearch.tsx`
- Modify: `frontend/src/components/layout/AppLayout.tsx`
- Modify: `frontend/src/components/layout/Navbar.tsx` (`NAV_ITEMS` 정의 제거 후 import, 버튼 추가)

**Interfaces:**
- Consumes (Task 1): `searchItems`, `shouldOpenSearch`, `SearchItem`, `SlashContext` from `@/lib/globalSearch`; `listDevices` from `@/api/devices`; `queryKeys.devices`; `useDeviceStore` (`setSelectedIds`) from `@/store/deviceStore`.
- Produces: `GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })`; `Navbar({ onOpenSearch }: { onOpenSearch: () => void })`.

- [ ] **Step 1: `GlobalSearch.tsx` 작성**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { listDevices } from '@/api/devices'
import { queryKeys } from '@/api/queryKeys'
import { useDeviceStore } from '@/store/deviceStore'
import { searchItems, shouldOpenSearch, type SearchItem } from '@/lib/globalSearch'
import { cn } from '@/lib/utils'

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const setSelectedIds = useDeviceStore((s) => s.setSelectedIds)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef<HTMLLIElement>(null)

  // 장비 목록은 팔레트를 처음 열 때 조회(이미 다른 페이지에서 받아 둔 캐시가 있으면 그대로 사용). 로딩·실패 중에도 페이지 항목은 동작한다.
  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices, enabled: open })

  // 열릴 때 입력 초기화 (렌더 중 상태 조정 패턴)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) { setQuery(''); setActiveIndex(0) }
  }

  const { items, hiddenDevices } = useMemo(() => searchItems(query, devices), [query, devices])

  // `/` 키로 열기
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null
      const ok = shouldOpenSearch({
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.isComposing,
        targetTag: t?.tagName ?? '', targetEditable: !!t?.isContentEditable,
        modalOpen: document.querySelector('[role="dialog"], [role="alertdialog"]') !== null,
      })
      if (!ok) return
      e.preventDefault()
      onOpenChange(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onOpenChange])

  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }) }, [activeIndex, items])

  const run = (item: SearchItem | undefined) => {
    if (!item) return
    onOpenChange(false)
    if (item.kind === 'page') {
      navigate(item.to)
    } else {
      setSelectedIds([item.deviceId])
      navigate('/policies')
    }
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return // 한글 조합 확정용 Enter 로는 실행하지 않는다
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length === 0) return
      setActiveIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(items[activeIndex])
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 top-[20%] translate-y-0 overflow-hidden bg-ds-surface-container-lowest">
        <DialogTitle className="sr-only">통합검색</DialogTitle>
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="global-search-list"
          aria-activedescendant={items[activeIndex] ? `global-search-${items[activeIndex].key}` : undefined}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
          onKeyDown={onInputKeyDown}
          placeholder="페이지 또는 장비 검색 (이름, IP, 그룹)"
          className="w-full px-5 py-4 pr-12 text-sm bg-transparent border-b border-ds-outline-variant/20 outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/50"
        />
        <ul id="global-search-list" role="listbox" className="max-h-80 overflow-y-auto py-2">
          {items.length === 0 && (
            <li className="px-5 py-6 text-center text-xs text-ds-on-surface-variant">일치하는 항목이 없습니다</li>
          )}
          {items.map((item, i) => (
            <li
              key={item.key}
              id={`global-search-${item.key}`}
              ref={i === activeIndex ? activeRef : undefined}
              role="option"
              aria-selected={i === activeIndex}
              onMouseMove={() => setActiveIndex(i)}
              onClick={() => run(item)}
              className={cn(
                'flex items-center gap-3 px-5 py-2 text-sm cursor-pointer',
                i === activeIndex ? 'bg-ds-tertiary/8 text-ds-tertiary' : 'text-ds-on-surface',
              )}
            >
              <span className="w-12 shrink-0 text-10 font-bold uppercase tracking-widest text-ds-on-surface-variant/60">
                {item.kind === 'page' ? '페이지' : '장비'}
              </span>
              <span className="flex-1 min-w-0 truncate">{item.label}</span>
              {item.kind === 'device' && (
                <span className="shrink-0 text-11 text-ds-on-surface-variant">{item.sub} · 정책 보기</span>
              )}
            </li>
          ))}
          {hiddenDevices > 0 && (
            <li className="px-5 py-2 text-11 text-ds-on-surface-variant" aria-hidden>장비 {hiddenDevices}개 더 있음 — 검색어를 더 입력하세요</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: `AppLayout.tsx` 수정**

```tsx
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { GlobalSearch } from '@/components/shared/GlobalSearch'

export function AppLayout() {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <div className="min-h-screen flex flex-col bg-ds-surface text-ds-on-surface">
      <div className="fixed top-0 inset-x-0 z-50 h-13">
        <Navbar onOpenSearch={() => setSearchOpen(true)} />
      </div>
      <main className="mt-13">
        <div className="px-4 py-4 md:px-8 md:py-8">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
```

(기존 파일 첫 줄의 `// refresh` 주석은 지우지 말고 그대로 둔다.)

- [ ] **Step 3: `Navbar.tsx` 수정**

1) 파일 상단의 `const NAV_ITEMS = [...]` 블록(6~15행)을 삭제하고 import를 추가한다:

```tsx
import { NAV_ITEMS } from '@/lib/globalSearch'
```

2) `export function Navbar()`를 `export function Navbar({ onOpenSearch }: { onOpenSearch: () => void })`로 바꾼다.

3) "Right" 영역의 첫 구분선(`<div className="w-px h-4 ... mx-2" />`) 바로 앞에 버튼을 추가한다:

```tsx
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors text-ds-on-surface-variant hover:bg-black/5 hover:text-ds-on-surface"
        >
          검색
          <kbd className="px-1.5 py-0.5 rounded border border-ds-outline-variant/30 text-10 font-mono leading-none">/</kbd>
        </button>
```

- [ ] **Step 4: 검증**

Run: `cd /Users/hoon/Code/firewall-analysis-tool/frontend && npx tsc -b && npm run lint && npm run build`
Expected: 모두 오류 없이 종료. 린트가 `react-refresh/only-export-components` 등을 지적하면 해당 규칙에 맞게 고친다(규칙 비활성화 주석으로 넘기지 않는다).

- [ ] **Step 5: 브라우저 수동 확인 (Playwright MCP 사용)**

`npm run dev` + 백엔드 실행 후 로그인된 상태에서 확인한다:

1. 본문에서 `/` → 팔레트 열림, 입력창에 `/`가 들어가지 않음
2. Policies 페이지 검색 입력창에서 `/` 입력 → 팔레트가 열리지 않고 문자가 입력됨
3. 팔레트에서 `pol` → Policies, Policy Diff. `↓` `Enter` → 해당 페이지 이동
4. 장비 이름 일부 입력 → 장비 행 선택 후 Enter → `/policies`로 이동, 장비 선택이 그 장비 하나로 바뀜(Devices 페이지 상단 선택 표시 또는 DeviceSelector로 확인)
5. 일치하는 항목이 없는 검색어 → "일치하는 항목이 없습니다", Enter 눌러도 변화 없음
6. 다른 모달(예: Devices의 장비 추가 다이얼로그)이 열려 있을 때 `/`로 팔레트가 겹쳐 열리지 않음
7. Navbar "검색 /" 버튼 클릭 → 같은 팔레트가 열림, `Esc`로 닫히면 포커스가 원래 요소로 복귀
8. 한글 IME로 `서울` 입력 중 Enter(조합 확정) → 항목이 실행되지 않음 (가능한 환경에서만)

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/shared/GlobalSearch.tsx frontend/src/components/layout/AppLayout.tsx frontend/src/components/layout/Navbar.tsx
git commit -m "통합검색: / 키 팔레트(페이지·장비 바로가기) 추가"
```
