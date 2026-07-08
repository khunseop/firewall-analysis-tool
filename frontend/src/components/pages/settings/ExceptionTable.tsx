import { useState, useEffect } from 'react'
import { Plus, Trash2, ChevronLeft, ChevronRight, Search } from 'lucide-react'

export interface ExceptionItem { id?: string; name?: string; pattern?: string; reason: string; start?: string; until?: string }

export const EX_PAGE_SIZE = 20

export function ExceptionTable({
  title, items, keyField, keyPlaceholder, onAdd, onRemove, onUpdate
}: {
  title: string
  items: ExceptionItem[]
  keyField: 'id' | 'name' | 'pattern'
  keyPlaceholder: string
  onAdd: () => void
  onRemove: (idx: number) => void
  onUpdate: (idx: number, patch: Partial<ExceptionItem>) => void
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => { setPage(0) }, [search])

  const withIdx = items.map((item, i) => ({ item, i }))
  const filtered = search
    ? withIdx.filter(({ item }) =>
        [item[keyField], item.reason, item.start, item.until]
          .some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()))
      )
    : withIdx
  const totalPages = Math.max(1, Math.ceil(filtered.length / EX_PAGE_SIZE))
  const paged = filtered.slice(page * EX_PAGE_SIZE, (page + 1) * EX_PAGE_SIZE)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-ds-on-surface shrink-0">{title}</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ds-on-surface-variant/50 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색"
              className="h-7 pl-6 pr-2 text-[11px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary w-32"
            />
          </div>
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-ds-tertiary bg-ds-tertiary/8 border border-ds-tertiary/20 rounded-lg hover:bg-ds-tertiary/12 transition-colors shrink-0"
          >
            <Plus className="w-3 h-3" />
            추가
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-ds-outline-variant/8">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-ds-outline-variant/8 bg-ds-surface-container-low/30">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">{keyPlaceholder}</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">사유</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-28">시작일</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-28">만료일</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ds-outline-variant/8">
            {paged.map(({ item, i }) => (
              <tr key={i} className="hover:bg-ds-surface-container-low/20">
                <td className="px-3 py-1.5">
                  <input
                    value={(item[keyField] as string) ?? ''}
                    onChange={(e) => onUpdate(i, { [keyField]: e.target.value })}
                    placeholder={keyPlaceholder}
                    className="w-full h-7 px-2 text-[12px] font-mono bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={item.reason ?? ''}
                    onChange={(e) => onUpdate(i, { reason: e.target.value })}
                    placeholder="예외 사유"
                    className="w-full h-7 px-2 text-[12px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="date"
                    value={item.start ?? ''}
                    onChange={(e) => onUpdate(i, { start: e.target.value || undefined })}
                    className="w-full h-7 px-2 text-[11px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="date"
                    value={item.until ?? ''}
                    onChange={(e) => onUpdate(i, { until: e.target.value || undefined })}
                    className="w-full h-7 px-2 text-[11px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => onRemove(i)} className="p-1 rounded hover:bg-red-50 text-ds-error transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[12px] text-ds-on-surface-variant italic">
                  {search ? '검색 결과가 없습니다.' : '등록된 항목이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-[11px] text-ds-on-surface-variant">
        <span>{filtered.length}개 항목</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="p-0.5 rounded hover:bg-ds-surface-container-high disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="p-0.5 rounded hover:bg-ds-surface-container-high disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 중복정책 예외 테이블 (장비별, 유효기간 기반)
// ──────────────────────────────────────────────────────────────────
