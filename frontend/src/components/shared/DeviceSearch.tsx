import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Search, Globe, Terminal, IdCard, ListFilter, Boxes, BarChart3, GitCompare,
  type LucideIcon,
} from 'lucide-react'
import { queryKeys } from '@/api/queryKeys'
import { listDevices, type Device } from '@/api/devices'
import type { PolicySearchRequest } from '@/api/firewall'
import { useDeviceStore } from '@/store/deviceStore'
import { usePolicySearchStore } from '@/store/policySearchStore'
import { buildRequestFromFilterTree } from '@/components/shared/queryBuilderModel'
import { cn } from '@/lib/utils'

const RECENT_KEY = 'fat-recent-devices'
const RECENT_MAX = 5
// 한 번에 그리는 장비 수 상한. 수백 대를 전부 그리면 입력할 때마다 눈에 띄게 버벅인다.
const MAX_VISIBLE = 50
// 장비 목록은 자주 바뀌지 않으므로, 열 때마다 재조회(→ 뒤 페이지 그리드 재렌더)하지 않고 캐시를 쓴다.
// 장비를 추가/수정/삭제하면 기존 로직이 queryKeys.devices를 무효화하므로 최신성은 유지된다.
const DEVICES_STALE_MS = 5 * 60_000

function readRecent(): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : []
  } catch {
    return []
  }
}

function writeRecent(id: number) {
  try {
    const next = [id, ...readRecent().filter((v) => v !== id)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* 저장이 막혀 있어도 검색은 동작해야 한다 */ }
}

/** 클립보드 API는 http(비보안 컨텍스트)에서 막히므로 textarea 복사로 폴백한다. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 폴백으로 진행 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** 글자를 입력 중인 곳(입력창·편집 가능 영역)에서는 "/"를 검색 단축키로 가로채지 않는다. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

interface DeviceAction {
  key: string
  label: string
  Icon: LucideIcon
  run?: (device: Device) => void
  /** true면 바로 실행하지 않고 먼저 추가 입력(SSH 계정)을 받는다. */
  needsInput?: boolean
}

/** 입력한 계정으로 SSH 링크를 열고, 같은 명령을 클립보드에 복사한다. */
function openSsh(device: Device, user: string) {
  const command = `ssh ${user}@${device.ip_address}`
  void copyText(command).then((ok) => {
    if (ok) toast.info(`SSH 명령을 복사했습니다: ${command}`)
    else toast.info(`SSH 명령: ${command}`)
  })
  window.location.href = `ssh://${user}@${device.ip_address}`
}

/** 네비바 장비 검색: 입력창에 바로 입력하면 아래로 결과가 펼쳐진다. 장비를 고르면 같은 자리에 동작 목록이 나온다. */
export function DeviceSearch() {
  const navigate = useNavigate()
  const setSelectedIds = useDeviceStore((s) => s.setSelectedIds)
  const setSearchRequest = usePolicySearchStore((s) => s.setSearchRequest)
  const setFilterTree = usePolicySearchStore((s) => s.setFilterTree)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<Device | null>(null)
  // null이 아니면 SSH 계정 입력 단계(값 = 입력 중인 계정)
  const [sshUser, setSshUser] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [recentIds, setRecentIds] = useState<number[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { data: devices = [] } = useQuery({
    queryKey: queryKeys.devices, queryFn: listDevices, staleTime: DEVICES_STALE_MS, enabled: open,
  })

  const openSearch = () => {
    if (open) return
    setRecentIds(readRecent())
    setOpen(true)
  }

  const closeSearch = () => {
    setOpen(false)
    setQuery('')
    setTarget(null)
    setSshUser(null)
    setActive(0)
  }

  // "/" 단축키: 입력 중이거나 다른 다이얼로그가 떠 있을 때를 빼고 검색창으로 포커스를 옮긴다.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      if (isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const actions: DeviceAction[] = useMemo(() => [
    {
      key: 'web', label: '웹 UI 열기', Icon: Globe,
      run: (d) => { window.open(`https://${d.ip_address}`, '_blank', 'noopener,noreferrer') },
    },
    { key: 'ssh', label: 'SSH 열기', Icon: Terminal, needsInput: true },
    { key: 'detail', label: '상세정보', Icon: IdCard, run: (d) => navigate('/devices', { state: { openDetailDeviceId: d.id } }) },
    {
      key: 'policies', label: '정책 조회', Icon: ListFilter,
      run: (d) => {
        setSelectedIds([d.id])
        setFilterTree([])
        setSearchRequest(buildRequestFromFilterTree([], [d.id]) as unknown as PolicySearchRequest)
        navigate('/policies')
      },
    },
    { key: 'objects', label: '객체 조회', Icon: Boxes, run: (d) => { setSelectedIds([d.id]); navigate('/objects') } },
    { key: 'analysis', label: '분석 실행', Icon: BarChart3, run: (d) => navigate('/analysis', { state: { openCreateWithDeviceId: d.id } }) },
    { key: 'diff', label: '정책 비교', Icon: GitCompare, run: (d) => navigate('/policy-diff', { state: { openDeviceId: d.id } }) },
  ], [navigate, setSelectedIds, setFilterTree, setSearchRequest])

  const filteredDevices = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      const byId = new Map(devices.map((d) => [d.id, d]))
      const recent = recentIds.map((id) => byId.get(id)).filter((d): d is Device => !!d)
      const recentSet = new Set(recent.map((d) => d.id))
      return [...recent, ...devices.filter((d) => !recentSet.has(d.id))]
    }
    return devices.filter((d) =>
      [d.name, d.ip_address, d.hostname, d.description].some((v) => v?.toLowerCase().includes(q))
    )
  }, [devices, query, recentIds])

  const visibleDevices = useMemo(() => filteredDevices.slice(0, MAX_VISIBLE), [filteredDevices])
  const hiddenCount = filteredDevices.length - visibleDevices.length
  const itemCount = target ? actions.length : visibleDevices.length

  // 방향키로 움직인 항목이 스크롤 영역 밖이면 보이게 한다.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, target, query])

  const chooseDevice = (device: Device) => {
    writeRecent(device.id)
    setTarget(device)
    setActive(0)
  }

  const chooseAction = (action: DeviceAction) => {
    if (!target) return
    if (action.needsInput) {
      setSshUser(target.username)
      // 기본 계정을 바로 덮어쓸 수 있게 전체 선택(값이 반영된 다음 프레임에)
      requestAnimationFrame(() => inputRef.current?.select())
      return
    }
    const device = target
    closeSearch()
    inputRef.current?.blur()
    action.run?.(device)
  }

  const submitSsh = () => {
    const user = sshUser?.trim()
    if (!target || !user) return
    const device = target
    closeSearch()
    inputRef.current?.blur()
    openSsh(device, user)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearch()
      inputRef.current?.blur()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      openSearch()
      if (itemCount > 0) setActive((i) => (i + 1) % itemCount)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (itemCount > 0) setActive((i) => (i - 1 + itemCount) % itemCount)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (sshUser !== null) submitSsh()
      else if (target) chooseAction(actions[active])
      else if (visibleDevices[active]) chooseDevice(visibleDevices[active])
    } else if (e.key === 'Backspace' && target) {
      // SSH 계정 입력 중에는 글자를 지우는 것이 기본 동작. 입력이 비어 있을 때만 한 단계 뒤로 간다.
      if (sshUser !== null) {
        if (sshUser !== '') return
        e.preventDefault()
        setSshUser(null)
        return
      }
      e.preventDefault()
      setTarget(null)
      setActive(0)
    }
  }

  return (
    <div
      className="relative"
      // 포커스가 검색 영역 밖으로 나가면(바깥 클릭, Tab 등) 닫는다.
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeSearch() }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ds-on-surface-variant/70" />
        <input
          ref={inputRef}
          value={sshUser ?? (target ? target.name : query)}
          readOnly={!!target && sshUser === null}
          onChange={(e) => {
            if (sshUser !== null) setSshUser(e.target.value)
            else { setQuery(e.target.value); setActive(0) }
          }}
          onFocus={openSearch}
          onKeyDown={onKeyDown}
          placeholder={sshUser !== null ? 'SSH 계정' : '장비 검색'}
          role="combobox"
          aria-label="장비 검색"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          className={cn(
            'w-48 pl-8 pr-8 py-1.5 text-xs rounded-lg border bg-white outline-none transition-colors',
            'border-ds-outline-variant/30 placeholder:text-ds-on-surface-variant/70',
            'focus:border-ds-tertiary/60 focus:ring-2 focus:ring-ds-tertiary/20',
            target && 'font-semibold text-ds-tertiary'
          )}
        />
        {!open && (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1.5 rounded border border-ds-outline-variant/40 text-10 font-mono text-ds-on-surface-variant">/</kbd>
        )}
      </div>

      {open && (
        // 버튼을 눌러도 입력창의 포커스가 빠지지 않게 mousedown의 기본 동작(포커스 이동)을 막는다.
        <div
          ref={listRef}
          onMouseDown={(e) => e.preventDefault()}
          role="listbox"
          className="absolute right-0 top-full mt-2 w-[30rem] max-w-[90vw] max-h-[60vh] overflow-y-auto p-2 rounded-xl bg-white shadow-2xl ring-1 ring-ds-outline-variant/20"
        >
          {target && sshUser !== null ? (
            <div className="px-3 py-4 space-y-1.5">
              <div className="text-sm text-ds-on-surface">접속할 계정을 입력하고 Enter를 누르세요.</div>
              <div className="text-11 font-mono text-ds-on-surface-variant break-all">
                ssh {sshUser.trim() || '계정'}@{target.ip_address}
              </div>
            </div>
          ) : target ? (
            <>
              <div className="px-3 pb-1.5 text-11 text-ds-on-surface-variant font-mono">{target.ip_address}</div>
              {actions.map((a, i) => (
                <button
                  key={a.key}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => chooseAction(a)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors',
                    i === active ? 'bg-ds-tertiary/10 text-ds-tertiary' : 'text-ds-on-surface'
                  )}
                >
                  <a.Icon className="h-4 w-4 shrink-0" />
                  {a.label}
                </button>
              ))}
            </>
          ) : filteredDevices.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-ds-on-surface-variant">일치하는 장비가 없습니다.</div>
          ) : (
            <>
              {!query.trim() && recentIds.length > 0 && (
                <div className="px-3 pt-1 pb-1 text-10 font-bold uppercase tracking-widest text-ds-on-surface-variant/70">
                  최근 · 전체
                </div>
              )}
              {visibleDevices.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => chooseDevice(d)}
                  className={cn(
                    'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                    i === active ? 'bg-ds-tertiary/10' : ''
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ds-on-surface truncate">{d.name}</span>
                    {(d.hostname || d.description) && (
                      <span className="block text-11 text-ds-on-surface-variant truncate">
                        {[d.hostname, d.description].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-11 font-mono text-ds-on-surface-variant">{d.ip_address}</span>
                </button>
              ))}
              {hiddenCount > 0 && (
                <div className="px-3 py-2 text-11 text-ds-on-surface-variant">
                  외 {hiddenCount}대 — 검색어를 더 입력하면 좁혀집니다.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
