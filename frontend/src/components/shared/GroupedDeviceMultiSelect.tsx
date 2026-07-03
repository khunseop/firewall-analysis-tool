import { useMemo, useState } from 'react'
import type { Device } from '@/api/devices'
import { cn } from '@/lib/utils'
import { Search, X } from 'lucide-react'

const VENDOR_DOT: Record<string, string> = {
  paloalto: 'bg-orange-400',
  ngf: 'bg-blue-400',
  mf2: 'bg-cyan-400',
  mock: 'bg-ds-outline',
}

interface GroupedDeviceMultiSelectProps {
  devices: Device[]
  value: number[]
  onChange: (ids: number[]) => void
}

export function GroupedDeviceMultiSelect({ devices, value, onChange }: GroupedDeviceMultiSelectProps) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!q) return devices
    return devices.filter(
      (d) => d.name.toLowerCase().includes(q) || d.ip_address.toLowerCase().includes(q) || (d.group ?? '').toLowerCase().includes(q)
    )
  }, [devices, q])

  const grouped = useMemo(() => {
    const map = new Map<string, Device[]>()
    for (const d of filtered) {
      const key = d.group ?? '기타'
      const arr = map.get(key) ?? []
      arr.push(d)
      map.set(key, arr)
    }
    return map
  }, [filtered])

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  const toggleGroup = (groupDevices: Device[]) => {
    const groupIds = groupDevices.map((d) => d.id)
    const allSelected = groupIds.every((id) => value.includes(id))
    onChange(
      allSelected
        ? value.filter((id) => !groupIds.includes(id))
        : [...new Set([...value, ...groupIds])]
    )
  }

  const allIds = devices.map((d) => d.id)
  const isAllSelected = allIds.length > 0 && allIds.every((id) => value.includes(id))

  return (
    <div className="border border-ds-outline-variant/30 rounded-md bg-ds-surface-container-low">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-ds-outline-variant/20">
        <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="장비 검색…"
          className="flex-1 text-[12px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/50 min-w-0"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} className="shrink-0">
            <X className="w-3 h-3 text-ds-on-surface-variant hover:text-ds-on-surface" />
          </button>
        )}
      </div>

      <div className="max-h-[200px] overflow-y-auto px-2 py-1.5">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-ds-on-surface-variant text-center py-3 italic">
            {devices.length === 0 ? '장비가 없습니다' : '검색 결과 없음'}
          </p>
        ) : (
          Array.from(grouped.entries()).map(([groupName, groupDevices]) => {
            const groupIds = groupDevices.map((d) => d.id)
            const groupAllSelected = groupIds.every((id) => value.includes(id))
            return (
              <div key={groupName} className="mb-1.5 last:mb-0">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-ds-on-surface-variant/50">{groupName}</span>
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupDevices)}
                    className="text-[9px] font-semibold text-ds-tertiary hover:underline"
                  >
                    {groupAllSelected ? '그룹 해제' : '그룹 선택'}
                  </button>
                </div>
                {groupDevices.map((d) => {
                  const selected = value.includes(d.id)
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggle(d.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors text-[11px]',
                        selected
                          ? 'bg-ds-tertiary/8 text-ds-tertiary'
                          : 'text-ds-on-surface-variant hover:bg-ds-surface-container-high hover:text-ds-on-surface'
                      )}
                    >
                      <span className={cn(
                        'w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center',
                        selected ? 'bg-ds-tertiary border-ds-tertiary' : 'border-ds-outline-variant/40'
                      )}>
                        {selected && <span className="w-1.5 h-1.5 bg-white rounded-sm" />}
                      </span>
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', VENDOR_DOT[d.vendor?.toLowerCase()] ?? 'bg-ds-outline')} />
                      <span className="truncate font-mono leading-tight">{d.name}</span>
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-1 px-2 pb-2 pt-1 border-t border-ds-outline-variant/10">
        <span className="flex-1 text-[10px] text-ds-on-surface-variant px-1">
          {value.length > 0 ? `${value.length}개 선택됨` : '선택된 장비 없음'}
        </span>
        <button
          type="button"
          onClick={() => onChange(isAllSelected ? [] : allIds)}
          className="text-[10px] font-semibold text-ds-on-surface-variant hover:text-ds-tertiary transition-colors py-1 px-2 rounded hover:bg-ds-tertiary/5"
        >
          {isAllSelected ? '전체 해제' : '전체 선택'}
        </button>
      </div>
    </div>
  )
}
