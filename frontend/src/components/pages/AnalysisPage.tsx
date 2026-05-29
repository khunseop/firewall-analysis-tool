import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Play, Download, Copy, Clock, ArrowLeftRight, Unlink, ShieldAlert, Expand, Check } from 'lucide-react'
import type { ColDef, RowStyle, RowClassParams } from '@ag-grid-community/core'
import Select from 'react-select'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AgGridWrapper } from '@/components/shared/AgGridWrapper'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { listDevices } from '@/api/devices'
import { getPolicies, exportStyledToExcel } from '@/api/firewall'
import type { StyledExcelPayload } from '@/api/firewall'
import { startAnalysis, getAnalysisStatus, getLatestAnalysisResult, type StartAnalysisParams } from '@/api/analysis'
import { formatNumber, formatRelativeTime } from '@/lib/utils'
import { notify } from '@/store/notificationStore'
import type { LucideIcon } from 'lucide-react'

interface AnalysisTypeOption {
  value: string
  label: string
  icon: LucideIcon
  description: string
}

const ANALYSIS_TYPES: AnalysisTypeOption[] = [
  { value: 'redundancy',           label: '중복 정책 분석',      icon: Copy,          description: '동일하거나 포함 관계에 있는 정책을 탐지합니다. 상위/하위 정책 쌍으로 결과를 보여줍니다.' },
  { value: 'unused',               label: '미사용 정책 분석',     icon: Clock,         description: '설정 기간 동안 트래픽이 발생하지 않은 정책을 탐지합니다.' },
  { value: 'impact',               label: '정책 이동 영향 분석',  icon: ArrowLeftRight, description: '정책을 다른 순번으로 이동했을 때 차단·섀도우 영향을 사전 분석합니다.' },
  { value: 'unreferenced_objects', label: '미참조 오브젝트 분석', icon: Unlink,        description: '어떤 정책에도 사용되지 않는 네트워크/서비스 객체를 탐지합니다.' },
  { value: 'risky_ports',          label: '위험 포트 분석',       icon: ShieldAlert,   description: 'Well-known 위험 포트(예: Telnet, FTP)가 허용된 정책을 탐지합니다.' },
  { value: 'over_permissive',      label: '과허용 정책 분석',     icon: Expand,        description: '출발지·목적지·서비스 범위가 과도하게 넓게 설정된 정책을 탐지합니다.' },
]

// Policy fields accessed from nested policy sub-object (all analyzers wrap policy data under "policy" key)
const pv = (key: string) => (p: { data?: Record<string, unknown> }) => (p.data?.policy as Record<string, unknown> | undefined)?.[key] ?? p.data?.[key]

const POLICY_COLS: ColDef[] = [
  { headerName: '순번',        filter: 'agNumberColumnFilter', width: 70,  valueGetter: pv('seq') },
  { headerName: '정책명',      filter: 'agTextColumnFilter',   width: 160, valueGetter: pv('rule_name') },
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

function getColumnDefs(analysisType: string): ColDef[] {
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
      ...POLICY_COLS,
    ]
  }
  if (analysisType === 'unused') {
    return [
      { field: 'reason', headerName: '미사용 사유', filter: 'agTextColumnFilter', pinned: 'left', width: 150 },
      { field: 'days_unused', headerName: '미사용 일수', filter: 'agNumberColumnFilter', width: 120, valueFormatter: (p) => p.value ? `${p.value}일` : '-' },
      ...POLICY_COLS,
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
      ...POLICY_COLS,
    ]
  }
  if (analysisType === 'over_permissive') {
    return [
      { field: 'source_range_size', headerName: '출발지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      { field: 'destination_range_size', headerName: '목적지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      { field: 'service_range_size', headerName: '서비스 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      ...POLICY_COLS,
    ]
  }
  if (analysisType === 'impact') {
    return [
      {
        field: 'impact_type', headerName: '영향 유형', filter: 'agTextColumnFilter', pinned: 'left', width: 150,
        cellStyle: (p) => {
          const v = String(p.value ?? '')
          if (v.includes('차단')) return { color: '#9f403d', fontWeight: '500' }
          if (v.includes('Shadow')) return { color: '#b26b00', fontWeight: '500' }
          return null
        },
      },
      { field: 'reason', headerName: '사유', filter: 'agTextColumnFilter', width: 300 },
      ...POLICY_COLS,
    ]
  }
  return POLICY_COLS
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    return undefined
  }
}

function PolicyMultiSelect({ deviceId, value, onChange, placeholder }: {
  deviceId: number | null; value: number[]; onChange: (ids: number[]) => void; placeholder?: string
}) {
  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['policies-raw', deviceId],
    queryFn: () => getPolicies(deviceId!),
    enabled: !!deviceId, staleTime: 60_000,
  })
  const options = policies.map((p) => ({ value: p.id, label: `[${p.seq}] ${p.rule_name}` }))
  return (
    <Select
      isMulti isLoading={isLoading} options={options}
      value={options.filter((o) => value.includes(o.value))}
      onChange={(vals) => onChange(vals.map((v) => v.value))}
      placeholder={placeholder ?? '정책 선택…'} noOptionsMessage={() => '정책이 없습니다'}
      styles={{
        control: (b) => ({ ...b, fontSize: '14px', minHeight: '36px', borderColor: 'rgba(169,180,185,0.3)', backgroundColor: '#ffffff' }),
        menu: (b) => ({ ...b, fontSize: '14px' }),
      }}
    />
  )
}

function ResultSummary({
  analysisType, results, days, completedAt, onExport,
}: {
  analysisType: string; results: unknown[]; days: string
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
    if (analysisType === 'unused') return `${days}일 이상 미사용 정책 ${r.length}건`
    if (analysisType === 'unreferenced_objects') {
      const net = r.filter((x) => ['network_object','network_group'].includes(String(x['object_type'] ?? ''))).length
      const svc = r.filter((x) => ['service','service_group'].includes(String(x['object_type'] ?? ''))).length
      return `미참조 객체 ${r.length}건 (네트워크 ${net}건, 서비스 ${svc}건)`
    }
    if (analysisType === 'risky_ports') return `위험 포트 허용 정책 ${r.length}건`
    if (analysisType === 'over_permissive') return `과허용 정책 ${r.length}건`
    if (analysisType === 'impact') return `영향받는 정책 ${r.length}건`
    return `${r.length}건`
  }, [analysisType, results, days])

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

const STATUS_LABELS: Record<string, { label: string; dot: string; text: string }> = {
  pending:     { label: '대기중', dot: 'bg-ds-outline',                text: 'text-ds-on-surface-variant' },
  in_progress: { label: '분석중', dot: 'bg-ds-tertiary animate-pulse', text: 'text-ds-tertiary' },
  success:     { label: '완료',   dot: 'bg-emerald-500',               text: 'text-emerald-700' },
  failure:     { label: '실패',   dot: 'bg-ds-error',                  text: 'text-ds-error' },
}

export function AnalysisPage() {
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [analysisType, setAnalysisType] = useState('redundancy')
  const [days, setDays] = useState('90')
  const [targetPolicyIds, setTargetPolicyIds] = useState<number[]>([])
  const [newPosition, setNewPosition] = useState('')
  const [moveDirection, setMoveDirection] = useState('')
  const [isPolling, setIsPolling] = useState(false)
  const [results, setResults] = useState<unknown[]>([])
  const [resultCompletedAt, setResultCompletedAt] = useState<string | null>(null)

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  const statusQuery = useQuery({
    queryKey: ['analysis-status', deviceId],
    queryFn: () => getAnalysisStatus(deviceId!),
    enabled: !!deviceId && isPolling,
    refetchInterval: isPolling ? 2000 : false,
  })

  const taskStatus = statusQuery.data

  const loadResults = async (devId = deviceId, type = analysisType) => {
    if (!devId) return
    try {
      const result = await getLatestAnalysisResult(devId, type)
      setResults(Array.isArray(result.result_data) ? result.result_data : [])
      setResultCompletedAt(result.created_at ?? null)
    } catch {
      // No prior result — clear grid silently
      setResults([])
      setResultCompletedAt(null)
    }
  }

  useEffect(() => {
    if (!taskStatus) return
    if (taskStatus.task_status === 'success' || taskStatus.task_status === 'failure') {
      setIsPolling(false)
      const deviceName = devices.find(d => d.id === deviceId)?.name
      if (taskStatus.task_status === 'success') {
        notify('분석 완료', deviceName ?? `장비 ID ${deviceId}`, 'success', { category: 'analysis', device_id: deviceId ?? undefined, device_name: deviceName })
        loadResults(deviceId ?? undefined, analysisType)
      } else {
        notify('분석 실패', deviceName ?? `장비 ID ${deviceId}`, 'error', { category: 'analysis', device_id: deviceId ?? undefined, device_name: deviceName })
      }
    }
  }, [taskStatus?.task_status])

  // Auto-load last result when device or analysis type changes
  useEffect(() => {
    setResults([])
    setResultCompletedAt(null)
    if (deviceId) loadResults(deviceId, analysisType)
  }, [deviceId, analysisType])

  const startMutation = useMutation({
    mutationFn: () => {
      if (!deviceId) throw new Error('장비를 선택하세요.')
      const p: StartAnalysisParams = {
        days: analysisType === 'unused' ? Number(days) : undefined,
        targetPolicyIds: targetPolicyIds.length > 0 ? targetPolicyIds : undefined,
        newPosition: analysisType === 'impact' ? Number(newPosition) : undefined,
        moveDirection: analysisType === 'impact' ? moveDirection : undefined,
      }
      return startAnalysis(deviceId, analysisType, p)
    },
    onSuccess: () => { toast.info('분석이 시작되었습니다.'); setIsPolling(true); setResults([]) },
    onError: (e: Error) => toast.error(e.message),
  })

  const needsPolicySelect = ['impact', 'risky_ports', 'over_permissive'].includes(analysisType)
  const needsNewPosition = analysisType === 'impact'
  const columnDefs = getColumnDefs(analysisType)
  const rowStyleFn = getRowStyle(analysisType)

  const currentStatus = taskStatus ? STATUS_LABELS[taskStatus.task_status] : null

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">정책 분석</h1>
        <p className="text-[13px] text-ds-on-surface-variant/70 mt-0.5">방화벽 정책을 분석하여 보안 이슈와 최적화 포인트를 발견합니다.</p>
      </div>

      {/* 카드 A: 분석 유형 선택 */}
      <div className="card rounded-xl">
        <div className="px-5 py-3">
          <span className="text-[13px] font-semibold text-ds-on-surface">분석 유형</span>
        </div>
        <div className="px-5 pb-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {ANALYSIS_TYPES.map((t) => {
              const Icon = t.icon
              const selected = analysisType === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => { setAnalysisType(t.value); setTargetPolicyIds([]) }}
                  className={`relative text-left p-3.5 rounded-xl border transition-all ${
                    selected
                      ? 'border-ds-primary bg-ds-primary/5 shadow-sm'
                      : 'border-ds-outline-variant/30 hover:border-ds-primary/40 hover:bg-ds-surface-container-low'
                  }`}
                >
                  {selected && (
                    <span className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-ds-primary flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </span>
                  )}
                  <Icon className={`w-4 h-4 mb-2 ${selected ? 'text-ds-primary' : 'text-ds-on-surface-variant'}`} />
                  <p className={`text-[13px] font-semibold leading-tight mb-1 ${selected ? 'text-ds-primary' : 'text-ds-on-surface'}`}>{t.label}</p>
                  <p className="text-[11px] text-ds-on-surface-variant/70 leading-snug">{t.description}</p>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 카드 B: 분석 대상 & 옵션 */}
      <div className="card rounded-xl">
        <div className="px-5 py-3">
          <span className="text-[13px] font-semibold text-ds-on-surface">분석 대상 & 옵션</span>
        </div>
        <div className="px-5 pb-5 space-y-5">
          {/* 장비 선택 */}
          <div className="space-y-1.5 max-w-sm">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">장비 *</label>
            <DeviceSelect devices={devices} value={deviceId} onChange={setDeviceId} />
          </div>

          {analysisType === 'unused' && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">미사용 기준 (일)</label>
              <input
                type="number" value={days} onChange={(e) => setDays(e.target.value)} min="1"
                className="w-32 h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
              />
            </div>
          )}

          {needsPolicySelect && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">
                {analysisType === 'impact' ? '이동할 정책 *' : '분석 대상 정책 (미선택 시 전체)'}
              </label>
              <PolicyMultiSelect
                deviceId={deviceId} value={targetPolicyIds} onChange={setTargetPolicyIds}
                placeholder={analysisType === 'impact' ? '이동할 정책을 선택하세요…' : '전체 정책 분석'}
              />
            </div>
          )}

          {needsNewPosition && (
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">이동 후 순번 *</label>
                <input
                  type="number" value={newPosition} onChange={(e) => setNewPosition(e.target.value)} placeholder="순번 입력"
                  className="w-full h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">이동 방향</label>
                <ShadSelect value={moveDirection || '_none_'} onValueChange={(v) => setMoveDirection(v === '_none_' ? '' : v)}>
                  <SelectTrigger className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm">
                    <SelectValue placeholder="선택 (선택사항)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none_">선택 안 함</SelectItem>
                    <SelectItem value="before">before</SelectItem>
                    <SelectItem value="after">after</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 실행 바 */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => startMutation.mutate()}
          disabled={!deviceId || startMutation.isPending || isPolling}
          className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-lg disabled:opacity-50 transition-all"
        >
          <Play className="w-4 h-4" />
          {isPolling ? '분석 중…' : '분석 시작'}
        </button>

        {currentStatus && (
          <span className={`flex items-center gap-1.5 text-[12px] font-semibold ${currentStatus.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${currentStatus.dot}`} />
            {currentStatus.label}
          </span>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <>
          <ResultSummary
            analysisType={analysisType}
            results={results}
            days={days}
            completedAt={resultCompletedAt}
            onExport={() => {
              const payload = buildExcelPayload(
                results as Record<string, unknown>[],
                columnDefs,
                rowStyleFn,
                `분석결과_${analysisType}`,
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
              getRowId={(p) => String(p.data.id ?? p.data.policy_id ?? JSON.stringify(p.data))}
              getRowStyle={rowStyleFn as (p: RowClassParams<Record<string, unknown>>) => RowStyle | undefined}
              domLayout="autoHeight"
              noRowsText="분석 결과가 없습니다."
            />
          </div>
        </>
      )}
    </div>
  )
}
