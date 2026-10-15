import { useState, useRef, useEffect } from 'react'
import { Columns3 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { HIDEABLE_COLUMNS } from './constants'

/** 표시할 컬럼 선택 — 자주 보지 않는 컬럼은 기본으로 숨겨 장비 수십 대를 비교할 때 핵심 컬럼(상태·장비명·IP·마지막 동기화)에 집중하게 한다. */
export function ColumnChooser({ hidden, onToggle }: { hidden: Set<string>; onToggle: (id: string, visible: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-ds-on-surface-variant rounded-lg border border-ds-outline-variant/20 bg-ds-surface-container-low hover:text-ds-on-surface transition-colors"
      >
        <Columns3 className="w-3.5 h-3.5" />컬럼
      </button>
      {open && (
        <div role="group" aria-label="표시할 컬럼" className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-xl shadow-ambient-md border border-ds-outline-variant/15 py-1.5 z-50">
          {HIDEABLE_COLUMNS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 px-3.5 py-1.5 text-13 text-ds-on-surface cursor-pointer hover:bg-ds-surface-container-low">
              <Checkbox checked={!hidden.has(c.id)} onCheckedChange={(v) => onToggle(c.id, !!v)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
