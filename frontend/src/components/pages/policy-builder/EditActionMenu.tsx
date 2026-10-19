import { useState, useRef, useEffect } from 'react'
import { Plus, Pencil, ArrowLeftRight, Trash2, ChevronUp, ClipboardPaste, SlidersHorizontal, Power } from 'lucide-react'
import type { ReactNode } from 'react'

const ITEM = 'flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-left rounded-md transition-colors focus-visible:outline-none focus-visible:bg-ds-surface-container-low disabled:cursor-not-allowed'
const ITEM_NORMAL = 'text-ds-on-surface hover:bg-ds-surface-container-low disabled:text-ds-on-surface-variant disabled:hover:bg-transparent'

function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-0.5">
      <p aria-hidden="true" className="px-3 pt-1 pb-0.5 text-11 font-semibold text-ds-on-surface-variant">{label}</p>
      {children}
    </div>
  )
}

/**
 * 편집모드 액션 메뉴 — 변경 계획 패널 상단에 붙어, 클릭하면 아래로 펼쳐진다.
 * "새로 만들기·수정"(선택 불필요)과 "선택한 정책"(행 선택 필요) 두 묶음의 평면 목록이다.
 * 서브메뉴 없이 모든 항목을 한 번에 보여줘서 마우스 경로가 꺾이지 않는다.
 */
export function EditActionMenu({
  selectedCount, onCreateForm, onCreatePaste, onModify, onMove, onDelete, onToggleDisable,
}: {
  selectedCount: number
  onCreateForm: () => void
  onCreatePaste: () => void
  onModify: () => void
  onMove: () => void
  onDelete: () => void
  onToggleDisable: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 메뉴가 열리면 첫 항목으로 포커스를 옮기고, 방향키/Home/End로 항목을 순회, Escape로 닫고 트리거로 포커스를 돌려준다.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open])

  const close = () => { setOpen(false); triggerRef.current?.focus() }
  // 항목을 고르면 메뉴가 사라지는데, 포커스가 그 항목에 남은 채로 모달이 열리면 닫힐 때 갈 곳이 없어 body로 떨어진다.
  // 모달이 열리기 전에 트리거로 포커스를 옮겨 두면 모달이 닫힐 때 트리거로 돌아온다.
  const run = (action: () => void) => () => { setOpen(false); triggerRef.current?.focus(); action() }
  const needSelection = selectedCount === 0 ? '행을 먼저 선택하세요' : undefined
  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const idx = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length
    items[next].focus()
  }

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div ref={menuRef} role="menu" aria-label="편집 메뉴" onKeyDown={handleMenuKeyDown} className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-ambient-md border border-ds-outline-variant/10 p-1.5 space-y-1.5 z-40">
          <MenuGroup label="새로 만들기·수정">
            <button type="button" role="menuitem" onClick={run(onCreateForm)} className={`${ITEM} ${ITEM_NORMAL}`}>
              <Plus className="w-3.5 h-3.5 shrink-0" /> 새 정책 추가
            </button>
            <button type="button" role="menuitem" onClick={run(onCreatePaste)} className={`${ITEM} ${ITEM_NORMAL}`}>
              <ClipboardPaste className="w-3.5 h-3.5 shrink-0" /> 새 정책 붙여넣기
            </button>
            <button type="button" role="menuitem" onClick={run(onModify)} className={`${ITEM} ${ITEM_NORMAL}`}>
              <Pencil className="w-3.5 h-3.5 shrink-0" /> 정책 수정 (필드 값 일괄)
            </button>
          </MenuGroup>

          <div className="border-t border-ds-outline-variant/15" />

          <MenuGroup label={selectedCount > 0 ? `선택한 정책 ${selectedCount}건` : '선택한 정책'}>
            <button type="button" role="menuitem" onClick={run(onMove)} disabled={selectedCount === 0} title={needSelection} className={`${ITEM} ${ITEM_NORMAL}`}>
              <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" /> 이동
              {selectedCount === 0 && <span className="ml-auto text-11 font-normal">행 선택 필요</span>}
            </button>
            <button type="button" role="menuitem" onClick={run(onToggleDisable)} disabled={selectedCount === 0} title={needSelection} className={`${ITEM} ${ITEM_NORMAL}`}>
              <Power className="w-3.5 h-3.5 shrink-0" /> 비활성화 / 활성화
              {selectedCount === 0 && <span className="ml-auto text-11 font-normal">행 선택 필요</span>}
            </button>
            <button
              type="button" role="menuitem" onClick={run(onDelete)} disabled={selectedCount === 0} title={needSelection}
              className={`${ITEM} text-ds-error hover:bg-ds-error/10 disabled:text-ds-on-surface-variant disabled:hover:bg-transparent`}
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" /> 삭제
              {selectedCount === 0 && <span className="ml-auto text-11 font-normal">행 선택 필요</span>}
            </button>
          </MenuGroup>
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
          open ? 'text-ds-tertiary bg-ds-tertiary/10 border-ds-tertiary/20' : 'text-ds-on-surface-variant bg-ds-surface-container-low border-ds-outline-variant/10 hover:text-ds-on-surface'
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" /> 편집 메뉴
        <ChevronUp className={`w-3 h-3 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
    </div>
  )
}
