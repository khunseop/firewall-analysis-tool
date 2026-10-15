import { Link, useNavigate } from 'react-router-dom'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { AnalysisTaskListItem } from '@/api/analysis'
import type { AnalysisProject } from '@/api/analysisProjects'
import { formatDate } from '@/lib/utils'
import { AnalysisStatus } from './StatusBadge'
import { describeTaskParams, describeTaskResult, formatDuration, isActiveTask } from './analysisModel'
import type { HistoryRow } from './useAnalysisHistory'

const TH = 'text-left py-2 px-3 font-semibold text-ds-on-surface-variant text-11'

const RESULT_TONE = {
  running: 'text-ds-tertiary', failure: 'text-ds-error', zero: 'text-emerald-800 font-semibold',
  count: 'text-ds-on-surface font-semibold', unknown: 'text-ds-on-surface-variant',
} as const

/**
 * 분석 이력 표 — 분석 실행과 프로젝트를 한 목록에 두되, 종류 칸과 결과 칸으로 둘을 구분한다.
 * 결과 칸은 "진행 중 / 실패 / 정상 완료 0건 / N건"을 서로 다른 문구로 보여준다.
 */
export function AnalysisHistoryTable({
  rows, onRerun, onDelete,
}: {
  rows: HistoryRow[]
  onRerun: (task: AnalysisTaskListItem) => void
  onDelete: (row: HistoryRow) => void
}) {
  const navigate = useNavigate()
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b border-ds-outline-variant/20">
          <th scope="col" className={`${TH} w-24`}>상태</th>
          <th scope="col" className={TH}>종류</th>
          <th scope="col" className={TH}>장비</th>
          <th scope="col" className={TH} title="분석을 실행할 때 사용한 기준입니다. '기록 없음'은 기준을 저장하기 전에 실행된 이력이고, '—'는 기준이 없는 분석입니다.">기준</th>
          <th scope="col" className={TH}>결과</th>
          <th scope="col" className={`${TH} w-44`}>실행 시각</th>
          <th scope="col" className={`${TH} w-24`}>실행자</th>
          <th scope="col" className={`${TH} w-36`}><span className="sr-only">작업</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const quick = row.kind === 'quick' ? (row.raw as AnalysisTaskListItem) : null
          const project = row.kind === 'project' ? (row.raw as AnalysisProject) : null
          const result = quick ? describeTaskResult(quick) : null
          const duration = quick ? formatDuration(quick.started_at, quick.completed_at) : null
          const busy = quick ? isActiveTask(quick) : false
          const basis = quick ? describeTaskParams(quick) : null
          return (
            <tr
              key={row.id}
              onClick={() => navigate(row.href)}
              className="border-b border-ds-outline-variant/10 hover:bg-black/[0.02] focus-within:bg-ds-tertiary/[0.04] cursor-pointer align-top"
            >
              <td className="py-2.5 px-3"><AnalysisStatus meta={row.status} /></td>
              <td className="py-2.5 px-3">
                <Link to={row.href} onClick={(e) => e.stopPropagation()} className="text-13 font-semibold text-ds-tertiary hover:underline">
                  {row.typeLabel}
                </Link>
                {row.kind === 'project' && (
                  <div className="text-11 text-ds-on-surface-variant mt-0.5">
                    <span className="inline-flex px-1.5 rounded bg-ds-surface-container font-semibold mr-1">프로젝트</span>
                    {row.title}
                  </div>
                )}
              </td>
              <td className="py-2.5 px-3">
                <div className="font-mono text-xs font-semibold text-ds-on-surface">{row.deviceName}</div>
                <div className="font-mono text-11 text-ds-on-surface-variant">{row.deviceIp}</div>
              </td>
              <td className="py-2.5 px-3 text-xs text-ds-on-surface-variant">
                {quick ? (basis === '기준 없음' ? <span title="이 분석은 기준 설정이 없습니다" aria-label="기준 없음">—</span> : basis)
                  : (project?.reference_date ? `기준일 ${project.reference_date}` : '기준일 없음')}
              </td>
              <td className="py-2.5 px-3 text-xs">
                {result
                  ? <span className={`${RESULT_TONE[result.kind]} break-words`}>{result.text}</span>
                  : <span className="text-ds-on-surface-variant">단계별로 진행하는 프로젝트</span>}
              </td>
              <td className="py-2.5 px-3 text-xs text-ds-on-surface-variant tabular-nums">
                <div>{formatDate(row.timestamp)}</div>
                {duration && <div className="text-11">소요 {duration}</div>}
              </td>
              <td className="py-2.5 px-3 text-xs text-ds-on-surface-variant">{quick?.requested_by_username ?? '—'}</td>
              <td className="py-2.5 px-3">
                <div className="flex items-center justify-end gap-1">
                  {quick && !busy && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRerun(quick) }}
                      aria-label={`${row.typeLabel} ${row.deviceName} 같은 설정으로 다시 실행`}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold text-ds-on-surface-variant hover:text-ds-tertiary hover:bg-ds-tertiary/10 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />재실행
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete(row) }}
                    disabled={busy}
                    aria-label={busy ? `${row.typeLabel} ${row.deviceName}: 진행 중에는 삭제할 수 없습니다` : `${row.typeLabel} ${row.deviceName} 삭제`}
                    title={busy ? '진행 중에는 삭제할 수 없습니다' : undefined}
                    className="p-2 rounded text-ds-on-surface-variant hover:text-ds-error hover:bg-ds-error/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
