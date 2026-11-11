import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Search, ArrowLeft, Globe, Terminal, IdCard, ListFilter, Boxes, BarChart3, GitCompare,
  type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { queryKeys } from '@/api/queryKeys'
import { listDevices, type Device } from '@/api/devices'
import type { PolicySearchRequest } from '@/api/firewall'
import { useDeviceStore } from '@/store/deviceStore'
import { usePolicySearchStore } from '@/store/policySearchStore'
import { buildRequestFromFilterTree } from '@/components/shared/queryBuilderModel'
import { cn } from '@/lib/utils'

const RECENT_KEY = 'fat-recent-devices'
const RECENT_MAX = 5

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

interface DeviceAction {
  key: string
  label: string
  Icon: LucideIcon
  run: (device: Device) => void
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[18%] translate-y-0 max-w-xl p-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">장비 검색</DialogTitle>
        {/* 다이얼로그가 닫히면 내용이 언마운트되므로, 상태는 열 때마다 자동으로 초기화된다. */}
        <PaletteBody onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const setSelectedIds = useDeviceStore((s) => s.setSelectedIds)
  const setSearchRequest = usePolicySearchStore((s) => s.setSearchRequest)
  const setFilterTree = usePolicySearchStore((s) => s.setFilterTree)

  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<Device | null>(null)
  const [active, setActive] = useState(0)
  const [recentIds] = useState<number[]>(readRecent)
  const listRef = useRef<HTMLDivElement>(null)

  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })

  const actions: DeviceAction[] = useMemo(() => [
    {
      key: 'web', label: '웹 UI 열기', Icon: Globe,
      run: (d) => { window.open(`https://${d.ip_address}`, '_blank', 'noopener,noreferrer') },
    },
    {
      key: 'ssh', label: 'SSH 열기', Icon: Terminal,
      run: (d) => {
        const command = `ssh ${d.username}@${d.ip_address}`
        void copyText(command).then((ok) => {
          if (ok) toast.info(`SSH 명령을 복사했습니다: ${command}`)
          else toast.info(`SSH 명령: ${command}`)
        })
        window.location.href = `ssh://${d.username}@${d.ip_address}`
      },
    },
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
      [d.name, d.ip_address, d.hostname].some((v) => v?.toLowerCase().includes(q))
    )
  }, [devices, query, recentIds])

  const itemCount = target ? actions.length : filteredDevices.length

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
    onClose()
    action.run(target)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (itemCount > 0) setActive((i) => (i + 1) % itemCount)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (itemCount > 0) setActive((i) => (i - 1 + itemCount) % itemCount)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (target) chooseAction(actions[active])
      else if (filteredDevices[active]) chooseDevice(filteredDevices[active])
    } else if (e.key === 'Backspace' && target) {
      e.preventDefault()
      setTarget(null)
      setActive(0)
    }
  }

  return (
    <div onKeyDown={onKeyDown}>
        {target ? (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-ds-outline-variant/20 pr-12">
            <button
              type="button"
              onClick={() => { setTarget(null); setActive(0) }}
              className="p-1 rounded-md text-ds-on-surface-variant hover:bg-black/5"
              aria-label="장비 다시 고르기"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ds-on-surface truncate">{target.name}</div>
              <div className="text-11 text-ds-on-surface-variant font-mono">{target.ip_address}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-ds-outline-variant/20 pr-12">
            <Search className="h-4 w-4 text-ds-on-surface-variant shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0) }}
              placeholder="장비 이름 또는 IP를 입력하세요"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-ds-on-surface-variant/60"
              aria-label="장비 검색"
            />
          </div>
        )}

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {target ? (
            actions.map((a, i) => (
              <button
                key={a.key}
                type="button"
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
            ))
          ) : filteredDevices.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-ds-on-surface-variant">일치하는 장비가 없습니다.</div>
          ) : (
            <>
              {!query.trim() && recentIds.length > 0 && (
                <div className="px-3 pt-1 pb-1 text-10 font-bold uppercase tracking-widest text-ds-on-surface-variant/70">
                  최근 · 전체
                </div>
              )}
              {filteredDevices.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
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
                    {d.hostname && <span className="block text-11 text-ds-on-surface-variant truncate">{d.hostname}</span>}
                  </span>
                  <span className="shrink-0 text-11 font-mono text-ds-on-surface-variant">{d.ip_address}</span>
                </button>
              ))}
            </>
          )}
        </div>
    </div>
  )
}
