import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { SlidersHorizontal, MoreHorizontal, Download, Bookmark, BookmarkPlus, X } from 'lucide-react'
import { QueryBuilder } from '@/components/shared/QueryBuilder'
import { QB_FIELDS, OP_LABELS, type FilterTree } from '@/components/shared/queryBuilderModel'
import { Button } from '@/components/ui/button'

type Preset = { name: string; tree: FilterTree }
const PRESET_KEY = 'fat_policy_presets'

const MENU_ITEM = 'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-ds-on-surface hover:bg-ds-surface-container-low transition-colors disabled:opacity-40'

/**
 * 검색 영역 — 항상 보이는 것은 "상세 검색 / 초기화 / 검색" 세 가지뿐이고,
 * 내보내기·프리셋처럼 검색 이후에 쓰는 보조 기능은 "더 보기" 메뉴로 모았다.
 */
export function PolicySearchToolbar({
  filterTree, onFilterTreeChange, filtersOpen, onFiltersOpenChange,
  hasResults, onExport, onExportUsage, onReset, onSearch, searchDisabled, searching,
}: {
  filterTree: FilterTree
  onFilterTreeChange: (tree: FilterTree) => void
  filtersOpen: boolean
  onFiltersOpenChange: (open: boolean) => void
  hasResults: boolean
  onExport: () => void
  onExportUsage: () => void
  onReset: () => void
  onSearch: () => void
  searchDisabled: boolean
  searching: boolean
}) {
  const allConditions = filterTree.flatMap(g => g.conditions)
  const activeCount = allConditions.filter(c => c.value.trim()).length
  const hasConditions = activeCount > 0

  const [presets, setPresets] = useState<Preset[]>(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') } catch { return [] }
  })
  const [presetNameInput, setPresetNameInput] = useState('')
  const [showPresetInput, setShowPresetInput] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const persist = (next: Preset[]) => {
    setPresets(next)
    localStorage.setItem(PRESET_KEY, JSON.stringify(next))
  }

  const savePreset = () => {
    const name = presetNameInput.trim()
    if (!name) return
    persist([...presets.filter(p => p.name !== name), { name, tree: filterTree }])
    setPresetNameInput('')
    setShowPresetInput(false)
    toast.success(`프리셋 "${name}" 저장됨`)
  }

  const loadPreset = (preset: Preset) => {
    onFilterTreeChange(preset.tree)
    onFiltersOpenChange(true)
    setMenuOpen(false)
    toast.info(`프리셋 "${preset.name}" 불러옴`)
  }

  return (
    <div className="card rounded-xl shrink-0">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          onClick={() => onFiltersOpenChange(!filtersOpen)}
          aria-expanded={filtersOpen}
          className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
            filtersOpen || hasConditions
              ? 'text-ds-tertiary bg-ds-tertiary/10'
              : 'text-ds-on-surface-variant bg-ds-surface-container-low hover:text-ds-tertiary border border-ds-outline-variant/10'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          상세 검색
          {hasConditions && (
            <span className="ml-1 bg-ds-tertiary text-white rounded-full min-w-4 h-4 px-1 flex items-center justify-center text-11 font-bold tabular-nums">
              {activeCount}
            </span>
          )}
        </button>

        {/* 활성 조건 태그 (패널 닫혔을 때) */}
        {!filtersOpen && hasConditions && (
          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            {filterTree.map((group, gi) => (
              group.conditions.filter(c => c.value.trim()).map((c, ci) => {
                const fieldLabel = QB_FIELDS.find(f => f.key === c.field)?.label ?? c.field
                const opLabel = OP_LABELS[c.operator as keyof typeof OP_LABELS] ?? c.operator
                const isNot = c.operator === 'not_equals' || c.operator === 'not_contains'
                return (
                  <span key={`${gi}-${ci}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-11 font-semibold ${isNot ? 'bg-ds-error/10 text-ds-error' : 'bg-ds-tertiary/10 text-ds-tertiary'}`}>
                    {gi > 0 && ci === 0 && (
                      <span className="opacity-70 mr-0.5">{filterTree[gi - 1].joinOperator}</span>
                    )}
                    {fieldLabel} <span className="opacity-70">{opLabel}</span> {c.value}
                  </span>
                )
              })
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="더 보기: 내보내기·프리셋"
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-ds-on-surface-variant rounded-lg hover:bg-ds-surface-container-low hover:text-ds-on-surface transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
              {presets.length > 0 && <span className="text-11 tabular-nums">{presets.length}</span>}
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full mt-1 z-40 w-56 bg-white border border-ds-outline-variant/20 rounded-lg shadow-ambient-md py-1">
                <button role="menuitem" className={MENU_ITEM} disabled={!hasResults} onClick={() => { setMenuOpen(false); onExport() }}>
                  <Download className="w-3.5 h-3.5" /> Excel로 내보내기
                </button>
                <button
                  role="menuitem" className={MENU_ITEM} disabled={!hasResults}
                  title="자동 사용이력 수집이 실패했을 때, Deletion Workflow의 사용이력 반영 태스크에 그대로 업로드할 수 있는 형식(Rule Name / Unused Days)으로 내보냅니다."
                  onClick={() => { setMenuOpen(false); onExportUsage() }}
                >
                  <Download className="w-3.5 h-3.5" /> 사용이력 내보내기 (삭제 워크플로우용)
                </button>
                <div className="my-1 border-t border-ds-outline-variant/10" />
                <button
                  role="menuitem" className={MENU_ITEM} disabled={!hasConditions}
                  onClick={() => { setMenuOpen(false); setShowPresetInput(true); onFiltersOpenChange(true) }}
                >
                  <BookmarkPlus className="w-3.5 h-3.5" /> 현재 조건을 프리셋으로 저장
                </button>
                {presets.length > 0 && (
                  <div className="mt-1 border-t border-ds-outline-variant/10 pt-1">
                    <div className="px-3 py-1 text-11 font-semibold text-ds-on-surface-variant">프리셋</div>
                    {presets.map(p => (
                      <div key={p.name} className="flex items-center gap-1 pr-2 hover:bg-ds-surface-container-low">
                        <button role="menuitem" className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 text-xs text-left text-ds-on-surface" onClick={() => loadPreset(p)}>
                          <Bookmark className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{p.name}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`프리셋 ${p.name} 삭제`}
                          className="p-1 text-ds-on-surface-variant hover:text-ds-error shrink-0"
                          onClick={() => persist(presets.filter(x => x.name !== p.name))}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={onReset} className="text-xs font-medium text-ds-on-surface-variant hover:text-ds-on-surface px-2.5 py-1.5 rounded-lg hover:bg-ds-surface-container-low transition-colors">
            초기화
          </button>
          <Button
            variant="gradient"
            size="auto"
            onClick={onSearch}
            disabled={searchDisabled || searching}
            className="text-xs font-semibold px-4 py-1.5 rounded-lg"
          >
            {searching ? '검색 중…' : '검색'}
          </Button>
        </div>
      </div>

      {filtersOpen && (
        <div className="border-t border-ds-outline-variant/10 bg-ds-surface-container-low/30 px-4 py-3 rounded-b-xl">
          <p className="text-11 text-ds-on-surface-variant mb-2">조건을 추가하고 검색하세요. AND/OR 토글로 조건을 결합하고, 그룹 추가로 괄호 묶음을 만들 수 있습니다.</p>
          {showPresetInput && (
            <div className="flex items-center gap-1 mb-2">
              <input
                autoFocus
                value={presetNameInput}
                onChange={e => setPresetNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setShowPresetInput(false) }}
                placeholder="프리셋 이름"
                aria-label="프리셋 이름"
                className="h-7 px-2 text-xs border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary w-40"
              />
              <button onClick={savePreset} className="text-xs font-semibold text-ds-tertiary px-2 py-1 rounded hover:bg-ds-tertiary/10 transition-colors">저장</button>
              <button onClick={() => setShowPresetInput(false)} aria-label="프리셋 저장 취소" className="text-xs text-ds-on-surface-variant px-1 py-1 rounded hover:bg-ds-surface-container-low transition-colors"><X className="w-3 h-3" /></button>
            </div>
          )}
          <QueryBuilder tree={filterTree} onTreeChange={onFilterTreeChange} />
        </div>
      )}
    </div>
  )
}
