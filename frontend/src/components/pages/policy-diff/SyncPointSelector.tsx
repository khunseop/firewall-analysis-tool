import { useState, useMemo, useRef, useEffect, useId } from 'react'
import { ChevronDown, Search, X, Clock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pointLabel, type SyncPoint } from './types'

export function SyncPointSelector({
  label, points, value, onChange, disabledId,
}: {
  label: string
  points: SyncPoint[]
  value: number | null
  onChange: (id: number | null) => void
  disabledId: number | null
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const listId = useId()

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
    if (!q) return points
    return points.filter((p) => pointLabel(p).toLowerCase().includes(q))
  }, [points, q])

  const selected = points.find((p) => p.id === value)

  const close = () => {
    setOpen(false)
    setSearch('')
  }

  const handleSelect = (id: number) => {
    onChange(id)
    close()
    triggerRef.current?.focus()
  }

  // 방향키로 선택 가능한 옵션 사이를 이동한다 (검색창 ↔ 옵션 목록).
  const moveFocus = (e: React.KeyboardEvent, direction: 1 | -1) => {
    const options = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([aria-disabled="true"])') ?? [])
    if (options.length === 0) return
    e.preventDefault()
    const idx = options.findIndex((el) => el === document.activeElement)
    const next = idx === -1 ? (direction === 1 ? 0 : options.length - 1) : idx + direction
    options[Math.min(Math.max(next, 0), options.length - 1)].focus()
  }

  return (
    <div
      className="space-y-1.5 flex-1 min-w-[220px]"
      ref={containerRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) { e.stopPropagation(); close(); triggerRef.current?.focus() }
        else if (e.key === 'ArrowDown' && open) moveFocus(e, 1)
        else if (e.key === 'ArrowUp' && open) moveFocus(e, -1)
      }}
    >
      <span id={labelId} className="block text-xs font-semibold text-ds-primary">{label}</span>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={labelId}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'w-full h-9 flex items-center gap-2 px-3 text-sm bg-ds-surface-container-low border rounded-md transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40',
            open ? 'border-ds-tertiary' : 'border-ds-outline-variant/30 hover:border-ds-outline-variant/50'
          )}
        >
          {selected?.isLive
            ? <Zap className="w-3.5 h-3.5 shrink-0 text-amber-600" />
            : <Clock className="w-3.5 h-3.5 shrink-0 text-ds-on-surface-variant" />}
          <span className={cn('flex-1 truncate font-mono text-13', !selected && 'font-sans text-ds-on-surface-variant')}>
            {selected
              ? `${pointLabel(selected)}${!selected.isLive && selected.total_policies != null ? `  (${selected.total_policies.toLocaleString()}개)` : ''}`
              : '시점 선택'}
          </span>
          <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-ds-on-surface-variant transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1.5 w-full min-w-[300px] bg-white rounded-xl border border-ds-outline-variant/30 shadow-ambient-md z-50">
            <div className="px-3 pt-3 pb-1.5">
              <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2 py-1.5">
                <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="시점 검색 (예: 2026-10-03)"
                  aria-label="시점 검색"
                  className="flex-1 text-xs bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant min-w-0"
                  autoFocus
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} aria-label="검색어 지우기" className="shrink-0">
                    <X className="w-3 h-3 text-ds-on-surface-variant hover:text-ds-on-surface" />
                  </button>
                )}
              </div>
            </div>
            <div ref={listRef} id={listId} role="listbox" aria-labelledby={labelId} className="max-h-[240px] overflow-y-auto px-2 pb-2">
              {filtered.length === 0 ? (
                <p className="text-xs text-ds-on-surface-variant text-center py-3 italic">검색 결과 없음</p>
              ) : (
                filtered.map((p) => {
                  const isDisabled = p.id === disabledId
                  return (
                    <button
                      type="button"
                      key={p.id}
                      role="option"
                      aria-selected={p.id === value}
                      aria-disabled={isDisabled}
                      onClick={() => !isDisabled && handleSelect(p.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40',
                        isDisabled
                          ? 'text-ds-on-surface-variant opacity-50 cursor-not-allowed'
                          : p.id === value
                            ? 'bg-ds-tertiary/8 text-ds-tertiary'
                            : 'text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface'
                      )}
                    >
                      <span className={cn(
                        'w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center',
                        p.id === value ? 'bg-ds-tertiary border-ds-tertiary' : 'border-ds-outline-variant/60'
                      )}>
                        {p.id === value && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                      {p.isLive && <Zap className="w-3 h-3 shrink-0 text-amber-600" />}
                      <span className={cn('truncate leading-tight', p.isLive ? 'font-semibold' : 'font-mono')}>{pointLabel(p)}</span>
                      {isDisabled && <span className="text-11 shrink-0">(상대편에서 선택됨)</span>}
                      {!p.isLive && p.total_policies != null && (
                        <span className="ml-auto text-11 text-ds-on-surface-variant shrink-0">{p.total_policies.toLocaleString()}개</span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
