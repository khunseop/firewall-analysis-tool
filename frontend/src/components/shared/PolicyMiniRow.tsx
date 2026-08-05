export function PolicyMiniRow({
  ruleName, action, seq, isMoved, isNew, newSeqLabel,
}: {
  ruleName: string
  action: string
  seq?: number | string | null
  isMoved?: boolean
  isNew?: boolean
  newSeqLabel?: string
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 text-[12px] rounded-md ${
        isNew
          ? 'bg-emerald-500/10 font-semibold text-ds-on-surface'
          : isMoved
            ? 'bg-ds-tertiary/15 font-semibold text-ds-on-surface'
            : 'text-ds-on-surface-variant'
      }`}
    >
      <span className="w-12 shrink-0 tabular-nums">{newSeqLabel ?? seq ?? '-'}</span>
      <span className={`w-14 shrink-0 ${action === 'deny' ? 'text-ds-error' : 'text-emerald-600'}`}>{action}</span>
      <span className="flex-1 truncate">{ruleName}</span>
      {isNew && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/25 text-ds-on-surface">신규</span>}
      {isMoved && !isNew && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-ds-tertiary/25 text-ds-on-surface">이동 대상</span>}
    </div>
  )
}
