import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Play } from 'lucide-react'
import type { ColDef, RowStyle, RowClassParams } from '@ag-grid-community/core'
import Select from 'react-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { AgGridWrapper } from '@/components/shared/AgGridWrapper'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { listDevices } from '@/api/devices'
import { getPolicies } from '@/api/firewall'
import { startAnalysis, getAnalysisStatus, getLatestAnalysisResult, type StartAnalysisParams } from '@/api/analysis'
import { formatNumber } from '@/lib/utils'

const ANALYSIS_TYPES = [
  { value: 'redundancy', label: '중복 정책 분석' },
  { value: 'unused', label: '미사용 정책 분석' },
  { value: 'impact', label: '정책 이동 영향 분석' },
  { value: 'unreferenced_objects', label: '미참조 오브젝트 분석' },
  { value: 'risky_ports', label: '위험 포트 분석' },
  { value: 'over_permissive', label: '과허용 정책 분석' },
]

// Policy column definitions shared across analysis types
const POLICY_COLS: ColDef[] = [
  { field: 'rule_name', headerName: '정책명', filter: 'agTextColumnFilter', width: 160 },
  { field: 'seq', headerName: '순번', filter: 'agNumberColumnFilter', width: 70 },
  { field: 'action', headerName: '액션', filter: 'agTextColumnFilter', width: 80 },
  { field: 'enable', headerName: '활성', width: 70, valueFormatter: (p) => (p.value ? '활성' : '비활성') },
  { field: 'source', headerName: '출발지', filter: 'agTextColumnFilter', width: 200 },
  { field: 'destination', headerName: '목적지', filter: 'agTextColumnFilter', width: 200 },
  { field: 'service', headerName: '서비스', filter: 'agTextColumnFilter', width: 160 },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 150 },
  { field: 'vsys', headerName: 'VSYS', filter: 'agTextColumnFilter', width: 80 },
]

function getColumnDefs(analysisType: string): ColDef[] {
  if (analysisType === 'redundancy') {
    return [
      { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', pinned: 'left', width: 120 },
      {
        field: 'set_number', headerName: '중복번호', filter: 'agNumberColumnFilter', pinned: 'left', width: 100,
        valueFormatter: (p) => formatNumber(p.value),
      },
      {
        field: 'type', headerName: '구분', filter: 'agTextColumnFilter', pinned: 'left', width: 100,
        valueFormatter: (p) => p.value === 'UPPER' ? '상위 정책' : p.value === 'LOWER' ? '하위 정책' : p.value ?? '',
        cellStyle: (p) => {
          if (p.value === 'UPPER') return { color: '#1976d2', fontWeight: '500' }
          if (p.value === 'LOWER') return { color: '#f57c00', fontWeight: '500' }
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
      { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', pinned: 'left', width: 120 },
      {
        field: 'risky_port_def', headerName: '위험 포트', filter: 'agTextColumnFilter', width: 150,
        cellStyle: { color: '#d32f2f', fontWeight: '500' },
      },
      {
        field: 'protocol', headerName: '프로토콜', filter: 'agTextColumnFilter', width: 100,
        valueGetter: (p) => p.data?.policy?.service ?? p.data?.protocol ?? '',
      },
      ...POLICY_COLS,
    ]
  }
  if (analysisType === 'over_permissive') {
    return [
      { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', pinned: 'left', width: 120 },
      { field: 'source_range_size', headerName: '출발지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      { field: 'destination_range_size', headerName: '목적지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      { field: 'service_range_size', headerName: '서비스 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
      ...POLICY_COLS,
    ]
  }
  if (analysisType === 'impact') {
    return [
      { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', pinned: 'left', width: 120 },
      {
        field: 'impact_type', headerName: '영향 유형', filter: 'agTextColumnFilter', pinned: 'left', width: 120,
        cellStyle: (p) => {
          if (p.value === 'AFFECTED') return { color: '#d32f2f', fontWeight: '500' }
          if (p.value === 'TARGET') return { color: '#1976d2', fontWeight: '500' }
          return null
        },
      },
      ...POLICY_COLS,
    ]
  }
  return POLICY_COLS
}

function getRowStyle(analysisType: string) {
  return (p: RowClassParams<Record<string, unknown>>): RowStyle | undefined => {
    if (!p.data) return undefined
    if (analysisType === 'impact' && p.data.is_target_policy) {
      return { backgroundColor: '#e3f2fd' }
    }
    if (analysisType === 'redundancy') {
      if (p.data.type === 'UPPER') return { backgroundColor: '#e8f4fd' }
      if (p.data.type === 'LOWER') return { backgroundColor: '#fff8e1' }
    }
    return undefined
  }
}

function PolicyMultiSelect({
  deviceId,
  value,
  onChange,
  placeholder,
}: {
  deviceId: number | null
  value: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
}) {
  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['policies-raw', deviceId],
    queryFn: () => getPolicies(deviceId!),
    enabled: !!deviceId,
    staleTime: 60_000,
  })

  const options = policies.map((p) => ({ value: p.id, label: `[${p.seq}] ${p.rule_name}` }))
  const selectedOptions = options.filter((o) => value.includes(o.value))

  return (
    <Select
      isMulti
      isLoading={isLoading}
      options={options}
      value={selectedOptions}
      onChange={(vals) => onChange(vals.map((v) => v.value))}
      placeholder={placeholder ?? '정책 선택...'}
      noOptionsMessage={() => '정책이 없습니다'}
      styles={{ control: (b) => ({ ...b, fontSize: '14px', minHeight: '36px' }), menu: (b) => ({ ...b, fontSize: '14px' }) }}
    />
  )
}

const STATUS_LABELS: Record<string, string> = {
  pending: '대기중', in_progress: '분석중', completed: '완료', failed: '실패',
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

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  const statusQuery = useQuery({
    queryKey: ['analysis-status', deviceId],
    queryFn: () => getAnalysisStatus(deviceId!),
    enabled: !!deviceId && isPolling,
    refetchInterval: isPolling ? 2000 : false,
  })

  const taskStatus = statusQuery.data

  // Stop polling when done
  useEffect(() => {
    if (!taskStatus) return
    if (taskStatus.task_status === 'completed' || taskStatus.task_status === 'failed') {
      setIsPolling(false)
      if (taskStatus.task_status === 'completed') {
        toast.success('분석이 완료되었습니다.')
        loadResults()
      } else {
        toast.error('분석에 실패했습니다.')
      }
    }
  }, [taskStatus?.task_status])

  const loadResults = async () => {
    if (!deviceId) return
    try {
      const result = await getLatestAnalysisResult(deviceId, analysisType)
      const data = Array.isArray(result.result_data) ? result.result_data : []
      setResults(data)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  const startMutation = useMutation({
    mutationFn: () => {
      if (!deviceId) throw new Error('장비를 선택하세요.')
      const params: StartAnalysisParams = {
        days: analysisType === 'unused' ? Number(days) : undefined,
        targetPolicyIds: targetPolicyIds.length > 0 ? targetPolicyIds : undefined,
        newPosition: analysisType === 'impact' ? Number(newPosition) : undefined,
        moveDirection: analysisType === 'impact' ? moveDirection : undefined,
      }
      return startAnalysis(deviceId, analysisType, params)
    },
    onSuccess: () => {
      toast.info('분석이 시작되었습니다.')
      setIsPolling(true)
      setResults([])
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const columnDefs = getColumnDefs(analysisType)
  const rowStyleFn = getRowStyle(analysisType)

  const needsPolicySelect = ['impact', 'risky_ports', 'over_permissive'].includes(analysisType)
  const needsNewPosition = analysisType === 'impact'

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">정책 분석</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>장비 *</Label>
              <DeviceSelect devices={devices} value={deviceId} onChange={setDeviceId} />
            </div>
            <div className="space-y-1.5">
              <Label>분석 유형 *</Label>
              <ShadSelect value={analysisType} onValueChange={(v) => { setAnalysisType(v); setTargetPolicyIds([]); setResults([]) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ANALYSIS_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
          </div>

          {/* Conditional params */}
          {analysisType === 'unused' && (
            <div className="space-y-1.5 max-w-xs">
              <Label>미사용 기준 (일)</Label>
              <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} min="1" className="w-32" />
            </div>
          )}

          {needsPolicySelect && (
            <div className="space-y-1.5">
              <Label>{analysisType === 'impact' ? '이동할 정책 *' : '분석 대상 정책 (선택 시 해당 정책만)'}</Label>
              <PolicyMultiSelect
                deviceId={deviceId}
                value={targetPolicyIds}
                onChange={setTargetPolicyIds}
                placeholder={analysisType === 'impact' ? '이동할 정책을 선택하세요...' : '전체 정책 분석 (선택 안 하면 전체)'}
              />
            </div>
          )}

          {needsNewPosition && (
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div className="space-y-1.5">
                <Label>이동 후 순번 *</Label>
                <Input type="number" value={newPosition} onChange={(e) => setNewPosition(e.target.value)} placeholder="순번 입력" />
              </div>
              <div className="space-y-1.5">
                <Label>이동 방향</Label>
                <ShadSelect value={moveDirection} onValueChange={setMoveDirection}>
                  <SelectTrigger><SelectValue placeholder="선택 (선택사항)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">선택 안 함</SelectItem>
                    <SelectItem value="before">before</SelectItem>
                    <SelectItem value="after">after</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={() => startMutation.mutate()}
              disabled={!deviceId || startMutation.isPending || isPolling}
              className="gap-1.5"
            >
              <Play className="h-3.5 w-3.5" />
              {isPolling ? '분석 중...' : '분석 시작'}
            </Button>
            {isPolling && taskStatus && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse inline-block" />
                {STATUS_LABELS[taskStatus.task_status] ?? taskStatus.task_status}
              </div>
            )}
            {!isPolling && taskStatus && (
              <Badge variant={taskStatus.task_status === 'completed' ? 'default' : 'destructive'}>
                {STATUS_LABELS[taskStatus.task_status] ?? taskStatus.task_status}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              분석 결과 <span className="text-muted-foreground font-normal ml-2 text-xs">{results.length.toLocaleString()}건</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 px-4 pb-4">
            <AgGridWrapper
              columnDefs={columnDefs}
              rowData={results as Record<string, unknown>[]}
              getRowId={(p) => String(p.data.id ?? JSON.stringify(p.data))}
              getRowStyle={rowStyleFn as (p: RowClassParams<Record<string, unknown>>) => RowStyle | undefined}
              height="calc(100vh - 320px)"
              noRowsText="분석 결과가 없습니다."
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
