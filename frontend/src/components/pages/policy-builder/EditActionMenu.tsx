import { useState, useRef, useEffect } from 'react'
import { Plus, Pencil, ArrowLeftRight, Trash2, ChevronUp, ClipboardPaste, X } from 'lucide-react'

/**
 * 편집모드 액션 플로팅 메뉴 — 그리드를 스크롤해 내려가도 항상 화면 우하단에 떠 있어
 * 상단 툴바까지 되돌아가지 않고 정책 생성/수정/이동/삭제를 바로 실행할 수 있다.
 * 평소엔 컴팩트한 원형 버튼 하나만 보이고, 클릭하면 4개 주요 액션이 펼쳐진다.
 * "붙여넣기로 일괄 생성"처럼 대량 처리용 변형은 정책 생성 버튼의 서브 메뉴로 둔다.
 */
export function EditActionMenu({
  selectedCount, onCreateForm, onCreatePaste, onModify, onMove, onDelete,
}: {
  selectedCount: number
  onCreateForm: () => void
  onCreatePaste: () => void
  onModify: () => void
  onMove: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreateMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={rootRef} className="fixed bottom-24 right-6 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="flex flex-col items-end gap-1.5 bg-ds-surface-container-lowest rounded-2xl shadow-2xl ambient-shadow border border-ds-outline-variant/10 p-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setCreateMenuOpen((v) => !v)}
              className="flex items-center gap-2 w-40 px-3 py-2 text-[12px] font-semibold text-ds-tertiary bg-ds-tertiary/10 rounded-lg hover:bg-ds-tertiary/15 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> 정책 생성
            </button>
            {createMenuOpen && (
              <div className="absolute right-full top-0 mr-1.5 w-44 bg-ds-surface-container-lowest rounded-xl shadow-2xl ambient-shadow border border-ds-outline-variant/10 p-1">
                <button
                  type="button"
                  onClick={() => { setCreateMenuOpen(false); setOpen(false); onCreateForm() }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface rounded-lg hover:bg-ds-surface-container-low transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> 폼으로 추가
                </button>
                <button
                  type="button"
                  onClick={() => { setCreateMenuOpen(false); setOpen(false); onCreatePaste() }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface rounded-lg hover:bg-ds-surface-container-low transition-colors"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" /> 붙여넣기로 일괄 추가
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => { setOpen(false); onModify() }}
            className="flex items-center gap-2 w-40 px-3 py-2 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg hover:text-ds-on-surface transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" /> 정책 수정
          </button>

          <button
            type="button"
            onClick={() => { setOpen(false); onMove() }}
            disabled={selectedCount === 0}
            className="flex items-center gap-2 w-40 px-3 py-2 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg hover:text-ds-on-surface transition-colors disabled:opacity-40"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" /> 선택 이동 {selectedCount > 0 && `(${selectedCount})`}
          </button>

          <button
            type="button"
            onClick={() => { setOpen(false); onDelete() }}
            disabled={selectedCount === 0}
            className="flex items-center gap-2 w-40 px-3 py-2 text-[12px] font-medium text-ds-error bg-ds-error/5 rounded-lg hover:bg-ds-error/10 transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" /> 선택 삭제 {selectedCount > 0 && `(${selectedCount})`}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setCreateMenuOpen(false) }}
        title="편집 액션"
        className="w-12 h-12 rounded-full flex items-center justify-center btn-primary-gradient text-ds-on-tertiary shadow-2xl ambient-shadow transition-transform hover:scale-105"
      >
        {open ? <X className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
      </button>
    </div>
  )
}
