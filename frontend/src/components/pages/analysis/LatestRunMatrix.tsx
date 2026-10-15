import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, XCircle, Clock } from 'lucide-react'
import type { AnalysisTaskListItem } from '@/api/analysis'
import { formatRelativeTime } from '@/lib/utils'
import { QUICK_MODULES } from '../analysis-modules'
import { describeTaskResult, isActiveTask } from './analysisModel'

/** 이 일수 이상 지난 결과는 "오래됨"으로 표시해, 최신처럼 보이는 낡은 값으로 오인되지 않게 한다. */
export const STALE_RESULT_DAYS = 30
const DAY_MS = 86_400_000
/** 장비가 많을 때 기본으로 보여 줄 "조치 필요 장비" 최대 행 수. */
const COLLAPSED_ROW_LIMIT = 10

const isStale = (t: AnalysisTaskListItem) =>
  !isActiveTask(t) && Math.floor((Date.now() - new Date(t.created_at).getTime()) / DAY_MS) >= STALE_RESULT_DAYS

const shortLabel = (label: string) => label.replace(/ 분석$/, '')

/**
 * 장비 × 분석 유형별 "마지막 실행 결과". 별도 계산 없이 이미 쌓인 이력에서 뽑아낸 값이며,
 * 전 장비의 최신 현황이 아니라 "마지막으로 돌린 시점 기준"이라는 점을 셀의 경과 시간으로 드러낸다.
 */
export function LatestRunMatrix({
  tasks, truncated, error, onRetry,
}: {
  tasks: AnalysisTaskListItem[]
  truncated: boolean
  /** 조회에 실패해 표시할 이력이 없을 때의 오류 메시지 — "실행한 분석이 없음"과 구분해 보여준다. */
  error?: string | null
  onRetry?: () => void
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('fat_analysis_matrix_open') !== '0' } catch { return true }
  })
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem('fat_analysis_matrix_open', v ? '0' : '1') } catch { /* 저장 실패는 무시 */ }
    return !v
  })

  const [showAll, setShowAll] = useState(false)

  const { devices, latest } = useMemo(() => {
    const byDevice = new Map<number, { name: string; cells: Map<string, AnalysisTaskListItem> }>()
    for (const t of tasks) {
      const entry = byDevice.get(t.device_id) ?? { name: t.device_name, cells: new Map() }
      const cur = entry.cells.get(t.task_type)
      if (!cur || new Date(t.created_at).getTime() > new Date(cur.created_at).getTime()) entry.cells.set(t.task_type, t)
      byDevice.set(t.device_id, entry)
    }
    return {
      devices: [...byDevice.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'ko')),
      latest: byDevice,
    }
  }, [tasks])

  // 접힌 상태에서도 "조치가 필요한 셀"이 몇 개인지 보이도록 마지막 결과 기준으로 센다.
  // 장비가 많아도 훑을 수 있게, 장비별 실패·오래됨 수를 같이 구해 조치 필요 장비를 위로 올린다.
  const { attention, ranked } = useMemo(() => {
    let failed = 0, stale = 0
    const perDevice = new Map<number, { failed: number; stale: number }>()
    for (const [id, d] of latest.entries()) {
      const c = { failed: 0, stale: 0 }
      for (const t of d.cells.values()) {
        const res = describeTaskResult(t)
        if (res.kind === 'running') continue
        if (res.kind === 'failure') c.failed += 1
        else if (isStale(t)) c.stale += 1
      }
      failed += c.failed; stale += c.stale
      perDevice.set(id, c)
    }
    const ranked = [...devices].sort((a, b) => {
      const ca = perDevice.get(a[0])!, cb = perDevice.get(b[0])!
      return (cb.failed - ca.failed) || (cb.stale - ca.stale)
    })
    return { attention: { failed, stale }, ranked: ranked.map(([id, d]) => ({ id, d, ...perDevice.get(id)! })) }
  }, [latest, devices])

  const needAction = ranked.filter((r) => r.failed + r.stale > 0)
  const visible = showAll ? ranked : needAction.slice(0, COLLAPSED_ROW_LIMIT)
  const hiddenCount = ranked.length - visible.length

  return (
    <section aria-label="마지막 실행 현황">
      <button
        type="button" onClick={toggle} aria-expanded={open} aria-controls="analysis-latest-matrix"
        className="flex items-center gap-2 text-13 font-semibold text-ds-on-surface-variant hover:text-ds-on-surface"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
        마지막 실행 현황 {open ? '접기' : '보기'}
        {!error && devices.length > 0 && (
          <span className="flex items-center gap-2 text-11 font-semibold">
            {attention.failed === 0 && attention.stale === 0 ? (
              <span className="text-emerald-800">실패·오래됨 없음</span>
            ) : (
              <>
                {attention.failed > 0 && <span className="inline-flex items-center gap-1 text-ds-error"><XCircle className="w-3.5 h-3.5" aria-hidden="true" />실패 {attention.failed}</span>}
                {attention.stale > 0 && <span className="inline-flex items-center gap-1 text-amber-800"><Clock className="w-3.5 h-3.5" aria-hidden="true" />오래됨 {attention.stale}</span>}
              </>
            )}
            {!open && <span className="font-normal text-ds-on-surface-variant">장비 {devices.length}대 · 마지막 실행 기준</span>}
          </span>
        )}
      </button>

      {open && (
        <div id="analysis-latest-matrix" className="card rounded-xl mt-3 overflow-x-auto max-h-96 overflow-y-auto">
          {error ? (
            <div role="alert" className="px-4 py-4 flex items-center gap-3 text-xs text-ds-error">
              <span className="flex-1">
                <span className="font-semibold">마지막 실행 현황을 불러오지 못했습니다.</span>{' '}
                <span className="text-ds-on-surface-variant">실행한 분석이 없는 것이 아니라 조회에 실패했습니다. ({error})</span>
              </span>
              {onRetry && (
                <button type="button" onClick={onRetry} className="px-3 py-1.5 font-semibold rounded-lg border border-ds-outline-variant/30 text-ds-on-surface hover:bg-ds-surface-container-low shrink-0">다시 시도</button>
              )}
            </div>
          ) : devices.length === 0 ? (
            <p className="px-4 py-6 text-xs text-ds-on-surface-variant">아직 실행한 분석이 없습니다.</p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <caption className="text-left px-4 py-2 text-11 text-ds-on-surface-variant">
                각 칸은 해당 장비에서 그 분석을 마지막으로 돌린 결과입니다 — 현재 상태가 아니라 그때 기준입니다.
                {truncated ? ` 최근 이력 일부 기준입니다.` : ''}
              </caption>
              <thead className="sticky top-0 z-10">
                <tr className="border-y border-ds-outline-variant/15 bg-ds-surface-container-low">
                  <th scope="col" className="text-left font-semibold text-ds-on-surface-variant px-4 py-2">장비</th>
                  {QUICK_MODULES.map((m) => (
                    <th key={m.type} scope="col" className="text-left font-semibold text-ds-on-surface-variant px-3 py-2 whitespace-nowrap">{shortLabel(m.label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ id: deviceId, d }) => (
                  <tr key={deviceId} className="border-b border-ds-outline-variant/8">
                    <th scope="row" className="text-left px-4 py-2 font-mono font-semibold text-ds-on-surface whitespace-nowrap">{d.name}</th>
                    {QUICK_MODULES.map((m) => {
                      const t = latest.get(deviceId)?.cells.get(m.type)
                      if (!t) return <td key={m.type} className="px-3 py-2 text-ds-on-surface-variant">미실행</td>
                      const res = describeTaskResult(t)
                      const stale = res.kind !== 'failure' && isStale(t)
                      return (
                        <td key={m.type} className="px-3 py-2 align-top">
                          <Link to={`/analysis/${t.id}`} className="block hover:underline">
                            <span className={`flex items-center gap-1 font-semibold ${res.kind === 'failure' ? 'text-ds-error' : 'text-ds-on-surface'}`}>
                              {res.kind === 'failure' && <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                              {res.kind === 'failure' ? '실패' : res.kind === 'running' ? '진행 중' : res.kind === 'unknown' ? '건수 기록 없음'
                                : `${(t.result_count ?? 0).toLocaleString()}건`}
                            </span>
                            <span className={`flex items-center gap-1 tabular-nums ${stale ? 'text-amber-800 font-semibold' : 'text-ds-on-surface-variant'}`}>
                              {stale && <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />}
                              {formatRelativeTime(t.created_at)}{stale ? ' · 오래됨' : ''}
                            </span>
                          </Link>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={QUICK_MODULES.length + 1} className="px-4 py-2 text-11 text-ds-on-surface-variant border-t border-ds-outline-variant/15">
                    {showAll
                      ? `전체 ${ranked.length}대 · 조치가 필요한 장비를 위에 모았습니다. `
                      : needAction.length === 0
                        ? `실패하거나 ${STALE_RESULT_DAYS}일 넘은 결과가 있는 장비가 없습니다. `
                        : `조치가 필요한 장비 ${needAction.length}대${hiddenCount > 0 && needAction.length > COLLAPSED_ROW_LIMIT ? ` 중 ${COLLAPSED_ROW_LIMIT}대` : ''}만 표시 중입니다. `}
                    {(showAll || hiddenCount > 0) && (
                      <button type="button" onClick={() => setShowAll((v) => !v)} className="font-semibold text-ds-tertiary hover:underline">
                        {showAll ? '조치 필요 장비만 보기' : `전체 ${ranked.length}대 보기`}
                      </button>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
