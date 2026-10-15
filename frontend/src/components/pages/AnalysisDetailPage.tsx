import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Download, Trash2, RotateCcw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import type { ColDef, RowStyle, RowClassParams } from '@ag-grid-community/core'
import { AgGridWrapper } from '@/components/shared/AgGridWrapper'
import { Button } from '@/components/ui/button'
import { getAnalysisTaskDetail, getAnalysisTaskResultOrNull, deleteAnalysisTask } from '@/api/analysis'
import { getDevice } from '@/api/devices'
import { exportStyledToExcel } from '@/api/firewall'
import type { StyledExcelPayload } from '@/api/firewall'
import { saveBlob } from '@/api/client'
import { ImpactMovePreviewDialog } from '@/components/pages/ImpactMovePreviewDialog'
import { formatRelativeTime, formatDate } from '@/lib/utils'
import { queryKeys } from '@/api/queryKeys'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { getQuickModule } from './analysis-modules'
import { AnalysisStatus } from './analysis/StatusBadge'
import { useNow } from './analysis/useNow'
import { describeTaskParams, describeTaskResult, formatDuration, statusMetaOf } from './analysis/analysisModel'

const resultRowId = (p: { data: Record<string, unknown> }) => String(p.data.id ?? p.data.policy_id ?? JSON.stringify(p.data))

function buildExcelPayload(
  rows: Record<string, unknown>[],
  columnDefs: ColDef[],
  rowStyleFn: (p: RowClassParams<Record<string, unknown>>) => RowStyle | undefined,
  filename: string,
): StyledExcelPayload {
  const columns = columnDefs.map((col) => ({
    header: col.headerName ?? String(col.field ?? ''),
    width: Math.max(8, Math.round(((col.width as number) ?? 120) / 7)),
  }))

  const excelRows = rows.map((data) => {
    const values = columnDefs.map((col): string | number | null => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let raw: unknown = typeof col.valueGetter === 'function' ? (col.valueGetter as any)({ data }) : col.field ? data[col.field] : null
      if (typeof col.valueFormatter === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const formatted = (col.valueFormatter as any)({ value: raw, data })
        if (formatted != null && formatted !== '') raw = formatted
      }
      if (raw == null) return null
      if (typeof raw === 'number') return raw
      return String(raw)
    })

    const rowStyle = rowStyleFn({ data } as RowClassParams<Record<string, unknown>>)
    const rowBg = (rowStyle as Record<string, string> | undefined)?.backgroundColor ?? null

    const cellFontColors = columnDefs.map((col, i): string | null => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cs: Record<string, string> | null = typeof col.cellStyle === 'function' ? (col.cellStyle as any)({ value: values[i], data }) : (col.cellStyle as any) ?? null
      return cs?.color ?? null
    })

    return { values, rowBg, cellFontColors }
  })

  return { filename, columns, rows: excelRows }
}

function ResultSummary({
  summary, basis, completedAt, onExport, onDownloadScript,
}: {
  summary: string
  basis: string | null
  completedAt: string | null; onExport: () => void; onDownloadScript?: () => void
}) {
  return (
    <div className="card rounded-xl px-5 py-3 flex items-center justify-between gap-4">
      <div>
        <p className="text-13 font-semibold text-ds-on-surface">{summary}</p>
        <p className="text-11 text-ds-on-surface-variant mt-0.5">
          {basis ? `기준: ${basis}` : ''}{basis && completedAt ? ' · ' : ''}{completedAt ? `분석 완료: ${formatRelativeTime(completedAt)}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onDownloadScript && (
          <button
            onClick={onDownloadScript}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
          >
            <Download className="w-3 h-3" aria-hidden="true" />
            이동 스크립트(PaloAlto)
          </button>
        )}
        <button
          onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
        >
          <Download className="w-3 h-3" aria-hidden="true" />
          Excel
        </button>
      </div>
    </div>
  )
}

function StatePanel({ tone, icon, title, children, action, role }: {
  tone: 'ok' | 'error' | 'neutral' | 'running'
  icon: React.ReactNode
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  role?: 'alert' | 'status'
}) {
  const cls = {
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    error: 'border-ds-error/25 bg-ds-error/5 text-ds-error',
    neutral: 'border-ds-outline-variant/30 bg-ds-surface-container-low text-ds-on-surface',
    running: 'border-ds-tertiary/30 bg-ds-tertiary/5 text-ds-tertiary',
  }[tone]
  return (
    <div role={role} aria-live={role === 'status' ? 'polite' : undefined} className={`rounded-xl border px-5 py-4 flex items-start gap-3 ${cls}`}>
      <span className="mt-0.5 shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-13 font-semibold">{title}</p>
        {children && <div className="text-xs text-ds-on-surface-variant mt-1 leading-relaxed break-words">{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function AnalysisDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const id = Number(taskId)
  const [previewRow, setPreviewRow] = useState<Record<string, unknown> | null>(null)

  const taskQuery = useQuery({
    queryKey: queryKeys.analysisTask(id),
    queryFn: () => getAnalysisTaskDetail(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.task_status
      return status === 'pending' || status === 'in_progress' ? 2000 : false
    },
  })

  const task = taskQuery.data
  const running = task?.task_status === 'pending' || task?.task_status === 'in_progress'
  const now = useNow(!!running)

  const { data: device } = useQuery({
    queryKey: queryKeys.device(task?.device_id),
    queryFn: () => getDevice(task!.device_id),
    enabled: !!task?.device_id,
  })

  // 결과 건수가 0으로 기록된 실행은 저장된 결과가 없는 것이 정상이므로 조회하지 않는다.
  // 조회가 실패(네트워크·서버 오류)한 경우와 "저장된 결과가 없음"(null)을 구분한다.
  const resultQuery = useQuery({
    queryKey: queryKeys.analysisTaskResult(id),
    queryFn: () => getAnalysisTaskResultOrNull(id),
    enabled: !!id && task?.task_status === 'success' && task.result_count !== 0,
    retry: 1,
  })

  const onRuleNameClick = (ruleName: string) => {
    const params = new URLSearchParams({ rule_name: ruleName })
    if (task?.device_id) params.set('device_id', String(task.device_id))
    navigate(`/policies?${params.toString()}`)
  }

  const deleteMutation = useMutation({
    mutationFn: () => deleteAnalysisTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisTasks })
      toast.success('분석 이력을 삭제했습니다.')
      navigate('/analysis')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const results = useMemo(
    () => (Array.isArray(resultQuery.data?.result_data) ? resultQuery.data!.result_data as Record<string, unknown>[] : []),
    [resultQuery.data]
  )
  const module = useMemo(() => (task ? getQuickModule(task.task_type) : undefined), [task])
  // PAN-OS 이동 스크립트는 계산 비용이 있어 결과/장비/모듈이 바뀔 때만 재계산한다.
  const downloadScript = useMemo(
    () => (device && module?.downloadScript
      ? module.downloadScript(results, { name: device.name, vendor: device.vendor })
      : null),
    [device, module, results]
  )

  if (taskQuery.isLoading) {
    return <div className="py-16 text-center text-13 text-ds-on-surface-variant">불러오는 중…</div>
  }

  if (taskQuery.isError || !task) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={() => navigate('/analysis')} aria-label="분석 이력으로 돌아가기" className="self-start flex items-center gap-1.5 text-xs font-semibold text-ds-on-surface-variant hover:text-ds-on-surface">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />분석 이력
        </button>
        <StatePanel
          tone="error" role="alert" icon={<AlertTriangle className="w-4 h-4" />}
          title="분석 작업을 불러오지 못했습니다"
          action={<Button variant="subtle" size="auto" onClick={() => { void taskQuery.refetch() }} className="px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0">다시 시도</Button>}
        >
          {(taskQuery.error as Error | null)?.message ?? '작업을 찾을 수 없습니다. 삭제된 이력일 수 있습니다.'}
        </StatePanel>
      </div>
    )
  }

  const statusMeta = statusMetaOf(task.task_status, 'quick')
  const result = describeTaskResult(task)
  const paramsText = describeTaskParams(task)
  const basis = paramsText === '기준 없음' || paramsText === '기록 없음' ? null : paramsText
  const duration = formatDuration(task.started_at, task.completed_at, now)
  const typeLabel = module?.label ?? task.task_type
  const deviceLabel = device ? `${device.name} (${device.ip_address})` : `장비 ID ${task.device_id}`
  const columnDefs = module?.columns(onRuleNameClick, setPreviewRow) ?? []
  const rowStyleFn = module?.rowStyle

  const rerun = () => navigate('/analysis', {
    state: {
      rerun: {
        type: task.task_type, deviceId: task.device_id,
        values: task.params && module?.paramsToValues ? module.paramsToValues(task.params) : {},
      },
    },
  })

  const handleDelete = async () => {
    const ok = await confirm({
      title: '분석 이력을 삭제할까요?',
      description: `${typeLabel} · ${deviceLabel} · ${formatDate(task.created_at)} 실행 (${result.kind === 'failure' ? '실패한 실행' : result.text}). 저장된 결과도 함께 삭제되며 되돌릴 수 없습니다.`,
      variant: 'destructive',
      confirmLabel: '삭제',
    })
    if (ok) deleteMutation.mutate()
  }

  const showResultBody = task.task_status === 'success' && resultQuery.data
  const finished = task.task_status === 'success' || task.task_status === 'failure'

  return (
    <div className="flex flex-col gap-6">
      {ConfirmDialogElement}
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/analysis')}
            aria-label="분석 이력으로 돌아가기"
            className="p-1.5 mt-0.5 rounded-lg text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">{typeLabel}</h1>
            <p className="text-xs text-ds-on-surface-variant mt-0.5 font-mono">{deviceLabel}</p>
            <p className="text-11 text-ds-on-surface-variant mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
              <AnalysisStatus meta={statusMeta} />
              <span>실행 {formatDate(task.created_at)}</span>
              {duration && <span>소요 {duration}</span>}
              {task.requested_by_username && <span>실행자 {task.requested_by_username}</span>}
              <span>{paramsText === '기준 없음' ? paramsText : `기준 ${paramsText}`}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {finished && module && (
            <Button variant="subtle" size="auto" onClick={rerun} className="gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg">
              <RotateCcw className="!w-3 !h-3" />같은 설정으로 다시 실행
            </Button>
          )}
          <button
            onClick={handleDelete}
            disabled={running}
            title={running ? '진행 중에는 삭제할 수 없습니다' : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ds-on-surface-variant hover:text-ds-error hover:bg-ds-error/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            삭제
          </button>
        </div>
      </div>

      {running && (
        <StatePanel tone="running" role="status" icon={<Loader2 className="w-4 h-4 animate-spin" />} title={`${statusMeta.label}${duration ? ` · 경과 ${duration}` : ''}`}>
          분석이 백그라운드에서 실행되고 있습니다. 이 화면은 자동으로 갱신되며, 끝나면 결과가 여기에 표시됩니다.
        </StatePanel>
      )}

      {task.task_status === 'failure' && (
        <StatePanel
          tone="error" role="alert" icon={<AlertTriangle className="w-4 h-4" />} title="분석이 실패했습니다 — 결과가 없는 것이 아니라 실행되지 못했습니다"
        >
          <span className="font-mono text-ds-error whitespace-pre-wrap">{task.error_message ?? '실패 사유가 기록되지 않았습니다.'}</span>
        </StatePanel>
      )}

      {task.task_status === 'success' && task.result_count === 0 && (
        <StatePanel tone="ok" role="status" icon={<CheckCircle2 className="w-4 h-4" />} title={result.text}>
          {basis ? `${basis} 기준으로 ` : ''}분석이 정상적으로 끝났고 탐지된 항목이 없습니다.
          {' '}(실행 {formatDate(task.completed_at ?? task.created_at)})
        </StatePanel>
      )}

      {task.task_status === 'success' && task.result_count !== 0 && resultQuery.isLoading && (
        <div className="py-16 text-center text-13 text-ds-on-surface-variant">결과를 불러오는 중…</div>
      )}

      {task.task_status === 'success' && task.result_count !== 0 && resultQuery.isError && (
        <StatePanel
          tone="error" role="alert" icon={<AlertTriangle className="w-4 h-4" />} title="분석 결과를 불러오지 못했습니다"
          action={<Button variant="subtle" size="auto" onClick={() => { void resultQuery.refetch() }} className="px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0">다시 시도</Button>}
        >
          결과가 없는 것이 아니라 조회에 실패했습니다. {(resultQuery.error as Error | null)?.message}
        </StatePanel>
      )}

      {task.task_status === 'success' && task.result_count !== 0 && resultQuery.isSuccess && !resultQuery.data && (
        <StatePanel tone="neutral" role="status" icon={<AlertTriangle className="w-4 h-4" />} title="저장된 결과 데이터를 찾을 수 없습니다">
          {task.result_count == null
            ? '이 실행은 결과 건수가 기록되기 전의 이력이라, 탐지된 항목이 없었던 것인지 결과가 연결되지 않은 것인지 구분할 수 없습니다. 같은 설정으로 다시 실행하면 확인할 수 있습니다.'
            : `이력에는 ${task.result_count.toLocaleString()}건으로 기록되어 있지만 결과 데이터가 없습니다.`}
        </StatePanel>
      )}

      {showResultBody && (
        <>
          <ResultSummary
            summary={module?.summary(results) ?? `${results.length}건`}
            basis={basis}
            completedAt={resultQuery.data?.created_at ?? null}
            onExport={() => {
              const stamp = (task.completed_at ?? task.created_at).slice(0, 10)
              const payload = buildExcelPayload(results, columnDefs, rowStyleFn ?? (() => undefined), `분석결과_${typeLabel}_${device?.name ?? task.device_id}_${stamp}`)
              exportStyledToExcel(payload).catch((e: Error) => toast.error(e.message))
            }}
            onDownloadScript={
              downloadScript
                ? () => saveBlob(new Blob([downloadScript.content], { type: 'text/plain' }), downloadScript.filename)
                : undefined
            }
          />
          <div className="card rounded-xl">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-13 font-semibold text-ds-on-surface">분석 결과 상세</span>
              <span className="text-11 text-ds-on-surface-variant tabular-nums">{results.length.toLocaleString()}건</span>
            </div>
            <AgGridWrapper
              columnDefs={columnDefs}
              rowData={results}
              getRowId={resultRowId}
              getRowStyle={rowStyleFn}
              height="calc(100vh - 380px)"
              noRowsText="이 분석의 결과 행이 없습니다."
            />
          </div>
        </>
      )}

      {task.task_type === 'impact' && (
        <ImpactMovePreviewDialog
          open={!!previewRow}
          onOpenChange={(o) => { if (!o) setPreviewRow(null) }}
          deviceId={task.device_id}
          row={previewRow}
        />
      )}
    </div>
  )
}
