import { useState, useRef, useEffect, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ActionMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  title?: string
  danger?: boolean
  separatorBefore?: boolean
}

/**
 * 버튼 하나로 여는 작업 메뉴 — role="menu"/"menuitem", 열면 첫 항목 포커스,
 * 방향키·Home·End 이동, Escape/바깥 클릭으로 닫기(닫으면 트리거로 포커스 복귀).
 */
export function ActionMenu({
  label, icon, items, variant = 'subtle', align = 'right', className = '', ariaLabel,
}: {
  label: string
  icon?: ReactNode
  items: ActionMenuItem[]
  variant?: 'subtle' | 'gradient'
  align?: 'left' | 'right'
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open])

  const close = () => { setOpen(false); triggerRef.current?.focus() }

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'Tab') { setOpen(false); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (els.length === 0) return
    e.preventDefault()
    const idx = els.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1
      : e.key === 'ArrowDown' ? (idx + 1) % els.length : (idx - 1 + els.length) % els.length
    els[next].focus()
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size="auto"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`gap-1.5 px-3 py-1.5 text-13 font-medium rounded-lg ${className}`}
      >
        {icon}
        {label}
        <ChevronDown className={`!w-3.5 !h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel ?? label}
          onKeyDown={onMenuKeyDown}
          className={`absolute top-full mt-1.5 min-w-44 bg-white rounded-xl shadow-ambient-md border border-ds-outline-variant/15 py-1 z-50 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((it) => (
            <div key={it.key}>
              {it.separatorBefore && <div className="my-1 border-t border-ds-outline-variant/15" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                title={it.title}
                onClick={() => { setOpen(false); it.onSelect() }}
                className={`flex items-center gap-2.5 w-full px-3.5 py-2 text-13 font-medium text-left transition-colors hover:bg-ds-surface-container-low focus-visible:bg-ds-surface-container-low outline-none disabled:opacity-40 disabled:cursor-not-allowed ${it.danger ? 'text-ds-error' : 'text-ds-on-surface'}`}
              >
                {it.icon}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
