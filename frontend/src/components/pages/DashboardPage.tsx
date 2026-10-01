import { useRef, useCallback, useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search, XCircle, AlertTriangle, Gauge } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ColDef } from '@ag-grid-community/core'
import type { GridApi } from '@ag-grid-community/core'
import ReactApexChart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { rowIdFromId } from '@/lib/utils'
import { getDashboardStats, type DeviceStats } from '@/api/devices'
import { getObjectCountHistory, type ChangeStatCategory } from '@/api/firewall'
import { useSyncStatusWebSocket, type SyncWebSocketMessage } from '@/hooks/useWebSocket'
import { notify } from '@/lib/notify'
import { formatNumber, formatRelativeTime } from '@/lib/utils'
import { capacityLevel, CAPACITY_LEVEL_BAR_COLOR, CAPACITY_LEVEL_TEXT_COLOR } from '@/lib/deviceCapacity'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelector'
import { queryKeys } from '@/api/queryKeys'

const CATEGORY_OPTIONS: { value: ChangeStatCategory; label: string }[] = [
  { value: 'policies', label: '정책' },
  { value: 'network_objects', label: '네트워크 객체' },
  { value: 'services', label: '서비스 객체' },
]

const VENDOR_BADGE: Record<string, string> = {
  paloalto: 'bg-orange-50 text-orange-600 border border-orange-100',
  ngf:      'bg-blue-50 text-blue-600 border border-blue-100',
  mf2:      'bg-cyan-50 text-cyan-600 border border-cyan-100',
  mock:     'bg-gray-50 text-gray-500 border border-gray-100',
}
const VENDOR_LABELS: Record<string, string> = {
  paloalto: 'PaloAlto', ngf: 'NGF', mf2: 'MF2', mock: 'Mock',
}


interface DeviceRow {
  id: number; name: string; vendor: string; ip_address?: string
  policies: number; active_policies: number; disabled_policies: number
  network_objects: number; network_groups: number
  services: number; service_groups: number
  sync_status: string | null; sync_step: string | null; sync_time: string | null
  policy_threshold: number | null
  network_object_threshold: number | null
  network_group_threshold: number | null
  service_threshold: number | null
  service_group_threshold: number | null
}

function transformDeviceStats(d: DeviceStats): DeviceRow {
  return {
    id: d.id, name: d.name, vendor: d.vendor, ip_address: d.ip_address,
    policies: d.policies ?? 0,
    active_policies: d.active_policies ?? 0,
    disabled_policies: d.disabled_policies ?? 0,
    network_objects: d.network_objects ?? 0,
    network_groups: d.network_groups ?? 0,
    services: d.services ?? 0,
    service_groups: d.service_groups ?? 0,
    sync_status: d.sync_status,
    sync_step: d.sync_step,
    sync_time: d.sync_time,
    policy_threshold: d.policy_threshold,
    network_object_threshold: d.network_object_threshold,
    network_group_threshold: d.network_group_threshold,
    service_threshold: d.service_threshold,
    service_group_threshold: d.service_group_threshold,
  }
}

function CapacityCell({ usage, threshold }: { usage: number | null; threshold: number | null }) {
  if (usage == null && threshold == null) return <span className="text-xs text-ds-on-surface-variant/40">—</span>
  const level = capacityLevel(usage, threshold)
  const pct = usage != null && threshold != null && threshold > 0 ? Math.round((usage / threshold) * 100) : 0
  const barPct = Math.min(100, pct)
  return (
    <div className="flex flex-col justify-center gap-0.5 py-1">
      <span className={`text-11 font-semibold tabular-nums ${CAPACITY_LEVEL_TEXT_COLOR[level]}`}>
        {usage != null ? `${usage}개` : '—'} / {threshold != null ? `${threshold}개` : '—'}
        {threshold != null && usage != null && ` (${pct}%)`}
      </span>
      <div className="h-1 rounded-full bg-ds-outline-variant/20 overflow-hidden w-20">
        <div className={`h-full rounded-full ${CAPACITY_LEVEL_BAR_COLOR[level]}`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  )
}

// 임계치 컬럼 정렬용 — 임계치 미설정 장비는 항상 맨 아래로 보냄
function capacityPct(usage: number | null | undefined, threshold: number | null | undefined): number {
  if (usage == null || threshold == null || threshold <= 0) return -1
  return usage / threshold
}

interface CapacityMetric { label: string; usage: number; threshold: number; pct: number; level: 'warning' | 'danger' }

function getHighCapacityMetrics(row: DeviceRow): CapacityMetric[] {
  const candidates: { label: string; usage: number; threshold: number | null }[] = [
    { label: '정책', usage: row.policies, threshold: row.policy_threshold },
    { label: '네트워크 객체', usage: row.network_objects, threshold: row.network_object_threshold },
    { label: '네트워크 그룹', usage: row.network_groups, threshold: row.network_group_threshold },
    { label: '서비스 객체', usage: row.services, threshold: row.service_threshold },
    { label: '서비스 그룹', usage: row.service_groups, threshold: row.service_group_threshold },
  ]
  const metrics: CapacityMetric[] = []
  for (const c of candidates) {
    const level = capacityLevel(c.usage, c.threshold)
    if (level === 'normal' || c.threshold == null) continue
    metrics.push({ label: c.label, usage: c.usage, threshold: c.threshold, pct: Math.round((c.usage / c.threshold) * 100), level })
  }
  return metrics
}

const COLUMN_DEFS: ColDef<DeviceRow>[] = [
  {
    field: 'name', headerName: '장비명', flex: 1, minWidth: 140,
    cellRenderer: (p: { data: DeviceRow }) => (
      <div className="flex flex-col justify-center leading-tight">
        <span className="text-xs font-semibold text-ds-on-surface">{p.data.name}</span>
        {p.data.ip_address && (
          <span className="text-10 text-ds-on-surface-variant/60 font-mono mt-0.5">{p.data.ip_address}</span>
        )}
      </div>
    ),
  },
  {
    field: 'vendor', headerName: '벤더',
    cellRenderer: (p: { value: string }) => {
      const cls = VENDOR_BADGE[p.value?.toLowerCase()] ?? 'bg-gray-50 text-gray-500 border border-gray-100'
      return (
        <span className={`inline-flex px-2 py-0.5 rounded text-10 font-bold uppercase tracking-wide ${cls}`}>
          {VENDOR_LABELS[p.value?.toLowerCase()] ?? p.value}
        </span>
      )
    },
  },
  {
    field: 'policies', headerName: '전체 정책',
    valueFormatter: (p) => formatNumber(p.value),
  },
  {
    field: 'active_policies', headerName: '활성 정책',
    valueFormatter: (p) => formatNumber(p.value),
  },
  {
    field: 'disabled_policies', headerName: '비활성 정책',
    valueFormatter: (p) => formatNumber(p.value),
  },
  {
    field: 'network_objects', headerName: '네트워크 객체',
    valueFormatter: (p) => formatNumber(p.value),
  },
  {
    field: 'network_groups', headerName: '네트워크 그룹',
    valueFormatter: (p) => formatNumber(p.value),
  },
  {
    field: 'services', headerName: '서비스',
    valueFormatter: (p) => formatNumber(p.value),
  },
  {
    field: 'service_groups', headerName: '서비스 그룹',
    valueFormatter: (p) => formatNumber(p.value),
  },
  {
    field: 'sync_time', headerName: '마지막 동기화', filter: false,
    valueFormatter: (p) => formatRelativeTime(p.value),
  },
  {
    headerName: '정책 임계치', minWidth: 110,
    valueGetter: (p) => capacityPct(p.data?.policies, p.data?.policy_threshold),
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.policies} threshold={p.data.policy_threshold} />,
  },
  {
    headerName: '네트워크 객체 임계치', minWidth: 130,
    valueGetter: (p) => capacityPct(p.data?.network_objects, p.data?.network_object_threshold),
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.network_objects} threshold={p.data.network_object_threshold} />,
  },
  {
    headerName: '네트워크 그룹 임계치', minWidth: 130,
    valueGetter: (p) => capacityPct(p.data?.network_groups, p.data?.network_group_threshold),
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.network_groups} threshold={p.data.network_group_threshold} />,
  },
  {
    headerName: '서비스 객체 임계치', minWidth: 130,
    valueGetter: (p) => capacityPct(p.data?.services, p.data?.service_threshold),
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.services} threshold={p.data.service_threshold} />,
  },
  {
    headerName: '서비스 그룹 임계치', minWidth: 130,
    valueGetter: (p) => capacityPct(p.data?.service_groups, p.data?.service_group_threshold),
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.service_groups} threshold={p.data.service_group_threshold} />,
  },
]

export function DashboardPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [gridSearch, setGridSearch] = useState('')

  const { data: stats, isLoading } = useQuery({
    queryKey: queryKeys.dashboardStats, queryFn: getDashboardStats, staleTime: 60_000,
  })

  const rowData: DeviceRow[] = stats?.device_stats.map(transformDeviceStats) ?? []

  const handleSyncMessage = useCallback(
    (msg: SyncWebSocketMessage) => {
      if (msg.type !== 'device_sync_status') return
      const api: GridApi<DeviceRow> | null = gridRef.current?.gridApi ?? null
      let deviceName: string | undefined
      if (api) {
        const node = api.getRowNode(String(msg.device_id))
        if (node?.data) {
          deviceName = node.data.name
          node.setData({
            ...node.data,
            sync_status: msg.status,
            sync_step: msg.step,
            sync_time: msg.status === 'success' || msg.status === 'failure'
              ? new Date().toISOString()
              : node.data.sync_time,
          })
        }
      }
      if (msg.status === 'success') {
        notify('동기화 완료', deviceName ?? `장비 ID ${msg.device_id}`, 'success', { category: 'sync', device_id: msg.device_id, device_name: deviceName })
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats })
      } else if (msg.status === 'failure') {
        notify('동기화 실패', deviceName ?? `장비 ID ${msg.device_id}`, 'error', { category: 'sync', device_id: msg.device_id, device_name: deviceName })
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats })
      }
    },
    [queryClient]
  )
  useSyncStatusWebSocket(handleSyncMessage)

  const handleGridSearchChange = (value: string) => {
    setGridSearch(value)
    gridRef.current?.gridApi?.setGridOption('quickFilterText', value)
  }

  const [trendDeviceId, setTrendDeviceId] = useState<number | null>(null)
  const [trendCategory, setTrendCategory] = useState<ChangeStatCategory>('policies')

  const { data: trendCountHistory = [] } = useQuery({
    queryKey: queryKeys.objectCountHistory(trendDeviceId, trendCategory),
    queryFn: () => getObjectCountHistory(trendDeviceId as number, 12, trendCategory),
    enabled: trendDeviceId != null,
    staleTime: 60_000,
  })

  const trendChartData = useMemo(() => {
    const weeks = trendCountHistory.map(s => s.week)
    const counts = trendCountHistory.map(s => s.count)
    // 실제 데이터 범위에 여유분만 더해 y축을 타이트하게 맞춘다 —
    // min을 항상 0으로 고정하면 작은 증감이 그래프상 평평하게 뭉개져 보이는 문제가 있었음.
    const dataMin = counts.length ? Math.min(...counts) : 0
    const dataMax = counts.length ? Math.max(...counts) : 0
    const range = dataMax - dataMin
    const padding = range > 0 ? range * 0.15 : Math.max(1, dataMax * 0.05)
    return {
      categories: weeks.map(w => {
        const [y, wn] = w.split('-')
        return `${y}-W${wn}`
      }),
      series: [
        { name: '실제 개수', data: counts, color: '#3b82f6' },
      ],
      yMin: Math.max(0, Math.floor(dataMin - padding)),
      yMax: Math.ceil(dataMax + padding),
    }
  }, [trendCountHistory])

  const trendChartOptions: ApexOptions = {
    chart: { type: 'line', toolbar: { show: false }, background: 'transparent' },
    stroke: { curve: 'smooth', width: 2 },
    markers: { size: 4 },
    xaxis: { categories: trendChartData.categories, labels: { style: { fontSize: '11px' } } },
    yaxis: {
      labels: { style: { fontSize: '11px' } },
      min: trendChartData.yMin,
      max: trendChartData.yMax,
    },
    legend: { show: false },
    dataLabels: { enabled: false },
    tooltip: { shared: true, intersect: false },
    grid: { borderColor: 'rgba(0,0,0,0.05)' },
  }

  const errorDevices = rowData.filter(d => d.sync_status === 'failure' || d.sync_status === 'error')
  const highCapacityDevices = rowData
    .map(d => ({ device: d, metrics: getHighCapacityMetrics(d) }))
    .filter(x => x.metrics.length > 0)
  const hasDangerCapacity = highCapacityDevices.some(x => x.metrics.some(m => m.level === 'danger'))
  const totalPolicies = stats?.total_policies ?? 0
  const activePolicies = stats?.total_active_policies ?? 0
  const totalDevices = stats?.total_devices ?? 0
  const successDevices = stats?.active_devices ?? 0
  const activePct = totalPolicies > 0 ? Math.round(activePolicies / totalPolicies * 100) : 0
  const syncPct = totalDevices > 0 ? Math.round(successDevices / totalDevices * 100) : 0

  const gridHeight = rowData.length > 0 ? 'calc(100vh - 420px)' : 180

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        actions={
          <Button
            variant="subtle"
            size="auto"
            onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats })}
            className="gap-1.5 px-3 py-1.5 text-13 font-medium rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            갱신
          </Button>
        }
      />

      {/* 오류 배너 */}
      {errorDevices.length > 0 && (
        <div className="shrink-0 flex items-center justify-between gap-3 bg-ds-error/4 border border-ds-error/15 rounded-lg px-3.5 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-ds-error shrink-0" />
            <span className="text-xs font-semibold text-ds-error shrink-0">
              {errorDevices.length}개 장비 동기화 오류
            </span>
            <span className="text-11 text-ds-error/60 truncate">
              {errorDevices.map(d => d.name).join(', ')}
            </span>
          </div>
          <Button
            variant="destructive"
            size="auto"
            onClick={() => navigate('/devices')}
            className="px-2.5 py-1 text-11 font-semibold rounded-md shrink-0"
          >
            장비 확인
          </Button>
        </div>
      )}

      {/* 임계치 80% 이상 장비 섹션 */}
      {highCapacityDevices.length > 0 && (
        <div className={`shrink-0 card rounded-lg border ${hasDangerCapacity ? 'border-ds-error/20' : 'border-amber-200'}`}>
          <div className="flex items-center justify-between px-3.5 py-2 border-b border-ds-outline-variant/10">
            <div className="flex items-center gap-1.5">
              <Gauge className={`w-3.5 h-3.5 shrink-0 ${hasDangerCapacity ? 'text-ds-error' : 'text-amber-600'}`} />
              <span className={`text-xs font-semibold ${hasDangerCapacity ? 'text-ds-error' : 'text-amber-700'}`}>
                임계치 80% 이상 사용 중인 장비
              </span>
              <span className="text-11 text-ds-on-surface-variant/50 tabular-nums">{highCapacityDevices.length}대</span>
            </div>
            <Button
              variant="secondary"
              size="auto"
              onClick={() => navigate('/devices')}
              className="px-2.5 py-1 text-11 font-semibold rounded-md shrink-0 hover:bg-ds-surface-container-high"
            >
              장비 확인
            </Button>
          </div>
          <div className="divide-y divide-ds-outline-variant/10">
            {highCapacityDevices.map(({ device, metrics }) => (
              <div key={device.id} className="flex items-center justify-between gap-3 px-3.5 py-1.5">
                <span className="text-11 font-semibold text-ds-on-surface shrink-0">{device.name}</span>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {metrics.map(m => (
                    <span
                      key={m.label}
                      className={`inline-flex px-1.5 py-0.5 rounded text-10 font-bold border ${
                        m.level === 'danger'
                          ? 'bg-red-50 text-ds-error border-red-100'
                          : 'bg-amber-50 text-amber-700 border-amber-100'
                      }`}
                    >
                      {m.label} {m.pct}%
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI */}
      <div className="shrink-0 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="card rounded-xl px-4 py-3.5">
          <p className="text-10 font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">장비</p>
          <p className="text-2xl font-bold tabular-nums text-ds-on-surface mt-1.5">
            {isLoading ? '…' : formatNumber(totalDevices)}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-ds-surface-container-high rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${syncPct}%` }} />
            </div>
            <span className="text-10 font-semibold tabular-nums text-ds-on-surface-variant">{syncPct}%</span>
          </div>
          <p className="text-10 text-ds-on-surface-variant/60 mt-1">{successDevices}대 동기화 완료</p>
        </div>

        <div className="card rounded-xl px-4 py-3.5">
          <p className="text-10 font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">정책</p>
          <p className="text-2xl font-bold tabular-nums text-ds-on-surface mt-1.5">
            {isLoading ? '…' : formatNumber(totalPolicies)}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-ds-surface-container-high rounded-full overflow-hidden">
              <div className="h-full bg-ds-tertiary rounded-full" style={{ width: `${activePct}%` }} />
            </div>
            <span className="text-10 font-semibold tabular-nums text-ds-on-surface-variant">{activePct}%</span>
          </div>
          <p className="text-10 text-ds-on-surface-variant/60 mt-1">{formatNumber(activePolicies)}개 활성</p>
        </div>

        {[
          { label: '네트워크 객체', value: stats?.total_network_objects ?? 0 },
          { label: '네트워크 그룹', value: stats?.total_network_groups ?? 0 },
          { label: '서비스',       value: stats?.total_services ?? 0 },
          { label: '서비스 그룹',  value: stats?.total_service_groups ?? 0 },
        ].map((s) => (
          <div key={s.label} className="card rounded-xl px-4 py-3.5">
            <p className="text-10 font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">{s.label}</p>
            <p className="text-2xl font-bold tabular-nums text-ds-on-surface mt-1.5">
              {isLoading ? '…' : formatNumber(s.value)}
            </p>
          </div>
        ))}
      </div>

      {/* 장비별 객체 증감 추이 */}
      <div className="card rounded-xl shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-ds-outline-variant/10">
          <div>
            <span className="text-13 font-semibold text-ds-on-surface">장비별 객체 증감 추이</span>
            <span className="text-11 text-ds-on-surface-variant/60 ml-2">최근 12주</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-52">
              <DeviceSelectorSingle value={trendDeviceId} onChange={setTrendDeviceId} />
            </div>
            <div className="flex items-center gap-1 bg-ds-surface-container-low rounded-lg p-0.5 border border-ds-outline-variant/10">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTrendCategory(opt.value)}
                  className={`px-2.5 py-1 rounded-md text-11 font-semibold transition-colors ${
                    trendCategory === opt.value
                      ? 'bg-white text-ds-on-surface shadow-sm'
                      : 'text-ds-on-surface-variant hover:text-ds-on-surface'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 py-3">
          {trendDeviceId == null ? (
            <p className="text-xs text-ds-on-surface-variant/60 text-center py-10">장비를 선택하면 추이를 확인할 수 있습니다.</p>
          ) : trendChartData.categories.length === 0 ? (
            <p className="text-xs text-ds-on-surface-variant/60 text-center py-10">최근 12주간 동기화 이력이 없습니다.</p>
          ) : (
            <ReactApexChart
              type="line"
              height={200}
              series={trendChartData.series}
              options={trendChartOptions}
            />
          )}
        </div>
      </div>

      {/* 장비 현황 테이블 */}
      <div className="card rounded-xl flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-13 font-semibold text-ds-on-surface">장비 현황</span>
            {rowData.length > 0 && (
              <span className="text-11 text-ds-on-surface-variant/50 tabular-nums">{rowData.length}대</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2.5 py-1.5 border border-ds-outline-variant/10">
              <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
              <input
                value={gridSearch}
                onChange={(e) => handleGridSearchChange(e.target.value)}
                placeholder="장비명, IP 검색"
                className="text-xs bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/40 w-36"
              />
              {gridSearch && (
                <button onClick={() => handleGridSearchChange('')}>
                  <XCircle className="w-3 h-3 text-ds-on-surface-variant hover:text-ds-on-surface" />
                </button>
              )}
            </div>
          </div>
        </div>

        <AgGridWrapper<DeviceRow>
          ref={gridRef}
          columnDefs={COLUMN_DEFS}
          rowData={rowData}
          getRowId={rowIdFromId}
          height={gridHeight}
          loading={isLoading}
          noRowsText="등록된 장비가 없습니다."
          defaultColDefOverride={{ resizable: true, sortable: true, filter: false }}
          fitColumns
        />
      </div>
    </div>
  )
}
