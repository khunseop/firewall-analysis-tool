import { AlertTriangle } from 'lucide-react'

export type SummaryFilter = 'allow' | 'deny' | 'disabled' | 'stale' | 'noHit'

export interface PolicySummary {
  total: number
  allow: number
  deny: number
  disabled: number
  stale: number
  noHit: number
}

/**
 * 검색 결과 요약 — 각 항목을 누르면 그리드가 해당 조건으로 좁혀진다(다시 누르면 해제).
 * 집계 기준은 현재 검색 결과 전체이며, 필터를 걸어도 숫자는 바뀌지 않는다.
 */
export function PolicySummaryBar({
  summary, active, onChange,
}: {
  summary: PolicySummary
  active: SummaryFilter | null
  onChange: (next: SummaryFilter | null) => void
}) {
  const chip = (key: SummaryFilter, count: number, className: string, content: React.ReactNode) => {
    if (count === 0) return null
    const isActive = active === key
    return (
      <button
        key={key}
        type="button"
        aria-pressed={isActive}
        onClick={() => onChange(isActive ? null : key)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${className} ${
          isActive ? 'bg-ds-tertiary/10 ring-1 ring-ds-tertiary/40' : 'hover:bg-ds-surface-container-low'
        }`}
      >
        {content}
      </button>
    )
  }

  return (
    <div className="card rounded-xl px-3 py-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 shrink-0">
      <span className="text-sm font-bold text-ds-on-surface tabular-nums pr-2">검색 결과 {summary.total.toLocaleString()}건</span>
      {chip('allow', summary.allow, 'font-semibold text-green-700', <><span className="w-2 h-2 rounded-full bg-green-500" />허용 <span className="tabular-nums">{summary.allow.toLocaleString()}</span></>)}
      {chip('deny', summary.deny, 'font-semibold text-red-700', <><span className="w-2 h-2 rounded-full bg-red-500" />차단 <span className="tabular-nums">{summary.deny.toLocaleString()}</span></>)}
      {chip('disabled', summary.disabled, 'text-ds-on-surface-variant', <><span className="w-2 h-2 rounded-full bg-gray-400" />비활성 <span className="tabular-nums">{summary.disabled.toLocaleString()}</span></>)}
      {chip('stale', summary.stale, 'font-semibold text-amber-800', <><AlertTriangle className="w-3 h-3" />90일+ 미사용 <span className="tabular-nums">{summary.stale.toLocaleString()}</span></>)}
      {chip('noHit', summary.noHit, 'text-ds-on-surface-variant', <>사용 기록 없음 <span className="tabular-nums">{summary.noHit.toLocaleString()}</span></>)}
    </div>
  )
}
