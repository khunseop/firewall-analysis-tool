import { AlertTriangle } from 'lucide-react'
import { daysSinceHit } from '@/lib/utils'

/** 그리드 셀용 인라인 태그 (고정 높이, 최대 2개 + 개수) */
export function InlineTagCell({ value }: { value: string }) {
  const names = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (names.length === 0) return <span className="text-11 text-ds-on-surface-variant">-</span>
  const MAX = 2
  const visible = names.slice(0, MAX)
  const extra = names.length - MAX
  return (
    <div className="flex items-center gap-1 overflow-hidden" title={extra > 0 ? names.join(', ') : undefined}>
      {visible.map((name, i) => (
        <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-11 font-mono bg-ds-surface-container text-ds-on-surface whitespace-nowrap shrink-0">
          {name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-11 font-semibold text-ds-on-surface-variant whitespace-nowrap shrink-0">+{extra}</span>
      )}
    </div>
  )
}

/** 마지막 사용일 스마트 렌더 */
export function LastHitCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-11 font-medium text-amber-700">사용 기록 없음</span>
  const days = daysSinceHit(value)
  if (days === null) return <span className="text-11 text-ds-on-surface-variant">-</span>
  if (days >= 90) {
    return (
      <span className="inline-flex items-center gap-1 text-11 font-semibold text-ds-error">
        <AlertTriangle className="w-3 h-3" />{days}일 미사용
      </span>
    )
  }
  if (days >= 30) return <span className="text-11 font-medium text-amber-700">{days}일 전</span>
  return <span className="text-11 text-ds-on-surface-variant">{days}일 전</span>
}
