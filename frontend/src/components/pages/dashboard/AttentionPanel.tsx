import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Gauge, Clock } from 'lucide-react'
import type { AttentionGroup, AttentionKind } from './dashboardModel'
import { STALE_SYNC_DAYS } from './dashboardModel'

const KIND_ICON: Record<AttentionKind, typeof AlertTriangle> = {
  error: AlertTriangle, danger: Gauge, never: Clock, stale: Clock, warning: Gauge,
}

const TONE = {
  error: { text: 'text-ds-error', chip: 'border-ds-error/25 bg-ds-error/5 hover:bg-ds-error/10 text-ds-error' },
  warning: { text: 'text-amber-800', chip: 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900' },
}

/**
 * "지금 확인할 장비" — 대시보드의 첫 질문("이상 없나?")에 먼저 답한다.
 * 문제가 있으면 원인별로 묶어 장비명을 칩으로 보여주고, 칩을 누르면 아래 장비 현황이 그 장비로 좁혀진다.
 * 문제가 없으면 정상임을 명시해, "정상"과 "데이터 없음"을 구분할 수 있게 한다.
 */
export function AttentionPanel({
  groups, totalDevices, healthyCount, onFocus, staleSince,
}: {
  groups: AttentionGroup[]
  totalDevices: number
  healthyCount: number
  onFocus: (ids: number[], label: string) => void
  /** 최신 조회에 실패해 이전에 가져온 값을 보여 줄 때, 그 값의 기준 시각 */
  staleSince?: string | null
}) {
  if (totalDevices === 0) {
    return (
      <section aria-label="지금 확인할 장비" className="card rounded-xl px-4 py-3 shrink-0 text-13 text-ds-on-surface-variant">
        등록된 장비가 없습니다. <Link to="/devices" className="font-semibold text-ds-tertiary hover:underline">장비 메뉴</Link>에서 장비를 등록하세요.
      </section>
    )
  }

  if (groups.length === 0) {
    return (
      <section aria-label="지금 확인할 장비" className="card rounded-xl px-4 py-3 shrink-0 flex items-center gap-2 border-emerald-200">
        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
        <span className="text-13 font-semibold text-emerald-800">
          모든 장비가 정상입니다{staleSince ? ` (${staleSince} 기준)` : ''}
        </span>
        <span className="text-11 text-ds-on-surface-variant">
          동기화 오류 없음 · 임계치 80% 미만 · 최근 {STALE_SYNC_DAYS}일 이내 동기화 ({healthyCount}/{totalDevices}대)
        </span>
      </section>
    )
  }

  const flagged = new Set(groups.flatMap((g) => g.items.map((i) => i.id))).size
  return (
    <section aria-label="지금 확인할 장비" className="card rounded-xl shrink-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-ds-outline-variant/10 flex items-center gap-2">
        <span className="text-13 font-semibold text-ds-on-surface">지금 확인할 장비</span>
        <span className="text-11 font-semibold tabular-nums text-ds-on-surface-variant" aria-live="polite">{flagged}대 / 전체 {totalDevices}대{staleSince ? ` · ${staleSince} 기준` : ''}</span>
      </div>
      <ul className="divide-y divide-ds-outline-variant/8">
        {groups.map((g) => {
          const Icon = KIND_ICON[g.kind]
          const tone = TONE[g.tone]
          return (
            <li key={g.kind} className="px-4 py-2.5 flex items-start gap-3">
              <div className={`flex items-center gap-1.5 w-56 shrink-0 pt-1 ${tone.text}`}>
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs font-semibold">{g.label}</span>
                <span className="text-11 tabular-nums">{g.items.length}대</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onFocus([it.id], `${it.name} · ${g.label}`)}
                    aria-label={`${it.name}, ${it.detail}. 장비 현황에서 보기`}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-11 transition-colors ${tone.chip}`}
                  >
                    <span className="font-mono font-semibold">{it.name}</span>
                    <span className="opacity-90">{it.detail}</span>
                  </button>
                ))}
                {g.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onFocus(g.items.map((i) => i.id), `${g.label} ${g.items.length}대`)}
                    className="px-2 py-1 text-11 font-semibold text-ds-tertiary rounded-md hover:bg-ds-tertiary/10"
                  >
                    {g.items.length}대 모두 보기
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
