import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import type { AnalysisTaskListItem } from '@/api/analysis'
import type { AnalysisProject } from '@/api/analysisProjects'
import { describeTaskParams, formatDuration } from './analysisModel'
import { useNow } from './useNow'
import type { HistoryRow } from './useAnalysisHistory'

/**
 * 진행 중인 작업만 모아 보여준다 — 없으면 아무것도 그리지 않는다.
 * 백엔드에 진행률이 없으므로 퍼센트 대신 "진행 중 + 경과 시간"으로 표현하고, 상태가 바뀌면 보조기술에 알린다.
 */
export function RunningTasksStrip({ rows }: { rows: HistoryRow[] }) {
  const now = useNow(rows.length > 0)
  if (rows.length === 0) return null

  return (
    <section aria-label="진행 중인 작업" className="card rounded-xl px-4 py-3 shrink-0" role="status" aria-live="polite">
      <p className="text-13 font-semibold text-ds-on-surface mb-2 flex items-center gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-ds-tertiary" aria-hidden="true" />
        진행 중 {rows.length}건
      </p>
      <ul className="divide-y divide-ds-outline-variant/8">
        {rows.map((r) => {
          const quick = r.kind === 'quick' ? (r.raw as AnalysisTaskListItem) : null
          const elapsed = quick ? formatDuration(quick.started_at ?? quick.created_at, null, now) : null
          return (
            <li key={r.id} className="py-1.5 flex items-center gap-3 text-xs">
              <span className="font-semibold text-ds-on-surface w-44 truncate">{r.typeLabel}</span>
              <span className="font-mono text-ds-on-surface-variant w-40 truncate">{r.deviceName}</span>
              <span className="text-ds-on-surface-variant flex-1 min-w-0 truncate">
                {quick ? describeTaskParams(quick) : (r.raw as AnalysisProject).name}
              </span>
              <span className="text-ds-tertiary font-semibold tabular-nums shrink-0">{r.status.label}{elapsed ? ` · ${elapsed}` : ''}</span>
              <Link to={r.href} className="text-ds-tertiary font-semibold hover:underline shrink-0">보기</Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
