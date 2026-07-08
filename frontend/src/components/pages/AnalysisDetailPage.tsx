import React, { useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Download } from 'lucide-react'
import type { ColDef, RowStyle, RowClassParams } from '@ag-grid-community/core'
import { AgGridWrapper } from '@/components/shared/AgGridWrapper'
import { getAnalysisTaskDetail, getAnalysisTaskResult } from '@/api/analysis'
import { getDevice } from '@/api/devices'
import { exportStyledToExcel } from '@/api/firewall'
import type { StyledExcelPayload } from '@/api/firewall'
import { formatNumber, formatRelativeTime, formatDate } from '@/lib/utils'
import { queryKeys } from '@/api/queryKeys'

const ANALYSIS_TYPE_LABELS: Record<string, string> = {
  redundancy: '중복 정책 분석',
  unused: '미사용 정책 분석',
  impact: '정책 이동 영향 분석',
  unreferenced_objects: '미참조 오브젝트 분석',
  risky_ports: '위험 포트 분석',
  over_permissive: '과허용 정책 분석',
}

const STATUS_LABELS: Record<string, { label: string; dot: string; text: string }> = {
  pending:     { label: '대기중', dot: 'bg-ds-outline',                text: 'text-ds-on-surface-variant' },
  in_progress: { label: '분석중', dot: 'bg-ds-tertiary animate-pulse', text: 'text-ds-tertiary' },
  success:     { label: '완료',   dot: 'bg-emerald-500',               text: 'text-emerald-700' },
  failure:     { label: '실패',   dot: 'bg-ds-error',                  text: 'text-ds-error' },
}

const resultRowId = (p: { data: Record<string, unknown> }) => String(p.data.id ?? p.data.policy_id ?? JSON.stringify(p.data))

// Policy fields accessed from nested policy sub-object (all analyzers wrap policy data under "policy" key)
const pv = (key: string) => (p: { data?: Record<string, unknown> }) => (p.data?.policy as Record<string, unknown> | undefined)?.[key] ?? p.data?.[key]

function makePolicyCols(onRuleNameClick?: (name: string) => void): ColDef[] {
  return [
    { headerName: '순번',        filter: 'agNumberColumnFilter', width: 70,  valueGetter: pv('seq') },
    {
      headerName: '정책명', filter: 'agTextColumnFilter', width: 160, valueGetter: pv('rule_name'),
      ...(onRuleNameClick && {
        cellRenderer: (p: { value: string }) => {
          if (!p.value) return null
          return React.createElement('button', {
            className: 'text-ds-primary underline-offset-2 hover:underline text-left w-full truncate',
            onClick: () => onRuleNameClick(p.value),
          }, p.value)
        },
      }),
    },
    { headerName: '액션',        filter: 'agTextColumnFilter',   width: 80,  valueGetter: pv('action') },
    { headerName: '활성',        width: 70,  valueGetter: pv('enable'), valueFormatter: (p) => (p.value ? '활성' : '비활성') },
    { headerName: '출발지',      filter: 'agTextColumnFilter',   width: 200, valueGetter: pv('source') },
    { headerName: '목적지',      filter: 'agTextColumnFilter',   width: 200, valueGetter: pv('destination') },
    { headerName: '서비스',      filter: 'agTextColumnFilter',   width: 160, valueGetter: pv('service') },
    { headerName: '사용자',      filter: 'agTextColumnFilter',   width: 100, valueGetter: pv('user') },
    { headerName: '보안 프로파일', filter: 'agTextColumnFilter', width: 130, valueGetter: pv('security_profile') },
    { headerName: '카테고리',    filter: 'agTextColumnFilter',   width: 100, valueGetter: pv('category') },
    { headerName: '설명',        filter: 'agTextColumnFilter',   width: 150, valueGetter: pv('description') },
    { headerName: '마지막 사용일', filter: 'agTextColumnFilter', width: 130, valueGetter: pv('last_hit_date') },
    { headerName: 'VSYS',        filter: 'agTextColumnFilter',   width: 80,  valueGetter: pv('vsys') },
  ]
}

function getColumnDefs(analysisType: string, onRuleNameClick?: (name: string) => void): ColDef[] {
  if (analysisType === 'redundancy') {
    return [
      { field: 'set_number', headerName: '중복번호', filter: 'agNumberColumnFilter', pinned: 'left', width: 100, valueFormatter: (p) => formatNumber(p.value) },
      {
        field: 'type', headerName: '구분', filter: 'agTextColumnFilter', pinned: 'left', width: 100,
        valueFormatter: (p) => p.value === 'UPPER' ? '상위 정책' : p.value === 'LOWER' ? '하위 정책' : p.value ?? '',
        cellStyle: (p) => {
          if (p.value === 'UPPER') return { color: '#005bc4', fontWeight: '500' }
          if (p.value === 'LOWER') return { color: '#b26b00', fontWeight: '500' }
          return null
        },
      },
      ...makePolicyCols(onRuleNameClick),
    ]
  }
  if (analysisType === 'unused') {
    return [
      { field: 'reason', headerName: '미사용 사유', filter: 'agTextColumnFilter', pinned: 'left', width: 150 },
      { field: 'days_unused', headerName: '미사용 일수', filter: 'agNumberColumnFilter', width: 120, valueFormatter: (p) => p.value ? `${p.value}일` : '-' },
      ...makePolicyCols(onRuleNameClick),
    ]
  }
  if (analysisType === 'unreferenced_objects') {
    return [
      { field: 'object_name', headerName: '객체명', filter: 'agTextColumnFilter', pinned: 'left', width: 200 },
      {
        field: 'object_type', headerName: '객체 유형', filter: 'agTextColumnFilter', width: 150,
        valueFormatter: (p) => {
          const map: Record<string, string> = { network_object: '네트워크 객체', network_group: '네트워크 그룹', service: '서비스 객체', service_group: '서비스 그룹' }
          return map[p.value as string] ?? p.value
        },
      },
    ]
  }
  if (analysisType === 'risky_ports') {
    return [
      {
        headerName: '위험 포트', filter: 'agTextColumnFilter', width: 200,
        cellStyle: { color: '#9f403d', fontWeight: '500' },
        valueGetter: (p) => {
          const ports = p.data?.removed_risky_ports
          if (Array.isArray(ports)) return ports.map((r: Record<string, unknown>) => r.definition ?? String(r)).join(', ')
          return p.data?.risky_port_def ?? ''
        },
      },
      { headerName: '서비스', filter: 'agTextColumnFilter', width: 160, valueGetter: (p) => p.data?.policy?.service ?? '' },
      ...makePolicyCols(onRuleNameClick),
    ]
  }
  if (analysisType === 'over_permissive') {
    return [
      { field: 'source_range_size', headerName: '출발지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      { field: 'destination_range_size', headerName: '목적지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      { field: 'service_range_size', headerName: '서비스 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      ...makePolicyCols(onRuleNameClick),
    ]
  }
  if (analysisType === 'impact') {
    return [
      {
        field: 'impact_type', headerName: '영향 유형', filter: 'agTextColumnFilter', pinned: 'left', width: 150,
        cellStyle: (p) => {
          const v = String(p.value ?? '')
          if (v.includes('최대 안전')) return { color: '#1f7a4d', fontWeight: '600' }
          if (v.includes('차단')) return { color: '#9f403d', fontWeight: '500' }
          if (v.includes('Shadow')) return { color: '#b26b00', fontWeight: '500' }
          return null
        },
      },
      { field: 'reason', headerName: '사유 / 이동 요약', filter: 'agTextColumnFilter', width: 420, wrapText: true, autoHeight: true, cellStyle: { lineHeight: '1.5', paddingTop: '6px', paddingBottom: '6px', whiteSpace: 'normal' } },
      ...makePolicyCols(onRuleNameClick),
    ]
  }
  return makePolicyCols(onRuleNameClick)
}

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

function getRowStyle(analysisType: string) {
  return (p: RowClassParams<Record<string, unknown>>): RowStyle | undefined => {
    if (!p.data) return undefined
    if (analysisType === 'redundancy') {
      if (p.data.type === 'UPPER') return { backgroundColor: '#e8f4fd' }
      if (p.data.type === 'LOWER') return { backgroundColor: '#fff8e1' }
    }
    if (analysisType === 'impact' && String(p.data.impact_type ?? '').includes('최대 안전')) {
      return { backgroundColor: '#eaf6ee' }
    }
    return undefined
  }
}

function ResultSummary({
  analysisType, results, completedAt, onExport,
}: {
  analysisType: string; results: unknown[]
  completedAt: string | null; onExport: () => void
}) {
  const summary = useMemo(() => {
    const r = results as Record<string, unknown>[]
    if (analysisType === 'redundancy') {
      const sets = new Set(r.map((x) => x['set_number']))
      const upper = r.filter((x) => x['type'] === 'UPPER').length
      const lower = r.filter((x) => x['type'] === 'LOWER').length
      return `${sets.size}개 중복 세트 발견 (상위 ${upper}건 / 하위 ${lower}건)`
    }
    if (analysisType === 'unused') return `미사용 정책 ${r.length}건`
    if (analysisType === 'unreferenced_objects') {
      const net = r.filter((x) => ['network_object', 'network_group'].includes(String(x['object_type'] ?? ''))).length
      const svc = r.filter((x) => ['service', 'service_group'].includes(String(x['object_type'] ?? ''))).length
      return `미참조 객체 ${r.length}건 (네트워크 ${net}건, 서비스 ${svc}건)`
    }
    if (analysisType === 'risky_ports') return `위험 포트 허용 정책 ${r.length}건`
    if (analysisType === 'over_permissive') return `과허용 정책 ${r.length}건`
    if (analysisType === 'impact') {
      const summaries = r.filter((x) => x['impact_type'] === '최대 안전 이동 위치').length
      const conflicts = r.length - summaries
      return `이동 대상 ${summaries}건 분석 완료 (충돌 ${conflicts}건 발견)`
    }
    return `${r.length}건`
  }, [analysisType, results])

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
      <button
        onClick={onExport}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
      >
        <Download className="w-3 h-3" />
        Excel
      </button>
    </div>
  )
}

export function AnalysisDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const id = Number(taskId)

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

  if (taskQuery.isLoading) {
    return <div className="py-16 text-center text-[13px] text-ds-on-surface-variant">로딩 중…</div>
  }

  if (!task) {
    return <div className="py-16 text-center text-[13px] text-ds-on-surface-variant">분석 작업을 찾을 수 없습니다.</div>
  }

  const currentStatus = STATUS_LABELS[task.task_status] ?? null
  const results = Array.isArray(resultQuery.data?.result_data) ? resultQuery.data!.result_data : []
  const columnDefs = getColumnDefs(task.task_type, onRuleNameClick)
  const rowStyleFn = getRowStyle(task.task_type)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate('/analysis')}
          className="p-1.5 rounded-lg text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">
            {ANALYSIS_TYPE_LABELS[task.task_type] ?? task.task_type}
          </h1>
          <p className="text-[12px] text-ds-on-surface-variant mt-0.5">
            {device ? `${device.name} (${device.ip_address})` : `장비 ID ${task.device_id}`}
          </p>
        </div>
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
              analysisType={task.task_type}
              results={results}
              completedAt={resultQuery.data.created_at ?? null}
              onExport={() => {
                const payload = buildExcelPayload(
                  results as Record<string, unknown>[],
                  columnDefs,
                  rowStyleFn,
                  `분석결과_${task.task_type}`,
                )
                exportStyledToExcel(payload).catch((e: Error) => toast.error(e.message))
              }}
            />
            <div className="card rounded-xl">
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-[13px] font-semibold text-ds-on-surface">분석 결과 상세</span>
                <span className="text-[11px] text-ds-on-surface-variant/60 tabular-nums">{results.length.toLocaleString()}건</span>
              </div>
              <AgGridWrapper
                columnDefs={columnDefs}
                rowData={results as Record<string, unknown>[]}
                getRowId={resultRowId}
                getRowStyle={rowStyleFn as (p: RowClassParams<Record<string, unknown>>) => RowStyle | undefined}
                domLayout="autoHeight"
                noRowsText="분석 결과가 없습니다."
              />
            </div>
          </>
        )
      )}
    </div>
  )
}
