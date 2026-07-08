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

function DeviceItem({ d, selected, single, onSelect }: {
  d: Device; selected: boolean; single: boolean; onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors text-[11px]',
        selected
          ? 'bg-ds-tertiary/8 text-ds-tertiary'
          : 'text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface'
      )}
    >
      {/* multi=체크박스(사각), single=라디오(원형) 표시 */}
      <span className={cn(
        'w-3.5 h-3.5 border shrink-0 flex items-center justify-center',
        single ? 'rounded-full' : 'rounded',
        selected ? 'bg-ds-tertiary border-ds-tertiary' : 'border-ds-outline-variant/40'
      )}>
        {selected && <span className={cn('w-1.5 h-1.5 bg-white', single ? 'rounded-full' : 'rounded-sm')} />}
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

interface BaseProps {
  mode: 'single' | 'multi'
  selectedIds: number[]
  onSelect: (id: number) => void
  onClear: () => void
  onSelectAll?: (ids: number[]) => void
  triggerLabel: string
  showClearInTrigger?: boolean
  /** multi 모드에서 그룹 내 선택 장비를 앞으로 정렬 */
  sortSelectedFirst?: boolean
}

function DeviceDropdownBase({
  mode, selectedIds, onSelect, onClear, onSelectAll, triggerLabel, showClearInTrigger, sortSelectedFirst,
}: BaseProps) {
  const single = mode === 'single'
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

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
    if (sortSelectedFirst) {
      for (const [key, arr] of map) {
        map.set(key, [...arr].sort((a, b) => {
          const aS = selectedIds.includes(a.id) ? 0 : 1
          const bS = selectedIds.includes(b.id) ? 0 : 1
          return aS - bS
        }))
      }
    }
    return map
  }, [devices, q, selectedIds, sortSelectedFirst])

  const allIds = devices.map((d) => d.id)
  const isAllSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))

  const handleSelect = (id: number) => {
    onSelect(id)
    if (single) {
      setOpen(false)
      setSearch('')
    }
  }

  const renderItem = (d: Device) => (
    <DeviceItem key={d.id} d={d} single={single} selected={selectedIds.includes(d.id)} onSelect={() => handleSelect(d.id)} />
  )

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
        <span className={single ? 'max-w-[160px] truncate' : undefined}>{triggerLabel}</span>
        {!single && selectedIds.length > 0 && (
          <span className="text-[9px] font-bold bg-ds-tertiary text-white rounded-full px-1.5 py-0.5 leading-none">
            {selectedIds.length}
          </span>
        )}
        {showClearInTrigger && selectedIds.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear() }}
            className="shrink-0 hover:text-ds-error transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
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

          <div className={cn('max-h-[240px] overflow-y-auto px-2', single ? 'pb-2' : 'pb-1')}>
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
                  {groupDevices.map(renderItem)}
                </div>
              ))
            ) : (
              filtered.map(renderItem)
            )}
          </div>

          {!single && (
            <div className="flex items-center gap-1 px-2 pb-2 pt-1 border-t border-ds-outline-variant/10">
              <button
                onClick={() => (isAllSelected ? onClear() : onSelectAll?.(allIds))}
                className="flex-1 text-[10px] font-semibold text-ds-on-surface-variant hover:text-ds-tertiary transition-colors py-1 rounded hover:bg-ds-tertiary/5"
              >
                {isAllSelected ? '전체 해제' : '전체 선택'}
              </button>
              <span className="text-ds-outline-variant/30">|</span>
              <button
                onClick={onClear}
                disabled={selectedIds.length === 0}
                className="flex-1 text-[10px] font-semibold text-ds-on-surface-variant hover:text-ds-error transition-colors py-1 rounded hover:bg-ds-error/5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                초기화
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 멀티 선택 — 전역 deviceStore와 연동 */
export function DeviceSelector() {
  const { selectedIds, toggleId, clearSelection, selectAll } = useDeviceStore()
  return (
    <DeviceDropdownBase
      mode="multi"
      selectedIds={selectedIds}
      onSelect={toggleId}
      onClear={clearSelection}
      onSelectAll={selectAll}
      triggerLabel={selectedIds.length > 0 ? `장비 ${selectedIds.length}개 선택됨` : '장비 선택'}
      sortSelectedFirst
    />
  )
}

/** 단일 선택 — value/onChange 제어형 */
export function DeviceSelectorSingle({ value, onChange }: {
  value: number | null
  onChange: (id: number | null) => void
}) {
  const { data: devices = [] } = useQuery({
    queryKey: queryKeys.devices,
    queryFn: listDevices,
    staleTime: 5 * 60_000,
  })
  const selectedDevice = devices.find((d) => d.id === value)
  return (
    <DeviceDropdownBase
      mode="single"
      selectedIds={value != null ? [value] : []}
      onSelect={(id) => onChange(value === id ? null : id)}
      onClear={() => onChange(null)}
      triggerLabel={selectedDevice ? selectedDevice.name : '장비 선택'}
      showClearInTrigger
    />
  )
}
