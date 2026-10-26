> 이 파일은 `docs/superpowers/plans/2026-10-26-global-search.md`의 작업 상세입니다. 같은 폴더 상위 파일의 Global Constraints / Review Focus가 모든 작업에 적용됩니다.

### Task 1: 검색 순수 함수 (`lib/globalSearch.ts`)

**Files:**
- Create: `frontend/src/lib/globalSearch.ts`
- Scratch test (저장소에 넣지 않음): `/private/tmp/claude-501/-Users-hoon-Code-firewall-analysis-tool/4d0d4f7a-9575-4f79-900d-c5cced1d20c5/scratchpad/globalSearch.check.ts`

**Interfaces:**
- Consumes: `Device` 타입(`@/types/device`: `id`, `name`, `ip_address`, `group: string | null`, `hostname: string | null`).
- Produces (Task 2가 사용):
  - `NAV_ITEMS: { to: string; label: string; end?: boolean }[]` — Navbar 상단 메뉴 8개
  - `SEARCH_PAGES: { to: string; label: string }[]` — `NAV_ITEMS` + Notifications + Settings
  - `type SearchItem = { kind: 'page'; key: string; label: string; to: string } | { kind: 'device'; key: string; label: string; sub: string; deviceId: number }`
  - `MAX_DEVICES = 8`
  - `searchItems(query: string, devices: Device[]): { items: SearchItem[]; hiddenDevices: number }`
  - `shouldOpenSearch(ctx: SlashContext): boolean`, `interface SlashContext { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; targetTag: string; targetEditable: boolean; modalOpen: boolean }`

- [ ] **Step 1: 실패하는 검증 스크립트 작성**

`globalSearch.check.ts` (위 scratchpad 경로)를 만든다. 이 파일은 실행 시 `lib/globalSearch.ts`가 없으므로 실패한다.

```ts
import assert from 'node:assert/strict'
import { searchItems, shouldOpenSearch, NAV_ITEMS, SEARCH_PAGES, MAX_DEVICES } from '/Users/hoon/Code/firewall-analysis-tool/frontend/src/lib/globalSearch.ts'

const dev = (id: number, name: string, ip: string, group: string | null = null, hostname: string | null = null) =>
  ({ id, name, ip_address: ip, group, hostname }) as never

const devices = [
  dev(1, 'FW-Seoul-01', '10.0.0.1', '서울DC', 'seoul-fw1'),
  dev(2, 'FW-Busan-01', '10.1.0.1', '부산DR', null),
  dev(3, 'fw-seoul-02', '10.0.0.2', null, null),
]
const labels = (r: ReturnType<typeof searchItems>) => r.items.map((i) => i.label)

// 네비게이션 목록
assert.equal(NAV_ITEMS.length, 8)
assert.equal(SEARCH_PAGES.length, 10)

// 빈 입력 / 공백만: 페이지 10개 + 장비 전부(이름순)
for (const q of ['', '   ']) {
  const r = searchItems(q, devices)
  assert.equal(r.items.filter((i) => i.kind === 'page').length, 10)
  assert.deepEqual(r.items.filter((i) => i.kind === 'device').map((i) => i.label), ['fw-seoul-02', 'FW-Busan-01', 'FW-Seoul-01'].sort((a, b) => a.localeCompare(b)))
  assert.equal(r.hiddenDevices, 0)
}

// 대소문자 무시 + 페이지 매칭
assert.deepEqual(labels(searchItems('POLI', [])), ['Policies', 'Policy Diff'])

// 다중 단어는 모두 포함해야 함 (이름 + 그룹)
assert.deepEqual(labels(searchItems('서울 fw', devices)), ['FW-Seoul-01'])

// IP 부분일치, 호스트명 일치
assert.deepEqual(labels(searchItems('10.1.', devices)), ['FW-Busan-01'])
assert.deepEqual(labels(searchItems('seoul-fw1', devices)), ['FW-Seoul-01'])

// null group/hostname 이어도 터지지 않는다
assert.doesNotThrow(() => searchItems('x', devices))

// 앞에서부터 일치하는 항목이 먼저, 같은 순위에서는 페이지가 장비보다 앞
const r2 = searchItems('fw', devices)
assert.ok(r2.items.every((i) => i.kind === 'device'))
assert.equal(r2.items[0].label.toLowerCase().startsWith('fw'), true)

// 같은 이름 장비도 key 가 서로 다르다
const dup = searchItems('dup', [dev(10, 'dup', '1.1.1.1'), dev(11, 'dup', '1.1.1.2')])
assert.equal(new Set(dup.items.map((i) => i.key)).size, 2)

// 장비 상한 8개 + 나머지 개수
const many = Array.from({ length: 12 }, (_, i) => dev(i + 1, `host-${String(i).padStart(2, '0')}`, `10.0.1.${i}`))
const rm = searchItems('host', many)
assert.equal(rm.items.filter((i) => i.kind === 'device').length, MAX_DEVICES)
assert.equal(rm.hiddenDevices, 4)

// 결과 없음
assert.deepEqual(searchItems('zzzz', devices), { items: [], hiddenDevices: 0 })

// 장비 항목은 deviceId 와 목적지 힌트용 sub 를 가진다
const d = searchItems('busan', devices).items[0]
assert.equal(d.kind, 'device')
if (d.kind === 'device') { assert.equal(d.deviceId, 2); assert.ok(d.sub.includes('10.1.0.1')) }

// 단축키 판정
const base = { key: '/', ctrlKey: false, metaKey: false, altKey: false, isComposing: false, targetTag: 'BODY', targetEditable: false, modalOpen: false }
assert.equal(shouldOpenSearch(base), true)
assert.equal(shouldOpenSearch({ ...base, key: 'a' }), false)
for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(shouldOpenSearch({ ...base, targetTag: tag }), false)
assert.equal(shouldOpenSearch({ ...base, targetEditable: true }), false)
assert.equal(shouldOpenSearch({ ...base, ctrlKey: true }), false)
assert.equal(shouldOpenSearch({ ...base, metaKey: true }), false)
assert.equal(shouldOpenSearch({ ...base, altKey: true }), false)
assert.equal(shouldOpenSearch({ ...base, isComposing: true }), false)
assert.equal(shouldOpenSearch({ ...base, modalOpen: true }), false)

console.log('globalSearch checks passed')
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hoon/Code/firewall-analysis-tool/frontend && node --experimental-strip-types /private/tmp/claude-501/-Users-hoon-Code-firewall-analysis-tool/4d0d4f7a-9575-4f79-900d-c5cced1d20c5/scratchpad/globalSearch.check.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (`lib/globalSearch.ts` 없음)

- [ ] **Step 3: 구현**

`frontend/src/lib/globalSearch.ts`:

```ts
import type { Device } from '@/types/device'

/** Navbar 상단 메뉴. 팔레트의 페이지 목록과 한 곳에서 관리한다. */
export const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/devices', label: 'Devices' },
  { to: '/policies', label: 'Policies' },
  { to: '/objects', label: 'Objects' },
  { to: '/analysis', label: 'Analysis' },
  { to: '/policy-diff', label: 'Policy Diff' },
  { to: '/schedules', label: 'Schedules' },
  { to: '/guide/deletion-workflow', label: 'Guide' },
]

/** 팔레트에서 이동할 수 있는 페이지: 상단 메뉴 + 우측 메뉴(Notifications, Settings) */
export const SEARCH_PAGES: { to: string; label: string }[] = [
  ...NAV_ITEMS,
  { to: '/notifications', label: 'Notifications' },
  { to: '/settings', label: 'Settings' },
]

export const MAX_DEVICES = 8

export type SearchItem =
  | { kind: 'page'; key: string; label: string; to: string }
  | { kind: 'device'; key: string; label: string; sub: string; deviceId: number }

export interface SearchResult {
  items: SearchItem[]
  /** 상한(MAX_DEVICES) 때문에 표시하지 못한 일치 장비 수 */
  hiddenDevices: number
}

/** 소문자화 후 공백으로 나눈 모든 단어가 haystack 에 포함되어야 일치. 순위: 앞에서부터 일치 0, 부분 일치 1, 불일치 -1 */
function rank(tokens: string[], title: string, haystack: string): number {
  if (!tokens.every((t) => haystack.includes(t))) return -1
  return title.toLowerCase().startsWith(tokens[0] ?? '') ? 0 : 1
}

export function searchItems(query: string, devices: Device[]): SearchResult {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)

  const pages = SEARCH_PAGES
    .map((p) => ({ p, r: rank(tokens, p.label, p.label.toLowerCase()) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map(({ p }): SearchItem => ({ kind: 'page', key: `page:${p.to}`, label: p.label, to: p.to }))

  const matchedDevices = devices
    .map((d) => {
      const haystack = [d.name, d.ip_address, d.group, d.hostname].filter(Boolean).join(' ').toLowerCase()
      return { d, r: rank(tokens, d.name, haystack) }
    })
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.d.name.localeCompare(b.d.name))

  const deviceItems = matchedDevices.slice(0, MAX_DEVICES).map(({ d }): SearchItem => ({
    kind: 'device',
    key: `device:${d.id}`,
    label: d.name,
    sub: d.group ? `${d.ip_address} · ${d.group}` : d.ip_address,
    deviceId: d.id,
  }))

  return { items: [...pages, ...deviceItems], hiddenDevices: matchedDevices.length - deviceItems.length }
}

export interface SlashContext {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing: boolean
  targetTag: string
  targetEditable: boolean
  modalOpen: boolean
}

/** `/` 단축키로 팔레트를 열어도 되는 상황인지 판정한다(입력 중·조합 중·다른 모달 열림 등은 제외). */
export function shouldOpenSearch(c: SlashContext): boolean {
  if (c.key !== '/') return false
  if (c.ctrlKey || c.metaKey || c.altKey || c.isComposing) return false
  if (c.targetEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(c.targetTag)) return false
  return !c.modalOpen
}
```

- [ ] **Step 4: 통과 확인**

Run: Step 2와 같은 명령.
Expected: `globalSearch checks passed`

- [ ] **Step 5: 타입 검사와 커밋**

Run: `cd frontend && npx tsc -b && npx eslint src/lib/globalSearch.ts`
Expected: 출력 없음

```bash
git add frontend/src/lib/globalSearch.ts
git commit -m "통합검색: 검색 필터·단축키 판정 순수 함수 추가"
```
