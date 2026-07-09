import { useRef, useCallback, useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search, XCircle, AlertTriangle, Gauge } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ColDef } from '@ag-grid-community/core'
import type { GridApi } from '@ag-grid-community/core'
import ReactApexChart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { rowIdFromId } from '@/lib/utils'
import { getDashboardStats, type DeviceStats } from '@/api/devices'
import { getChangeStats, type ChangeStatCategory } from '@/api/firewall'
import { useSyncStatusWebSocket } from '@/hooks/useWebSocket'
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
  if (usage == null && threshold == null) return <span className="text-[12px] text-ds-on-surface-variant/40">—</span>
  const level = capacityLevel(usage, threshold)
  const pct = usage != null && threshold != null && threshold > 0 ? Math.round((usage / threshold) * 100) : 0
  const barPct = Math.min(100, pct)
  return (
    <div className="flex flex-col justify-center gap-0.5 py-1">
      <span className={`text-[11px] font-semibold tabular-nums ${CAPACITY_LEVEL_TEXT_COLOR[level]}`}>
        {usage != null ? `${usage}개` : '—'} / {threshold != null ? `${threshold}개` : '—'}
        {threshold != null && usage != null && ` (${pct}%)`}
      </span>
      <div className="h-1 rounded-full bg-ds-outline-variant/20 overflow-hidden w-20">
        <div className={`h-full rounded-full ${CAPACITY_LEVEL_BAR_COLOR[level]}`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  )
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
        <span className="text-[12px] font-semibold text-ds-on-surface">{p.data.name}</span>
        {p.data.ip_address && (
          <span className="text-[10px] text-ds-on-surface-variant/60 font-mono mt-0.5">{p.data.ip_address}</span>
        )}
      </div>
    ),
  },
  {
    field: 'vendor', headerName: '벤더',
    cellRenderer: (p: { value: string }) => {
      const cls = VENDOR_BADGE[p.value?.toLowerCase()] ?? 'bg-gray-50 text-gray-500 border border-gray-100'
      return (
        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cls}`}>
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
    headerName: '정책 임계치', minWidth: 110, sortable: false, filter: false,
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.policies} threshold={p.data.policy_threshold} />,
  },
  {
    headerName: '네트워크 객체 임계치', minWidth: 130, sortable: false, filter: false,
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.network_objects} threshold={p.data.network_object_threshold} />,
  },
  {
    headerName: '네트워크 그룹 임계치', minWidth: 130, sortable: false, filter: false,
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.network_groups} threshold={p.data.network_group_threshold} />,
  },
  {
    headerName: '서비스 객체 임계치', minWidth: 130, sortable: false, filter: false,
    cellRenderer: (p: { data: DeviceRow }) => <CapacityCell usage={p.data.services} threshold={p.data.service_threshold} />,
  },
  {
    headerName: '서비스 그룹 임계치', minWidth: 130, sortable: false, filter: false,
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
    (msg: { device_id: number; status: string; step: string | null }) => {
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

  const deviceIds = stats?.device_stats.map(d => d.id) ?? []

  const { data: changeStats = [] } = useQuery({
    queryKey: queryKeys.changeStats(deviceIds),
    queryFn: () => getChangeStats(deviceIds),
    enabled: deviceIds.length > 0,
    staleTime: 60_000,
  })

  const chartData = useMemo(() => {
    const weeks = [...new Set(changeStats.map(s => s.week))].sort()
    const get = (week: string, action: string) => changeStats.find(s => s.week === week && s.action === action)?.count ?? 0
    return {
      categories: weeks.map(w => {
        const [y, wn] = w.split('-')
        return `${y}-W${wn}`
      }),
      series: [
        { name: '신규', data: weeks.map(w => get(w, 'created')), color: '#22c55e' },
        { name: '변경', data: weeks.map(w => get(w, 'updated')), color: '#f59e0b' },
        { name: '삭제', data: weeks.map(w => get(w, 'deleted')), color: '#ef4444' },
      ],
    }
  }, [changeStats])

  const chartOptions: ApexOptions = {
    chart: { type: 'bar', stacked: true, toolbar: { show: false }, background: 'transparent' },
    plotOptions: { bar: { columnWidth: '55%', borderRadius: 2 } },
    xaxis: { categories: chartData.categories, labels: { style: { fontSize: '11px' } } },
    yaxis: { labels: { style: { fontSize: '11px' } }, min: 0 },
    legend: { position: 'top', fontSize: '12px' },
    dataLabels: { enabled: false },
    tooltip: { shared: true, intersect: false },
    grid: { borderColor: 'rgba(0,0,0,0.05)' },
  }

  const [trendDeviceId, setTrendDeviceId] = useState<number | null>(null)
  const [trendCategory, setTrendCategory] = useState<ChangeStatCategory>('policies')

  const { data: trendStats = [] } = useQuery({
    queryKey: queryKeys.changeStats(trendDeviceId, trendCategory),
    queryFn: () => getChangeStats([trendDeviceId as number], 12, trendCategory),
    enabled: trendDeviceId != null,
    staleTime: 60_000,
  })

  const trendChartData = useMemo(() => {
    const weeks = [...new Set(trendStats.map(s => s.week))].sort()
    const get = (week: string, action: string) => trendStats.find(s => s.week === week && s.action === action)?.count ?? 0
    return {
      categories: weeks.map(w => {
        const [y, wn] = w.split('-')
        return `${y}-W${wn}`
      }),
      series: [
        { name: '신규', data: weeks.map(w => get(w, 'created')), color: '#22c55e' },
        { name: '변경', data: weeks.map(w => get(w, 'updated')), color: '#f59e0b' },
        { name: '삭제', data: weeks.map(w => get(w, 'deleted')), color: '#ef4444' },
      ],
    }
  }, [trendStats])

  const trendChartOptions: ApexOptions = {
    chart: { type: 'bar', stacked: true, toolbar: { show: false }, background: 'transparent' },
    plotOptions: { bar: { columnWidth: '55%', borderRadius: 2 } },
    xaxis: { categories: trendChartData.categories, labels: { style: { fontSize: '11px' } } },
    yaxis: { labels: { style: { fontSize: '11px' } }, min: 0 },
    legend: { position: 'top', fontSize: '12px' },
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
      {/* 헤더 */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">Dashboard</h1>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-ds-on-surface-variant bg-white rounded-lg shadow-sm border border-ds-outline-variant/10 hover:text-ds-on-surface hover:bg-ds-surface-container-low transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          갱신
        </button>
      </div>

      {/* 오류 배너 */}
      {errorDevices.length > 0 && (
        <div className="shrink-0 flex items-center justify-between bg-ds-error/4 border border-ds-error/15 rounded-xl px-5 py-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-ds-error shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-ds-error">
                {errorDevices.length}개 장비 동기화 오류
              </p>
              <p className="text-[11px] text-ds-error/60 mt-0.5">
                {errorDevices.map(d => d.name).join(', ')}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/devices')}
            className="px-3 py-1.5 bg-ds-error text-white text-[12px] font-semibold rounded-lg hover:brightness-110 transition-all shrink-0"
          >
            장비 확인
          </button>
        </div>
      )}

      {/* 임계치 80% 이상 장비 섹션 */}
      {highCapacityDevices.length > 0 && (
        <div className={`shrink-0 card rounded-xl border ${hasDangerCapacity ? 'border-ds-error/20' : 'border-amber-200'}`}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-ds-outline-variant/10">
            <div className="flex items-center gap-2">
              <Gauge className={`w-4 h-4 shrink-0 ${hasDangerCapacity ? 'text-ds-error' : 'text-amber-600'}`} />
              <span className={`text-[13px] font-semibold ${hasDangerCapacity ? 'text-ds-error' : 'text-amber-700'}`}>
                임계치 80% 이상 사용 중인 장비
              </span>
              <span className="text-[11px] text-ds-on-surface-variant/50 tabular-nums">{highCapacityDevices.length}대</span>
            </div>
            <button
              onClick={() => navigate('/devices')}
              className="px-3 py-1.5 bg-ds-surface-container-low text-ds-on-surface-variant text-[12px] font-semibold rounded-lg hover:bg-ds-surface-container-high transition-all shrink-0"
            >
              장비 확인
            </button>
          </div>
          <div className="divide-y divide-ds-outline-variant/10">
            {highCapacityDevices.map(({ device, metrics }) => (
              <div key={device.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="text-[12px] font-semibold text-ds-on-surface shrink-0">{device.name}</span>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {metrics.map(m => (
                    <span
                      key={m.label}
                      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${
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
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">장비</p>
          <p className="text-2xl font-bold tabular-nums text-ds-on-surface mt-1.5">
            {isLoading ? '…' : formatNumber(totalDevices)}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-ds-surface-container-high rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${syncPct}%` }} />
            </div>
            <span className="text-[10px] font-semibold tabular-nums text-ds-on-surface-variant">{syncPct}%</span>
          </div>
          <p className="text-[10px] text-ds-on-surface-variant/60 mt-1">{successDevices}대 동기화 완료</p>
        </div>

        <div className="card rounded-xl px-4 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">정책</p>
          <p className="text-2xl font-bold tabular-nums text-ds-on-surface mt-1.5">
            {isLoading ? '…' : formatNumber(totalPolicies)}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-ds-surface-container-high rounded-full overflow-hidden">
              <div className="h-full bg-ds-tertiary rounded-full" style={{ width: `${activePct}%` }} />
            </div>
            <span className="text-[10px] font-semibold tabular-nums text-ds-on-surface-variant">{activePct}%</span>
          </div>
          <p className="text-[10px] text-ds-on-surface-variant/60 mt-1">{formatNumber(activePolicies)}개 활성</p>
        </div>

        {[
          { label: '네트워크 객체', value: stats?.total_network_objects ?? 0 },
          { label: '네트워크 그룹', value: stats?.total_network_groups ?? 0 },
          { label: '서비스',       value: stats?.total_services ?? 0 },
          { label: '서비스 그룹',  value: stats?.total_service_groups ?? 0 },
        ].map((s) => (
          <div key={s.label} className="card rounded-xl px-4 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">{s.label}</p>
            <p className="text-2xl font-bold tabular-nums text-ds-on-surface mt-1.5">
              {isLoading ? '…' : formatNumber(s.value)}
            </p>
          </div>
        ))}
      </div>

      {/* 주간 정책 변경 추이 */}
      {chartData.categories.length > 0 && (
        <div className="card rounded-xl shrink-0">
          <div className="px-5 py-3 border-b border-ds-outline-variant/10">
            <span className="text-[13px] font-semibold text-ds-on-surface">주간 정책 변경 추이</span>
            <span className="text-[11px] text-ds-on-surface-variant/60 ml-2">최근 12주</span>
          </div>
          <div className="px-4 py-3">
            <ReactApexChart
              type="bar"
              height={200}
              series={chartData.series}
              options={chartOptions}
            />
          </div>
        </div>
      )}

      {/* 장비별 객체 증감 추이 */}
      <div className="card rounded-xl shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-ds-outline-variant/10">
          <div>
            <span className="text-[13px] font-semibold text-ds-on-surface">장비별 객체 증감 추이</span>
            <span className="text-[11px] text-ds-on-surface-variant/60 ml-2">최근 12주</span>
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
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
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
            <p className="text-[12px] text-ds-on-surface-variant/60 text-center py-10">장비를 선택하면 추이를 확인할 수 있습니다.</p>
          ) : trendChartData.categories.length === 0 ? (
            <p className="text-[12px] text-ds-on-surface-variant/60 text-center py-10">최근 12주간 변경 이력이 없습니다.</p>
          ) : (
            <ReactApexChart
              type="bar"
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
            <span className="text-[13px] font-semibold text-ds-on-surface">장비 현황</span>
            {rowData.length > 0 && (
              <span className="text-[11px] text-ds-on-surface-variant/50 tabular-nums">{rowData.length}대</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2.5 py-1.5 border border-ds-outline-variant/10">
              <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
              <input
                value={gridSearch}
                onChange={(e) => handleGridSearchChange(e.target.value)}
                placeholder="장비명, IP 검색"
                className="text-[12px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/40 w-36"
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
          noRowsText="등록된 장비가 없습니다."
          defaultColDefOverride={{ resizable: true, sortable: true }}
          fitColumns
        />
      </div>
    </div>
  )
}
