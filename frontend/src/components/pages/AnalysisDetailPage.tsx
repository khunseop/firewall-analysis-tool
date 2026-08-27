import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import type { ColDef, RowStyle, RowClassParams } from '@ag-grid-community/core'
import { AgGridWrapper } from '@/components/shared/AgGridWrapper'
import { getAnalysisTaskDetail, getAnalysisTaskResult, deleteAnalysisTask } from '@/api/analysis'
import { getDevice } from '@/api/devices'
import { exportStyledToExcel } from '@/api/firewall'
import type { StyledExcelPayload } from '@/api/firewall'
import { saveBlob } from '@/api/client'
import { ImpactMovePreviewDialog } from '@/components/pages/ImpactMovePreviewDialog'
import { formatRelativeTime, formatDate } from '@/lib/utils'
import { queryKeys } from '@/api/queryKeys'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { getQuickModule } from './analysis-modules'

const STATUS_LABELS: Record<string, { label: string; dot: string; text: string }> = {
  pending:     { label: '대기중', dot: 'bg-ds-outline',                text: 'text-ds-on-surface-variant' },
  in_progress: { label: '분석중', dot: 'bg-ds-tertiary animate-pulse', text: 'text-ds-tertiary' },
  success:     { label: '완료',   dot: 'bg-emerald-500',               text: 'text-emerald-700' },
  failure:     { label: '실패',   dot: 'bg-ds-error',                  text: 'text-ds-error' },
}

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
  summary, completedAt, onExport, onDownloadScript,
}: {
  summary: string
  completedAt: string | null; onExport: () => void; onDownloadScript?: () => void
}) {
  return (
    <div className="card rounded-xl px-5 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
        <div>
          <p className="text-[13px] font-semibold text-ds-on-surface">{summary}</p>
          {completedAt && (
            <p className="text-[11px] text-ds-on-surface-variant/60 mt-0.5">분석 완료: {formatRelativeTime(completedAt)}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onDownloadScript && (
          <button
            onClick={onDownloadScript}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
          >
            <Download className="w-3 h-3" />
            이동 스크립트(PaloAlto)
          </button>
        )}
        <button
          onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
        >
          <Download className="w-3 h-3" />
          Excel
        </button>
      </div>
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

  const { data: device } = useQuery({
    queryKey: queryKeys.device(task?.device_id),
    queryFn: () => getDevice(task!.device_id),
    enabled: !!task?.device_id,
  })

  const resultQuery = useQuery({
    queryKey: queryKeys.analysisTaskResult(id),
    queryFn: () => getAnalysisTaskResult(id),
    enabled: !!id && task?.task_status === 'success',
    retry: false,
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
      toast.success('분석 작업이 삭제되었습니다.')
      navigate('/analysis')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDelete = async () => {
    const ok = await confirm({
      title: '분석 결과 삭제',
      description: '이 분석 결과를 삭제하시겠습니까?',
      variant: 'destructive',
      confirmLabel: '삭제',
    })
    if (ok) deleteMutation.mutate()
  }

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
    return <div className="py-16 text-center text-[13px] text-ds-on-surface-variant">로딩 중…</div>
  }

  if (!task) {
    return <div className="py-16 text-center text-[13px] text-ds-on-surface-variant">분석 작업을 찾을 수 없습니다.</div>
  }

  const currentStatus = STATUS_LABELS[task.task_status] ?? null
  const columnDefs = module?.columns(onRuleNameClick, setPreviewRow) ?? []
  const rowStyleFn = module?.rowStyle

  return (
    <div className="flex flex-col gap-6">
      {ConfirmDialogElement}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/analysis')}
            className="p-1.5 rounded-lg text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">
              {module?.label ?? task.task_type}
            </h1>
            <p className="text-[12px] text-ds-on-surface-variant mt-0.5">
              {device ? `${device.name} (${device.ip_address})` : `장비 ID ${task.device_id}`}
            </p>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={task.task_status === 'in_progress'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant hover:text-ds-error hover:bg-ds-error/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3.5 h-3.5" />
          삭제
        </button>
      </div>

      <div className="flex items-center gap-4">
        {currentStatus && (
          <div className="flex flex-col gap-0.5">
            <span className={`flex items-center gap-1.5 text-[12px] font-semibold ${currentStatus.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${currentStatus.dot}`} />
              {currentStatus.label}
            </span>
            {task.task_status === 'failure' && task.error_message && (
              <span className="text-[11px] text-ds-error/80 font-mono max-w-lg truncate" title={task.error_message}>
                {task.error_message}
              </span>
            )}
          </div>
        )}
        <div className="text-[11px] text-ds-on-surface-variant/70 space-y-0.5">
          <p>생성: {formatDate(task.created_at)}</p>
          {task.completed_at && <p>완료: {formatDate(task.completed_at)}</p>}
        </div>
      </div>

      {task.task_status === 'success' && (
        resultQuery.isLoading ? (
          <div className="py-16 text-center text-[13px] text-ds-on-surface-variant">결과 로딩 중…</div>
        ) : !resultQuery.data ? (
          <div className="card rounded-xl py-16 text-center text-[13px] text-ds-on-surface-variant">
            저장된 분석 결과가 없습니다 (탐지된 항목이 없을 수 있습니다).
          </div>
        ) : (
          <>
            <ResultSummary
              summary={module?.summary(results) ?? `${results.length}건`}
              completedAt={resultQuery.data.created_at ?? null}
              onExport={() => {
                const payload = buildExcelPayload(results, columnDefs, rowStyleFn ?? (() => undefined), `분석결과_${task.task_type}`)
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
                <span className="text-[13px] font-semibold text-ds-on-surface">분석 결과 상세</span>
                <span className="text-[11px] text-ds-on-surface-variant/60 tabular-nums">{results.length.toLocaleString()}건</span>
              </div>
              <AgGridWrapper
                columnDefs={columnDefs}
                rowData={results}
                getRowId={resultRowId}
                getRowStyle={rowStyleFn}
                height="calc(100vh - 340px)"
                noRowsText="분석 결과가 없습니다."
              />
            </div>
          </>
        )
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
