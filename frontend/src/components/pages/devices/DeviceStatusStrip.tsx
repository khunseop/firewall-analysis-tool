import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

export type DeviceStatusFilter = 'success' | 'syncing' | 'error'

export interface DeviceSyncCounts { total: number; synced: number; syncing: number; error: number }

/**
 * 동기화 상태 요약 — 각 항목을 누르면 목록이 해당 상태의 장비로 좁혀진다(다시 누르면 해제).
 * "오류 N대"를 한 번 눌러 실패한 장비만 모아 보는 것이 이 줄의 주된 용도다.
 */
export function DeviceStatusStrip({
  counts, active, onChange, loading,
}: {
  counts: DeviceSyncCounts
  active: DeviceStatusFilter | null
  onChange: (next: DeviceStatusFilter | null) => void
  loading: boolean
}) {
  const val = (n: number) => (loading ? '…' : n)
  const chip = (key: DeviceStatusFilter, label: string, count: number, icon: React.ReactNode, tone: string) => {
    const isActive = active === key
    return (
      <button
        type="button"
        aria-pressed={isActive}
        onClick={() => onChange(isActive ? null : key)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${tone} ${
          isActive ? 'bg-ds-tertiary/10 ring-1 ring-ds-tertiary/40' : 'hover:bg-ds-surface-container-low'
        }`}
      >
        {icon}
        <span>{label}</span>
        <span className="font-bold tabular-nums">{val(count)}</span>
      </button>
    )
  }

  return (
    <div className="shrink-0 card rounded-xl px-3 py-1.5 flex items-center gap-1 flex-wrap">
      <span className="text-13 font-bold tabular-nums text-ds-on-surface pr-2">전체 {val(counts.total)}대</span>
      {chip('success', '완료', counts.synced, <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />, 'text-ds-on-surface-variant')}
      {chip('syncing', '진행', counts.syncing, <Loader2 className={`w-3.5 h-3.5 shrink-0 ${counts.syncing > 0 ? 'text-ds-tertiary animate-spin' : 'text-ds-on-surface-variant'}`} />, counts.syncing > 0 ? 'text-ds-tertiary font-semibold' : 'text-ds-on-surface-variant')}
      {chip('error', '오류', counts.error, <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${counts.error > 0 ? 'text-ds-error' : 'text-ds-on-surface-variant'}`} />, counts.error > 0 ? 'text-ds-error font-semibold' : 'text-ds-on-surface-variant')}
    </div>
  )
}
