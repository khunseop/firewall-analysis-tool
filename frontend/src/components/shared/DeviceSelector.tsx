import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDeviceStore } from '@/store/deviceStore'
import { listDevices, type Device } from '@/api/devices'
import { cn } from '@/lib/utils'
import { ChevronDown, Search, X, Monitor } from 'lucide-react'
import { queryKeys } from '@/api/queryKeys'

const VENDOR_DOT: Record<string, string> = {
  paloalto: 'bg-orange-400',
  ngf: 'bg-blue-400',
  mf2: 'bg-cyan-400',
  mock: 'bg-ds-outline',
}

function DeviceItem({ d, selected, onToggle }: { d: Device; selected: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors text-[11px]',
        selected
          ? 'bg-ds-tertiary/8 text-ds-tertiary'
          : 'text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface'
      )}
    >
      <span className={cn(
        'w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center',
        selected ? 'bg-ds-tertiary border-ds-tertiary' : 'border-ds-outline-variant/40'
      )}>
        {selected && <span className="w-1.5 h-1.5 bg-white rounded-sm" />}
      </span>
      <span className={cn(
        'w-1.5 h-1.5 rounded-full shrink-0',
        VENDOR_DOT[d.vendor?.toLowerCase()] ?? 'bg-ds-outline'
      )} />
      <span className="truncate font-mono leading-tight">{d.name}</span>
      {d.description && (
        <span className="truncate text-[10px] text-ds-on-surface-variant/50 shrink-0 max-w-[80px]">{d.description}</span>
      )}
    </button>
  )
}

export function DeviceSelector() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const { selectedIds, toggleId, clearSelection, selectAll } = useDeviceStore()

  const { data: devices = [] } = useQuery({
    queryKey: queryKeys.devices,
    queryFn: listDevices,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!q) return devices
    return devices.filter(
      (d) => d.name.toLowerCase().includes(q) || d.ip_address.toLowerCase().includes(q) || (d.group ?? '').toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q)
    )
  }, [devices, q])

  const grouped = useMemo(() => {
    if (q) return null
    const map = new Map<string, typeof devices>()
    for (const d of devices) {
      const key = d.group ?? '기타'
      const arr = map.get(key) ?? []
      arr.push(d)
      map.set(key, arr)
    }
    for (const [key, arr] of map) {
      map.set(key, [...arr].sort((a, b) => {
        const aS = selectedIds.includes(a.id) ? 0 : 1
        const bS = selectedIds.includes(b.id) ? 0 : 1
        return aS - bS
      }))
    }
    return map
  }, [devices, q, selectedIds])

  const allIds = devices.map((d) => d.id)
  const isAllSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 text-[13px] font-semibold rounded-xl px-3.5 py-2 transition-all border',
          open
            ? 'bg-ds-tertiary/10 text-ds-tertiary border-ds-tertiary/20'
            : selectedIds.length > 0
              ? 'bg-ds-secondary-container text-ds-tertiary border-ds-tertiary/15 hover:bg-ds-tertiary/10'
              : 'text-ds-tertiary border-ds-tertiary/40 border-dashed bg-ds-tertiary/5 hover:bg-ds-tertiary/10 hover:border-ds-tertiary/60'
        )}
      >
        <Monitor className="w-3.5 h-3.5 shrink-0" />
        <span>
          {selectedIds.length > 0 ? `장비 ${selectedIds.length}개 선택됨` : '장비 선택'}
        </span>
        {selectedIds.length > 0 && (
          <span className="text-[9px] font-bold bg-ds-tertiary text-white rounded-full px-1.5 py-0.5 leading-none">
            {selectedIds.length}
          </span>
        )}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform opacity-60', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white/90 backdrop-blur-xl rounded-xl border border-white/60 shadow-ambient-md z-50">
          <div className="px-3 pt-3 pb-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 mb-2">
              Device Selection
            </p>
            <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2 py-1.5">
              <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="장비 검색…"
                className="flex-1 text-[11px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/50 min-w-0"
              />
              {search && (
                <button onClick={() => setSearch('')} className="shrink-0">
                  <X className="w-3 h-3 text-ds-on-surface-variant hover:text-ds-on-surface" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[240px] overflow-y-auto px-2 pb-1">
            {filtered.length === 0 && devices.length === 0 ? (
              <p className="text-[10px] text-ds-on-surface-variant text-center py-3 italic">장비가 없습니다</p>
            ) : filtered.length === 0 && q ? (
              <p className="text-[10px] text-ds-on-surface-variant text-center py-3 italic">검색 결과 없음</p>
            ) : grouped ? (
              Array.from(grouped.entries()).map(([groupName, groupDevices]) => (
                <div key={groupName}>
                  {grouped.size > 1 && (
                    <p className="text-[9px] font-bold uppercase tracking-widest text-ds-on-surface-variant/50 px-2 pt-2 pb-0.5">{groupName}</p>
                  )}
                  {groupDevices.map((d) => {
                    const selected = selectedIds.includes(d.id)
                    return <DeviceItem key={d.id} d={d} selected={selected} onToggle={() => toggleId(d.id)} />
                  })}
                </div>
              ))
            ) : (
              filtered.map((d) => {
                const selected = selectedIds.includes(d.id)
                return <DeviceItem key={d.id} d={d} selected={selected} onToggle={() => toggleId(d.id)} />
              })
            )}
          </div>

          <div className="flex items-center gap-1 px-2 pb-2 pt-1 border-t border-ds-outline-variant/10">
            <button
              onClick={() => (isAllSelected ? clearSelection() : selectAll(allIds))}
              className="flex-1 text-[10px] font-semibold text-ds-on-surface-variant hover:text-ds-tertiary transition-colors py-1 rounded hover:bg-ds-tertiary/5"
            >
              {isAllSelected ? '전체 해제' : '전체 선택'}
            </button>
            <span className="text-ds-outline-variant/30">|</span>
            <button
              onClick={clearSelection}
              disabled={selectedIds.length === 0}
              className="flex-1 text-[10px] font-semibold text-ds-on-surface-variant hover:text-ds-error transition-colors py-1 rounded hover:bg-ds-error/5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              초기화
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
