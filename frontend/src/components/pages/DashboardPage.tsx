import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search, XCircle, AlertTriangle, ChevronDown } from 'lucide-react'
import type { ColDef, IRowNode } from '@ag-grid-community/core'
import type { GridApi } from '@ag-grid-community/core'
import ReactApexChart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { rowIdFromId } from '@/lib/utils'
import { getDashboardStats } from '@/api/devices'
import { getObjectCountHistory, type ChangeStatCategory } from '@/api/firewall'
import { useSyncStatusWebSocket, type SyncWebSocketMessage } from '@/hooks/useWebSocket'
import { notify } from '@/lib/notify'
import { formatNumber, formatRelativeTime } from '@/lib/utils'
import { capacityLevel, CAPACITY_LEVEL_BAR_COLOR, CAPACITY_LEVEL_TEXT_COLOR } from '@/lib/deviceCapacity'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelector'
import { queryKeys } from '@/api/queryKeys'
import { STATUS_CONFIG, STATUS_ORDER } from '@/components/pages/devices/constants'
import { AttentionPanel } from './dashboard/AttentionPanel'
import { computeAttention, problemRank, transformDeviceStats, type DeviceRow } from './dashboard/dashboardModel'

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

function countBy(rows: DeviceRow[], pick: (r: DeviceRow) => string | null | undefined): [string, number][] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = pick(r) || '미확인'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

const COLUMN_DEFS: ColDef<DeviceRow>[] = [
  // 기본 정렬 — 문제가 심한 장비를 위로(숨김 컬럼), 같은 수준에서는 이름순
  { colId: 'problem_rank', field: 'problem_rank', hide: true, sort: 'desc', sortIndex: 0 },
  { colId: 'name_sort', valueGetter: (p) => p.data?.name ?? '', hide: true, sort: 'asc', sortIndex: 1 },
  {
    headerName: '상태', minWidth: 120, flex: 0.8,
    valueGetter: (p) => STATUS_CONFIG[p.data?.sync_status ?? '']?.label ?? '',
    comparator: (_a, _b, nodeA, nodeB) =>
      (STATUS_ORDER[nodeA.data?.sync_status ?? ''] ?? -1) - (STATUS_ORDER[nodeB.data?.sync_status ?? ''] ?? -1),
    cellRenderer: (p: { data: DeviceRow }) => {
      const conf = STATUS_CONFIG[p.data?.sync_status ?? '']
      const failed = p.data?.sync_status === 'failure' || p.data?.sync_status === 'error'
      if (!conf) return <span className="text-11 text-ds-on-surface-variant">동기화 이력 없음</span>
      return (
        <span className={`flex items-center gap-1.5 text-11 font-semibold min-w-0 ${conf.text}`} title={p.data?.sync_step ?? ''}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conf.dot}`} />
          <span className="shrink-0">{conf.label}</span>
          {failed && p.data?.sync_step && <span className="font-normal truncate">· {p.data.sync_step}</span>}
        </span>
      )
    },
  },
  {
    field: 'name', headerName: '장비명', flex: 1, minWidth: 140,
    cellRenderer: (p: { data: DeviceRow }) => (
      <div className="flex flex-col justify-center leading-tight">
        <span className="text-xs font-semibold text-ds-on-surface">{p.data.name}</span>
        {p.data.ip_address && (
          <span className="text-11 text-ds-on-surface-variant font-mono mt-0.5">{p.data.ip_address}</span>
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
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const [gridSearch, setGridSearch] = useState('')
  // 경보 칩을 눌렀을 때 장비 현황을 해당 장비로만 좁힌다.
  const [focus, setFocus] = useState<{ ids: number[]; label: string } | null>(null)
  const [statsOpen, setStatsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('fat_dashboard_stats_open') === '1' } catch { return false }
  })

  const { data: stats, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.dashboardStats, queryFn: getDashboardStats, staleTime: 60_000,
  })
  // 조회에 실패했는데 "장비 0대"로 보이면 서버 오류가 "데이터 없음"으로 오인되므로, 값이 없을 땐 0이 아니라 "—"를 쓴다.
  const failedWithoutData = isError && !stats
  const num = (n: number) => (isLoading ? '…' : stats ? formatNumber(n) : '—')
  const updatedLabel = dataUpdatedAt > 0
    ? new Date(dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null

  const rowData: DeviceRow[] = useMemo(() => stats?.device_stats.map(transformDeviceStats) ?? [], [stats])

  const handleSyncMessage = useCallback(
    (msg: SyncWebSocketMessage) => {
      if (msg.type !== 'device_sync_status') return
      const api: GridApi<DeviceRow> | null = gridRef.current?.gridApi ?? null
      let deviceName: string | undefined
      if (api) {
        const node = api.getRowNode(String(msg.device_id))
        if (node?.data) {
          deviceName = node.data.name
          const { problem_rank: _rank, ...rest } = node.data
          void _rank
          const next = {
            ...rest,
            sync_status: msg.status,
            sync_step: msg.step,
            sync_time: msg.status === 'success' || msg.status === 'failure'
              ? new Date().toISOString()
              : node.data.sync_time,
          }
          node.setData({ ...next, problem_rank: problemRank(next) })
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

  useEffect(() => {
    gridRef.current?.gridApi?.onFilterChanged()
  }, [focus])
  const isExternalFilterPresent = useCallback(() => focus !== null, [focus])
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<DeviceRow>) => !focus || (node.data ? focus.ids.includes(node.data.id) : false),
    [focus],
  )
  const focusDevices = (ids: number[], label: string) => {
    setFocus({ ids, label })
    tableRef.current?.scrollIntoView({ block: 'start' })
  }

  const toggleStats = () => {
    setStatsOpen((v) => {
      try { localStorage.setItem('fat_dashboard_stats_open', v ? '0' : '1') } catch { /* 저장 실패는 무시 */ }
      return !v
    })
  }

  const [trendDeviceId, setTrendDeviceId] = useState<number | null>(null)
  const [trendCategory, setTrendCategory] = useState<ChangeStatCategory>('policies')

  const { data: trendCountHistory = [] } = useQuery({
    queryKey: queryKeys.objectCountHistory(trendDeviceId, trendCategory),
    queryFn: () => getObjectCountHistory(trendDeviceId as number, 12, trendCategory),
    enabled: trendDeviceId != null && statsOpen,
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

  const vendorCounts = useMemo(() => countBy(rowData, d => d.vendor?.toLowerCase()), [rowData])
  const modelCounts = useMemo(() => countBy(rowData, d => d.model), [rowData])
  const osCounts = useMemo(() => countBy(rowData, d => d.os_version), [rowData])

  const attentionGroups = useMemo(() => computeAttention(rowData), [rowData])
  const healthyCount = useMemo(() => rowData.filter(d => d.problem_rank === 0).length, [rowData])
  const totalPolicies = stats?.total_policies ?? 0
  const activePolicies = stats?.total_active_policies ?? 0
  const totalDevices = stats?.total_devices ?? 0
  const successDevices = stats?.active_devices ?? 0

  // 장비 수만큼만 높이를 쓰되 화면의 70%를 넘지 않게 한다 — 위쪽 콘텐츠 높이를 가정한 고정 오프셋을 쓰지 않는다.
  const gridHeight = rowData.length > 0 ? `min(${rowData.length * 40 + 56}px, 70vh)` : 180

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="대시보드"
        description={stats
          ? `장비 ${formatNumber(totalDevices)}대 · 동기화 완료 ${formatNumber(successDevices)}대 · 정책 ${formatNumber(totalPolicies)}개 (활성 ${formatNumber(activePolicies)}개)${updatedLabel ? ` · 최종 갱신 ${updatedLabel}` : ''}`
          : undefined}
        actions={
          <Button
            variant="subtle"
            size="auto"
            onClick={() => { void refetch() }}
            disabled={isFetching}
            aria-busy={isFetching}
            className="gap-1.5 px-3 py-1.5 text-13 font-medium rounded-lg"
          >
            <RefreshCw className={`!w-3.5 !h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? '갱신 중…' : '갱신'}
          </Button>
        }
      />

      {isError && (
        <div role="alert" className="shrink-0 rounded-xl border border-ds-error/25 bg-ds-error/5 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-ds-error shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-13 font-semibold text-ds-error">
              {stats ? '최신 데이터를 가져오지 못했습니다' : '대시보드 데이터를 불러오지 못했습니다'}
            </p>
            <p className="text-11 text-ds-on-surface-variant mt-0.5">
              {stats && updatedLabel ? `${updatedLabel} 기준 값을 표시하고 있습니다. ` : '장비·정책 현황을 표시할 수 없습니다. '}
              {(error as Error)?.message}
            </p>
          </div>
          <Button variant="subtle" size="auto" onClick={() => { void refetch() }} disabled={isFetching} className="px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0">
            다시 시도
          </Button>
        </div>
      )}

      {!isLoading && !failedWithoutData && (
        <AttentionPanel groups={attentionGroups} totalDevices={rowData.length} healthyCount={healthyCount} onFocus={focusDevices} staleSince={isError ? updatedLabel : null} />
      )}

      {/* 장비 현황 테이블 — 조회에 실패했다면 "등록된 장비가 없습니다"로 오인되지 않도록 아예 그리지 않는다 */}
      {!failedWithoutData && (
        <div ref={tableRef} className="card rounded-xl flex flex-col overflow-hidden scroll-mt-20">
          <div className="shrink-0 flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="text-13 font-semibold text-ds-on-surface">장비 현황</span>
              {rowData.length > 0 && (
                <span className="text-11 text-ds-on-surface-variant tabular-nums">{rowData.length}대 · 문제 있는 장비가 위에 정렬됩니다</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2.5 py-1.5 border border-ds-outline-variant/10">
                <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
                <input
                  value={gridSearch}
                  onChange={(e) => handleGridSearchChange(e.target.value)}
                  placeholder="장비명, IP 검색"
                  aria-label="장비명 또는 IP 검색"
                  className="text-xs bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/70 w-36"
                />
                {gridSearch && (
                  <button onClick={() => handleGridSearchChange('')} aria-label="검색어 지우기">
                    <XCircle className="w-3 h-3 text-ds-on-surface-variant hover:text-ds-on-surface" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {focus && (
            <div className="shrink-0 px-5 pb-2 flex items-center gap-2 text-11">
              <span className="font-semibold text-ds-tertiary">{focus.label} — {focus.ids.length}대만 표시 중</span>
              <button onClick={() => setFocus(null)} className="font-semibold text-ds-on-surface-variant hover:text-ds-on-surface underline underline-offset-2">
                필터 해제
              </button>
            </div>
          )}

          <AgGridWrapper<DeviceRow>
            ref={gridRef}
            columnDefs={COLUMN_DEFS}
            rowData={rowData}
            getRowId={rowIdFromId}
            height={gridHeight}
            rowHeight={40}
            loading={isLoading}
            noRowsText="등록된 장비가 없습니다."
            defaultColDefOverride={{ resizable: true, sortable: true, filter: false }}
            fitColumns
            isExternalFilterPresent={isExternalFilterPresent}
            doesExternalFilterPass={doesExternalFilterPass}
          />
        </div>
      )}

      {/* 통계 — 운영 판단에 바로 쓰이지 않는 총계·구성 현황·추이는 접어 둔다 */}
      <section aria-label="통계">
        <button
          type="button"
          onClick={toggleStats}
          aria-expanded={statsOpen}
          aria-controls="dashboard-stats"
          className="flex items-center gap-2 text-13 font-semibold text-ds-on-surface-variant hover:text-ds-on-surface"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${statsOpen ? '' : '-rotate-90'}`} />
          통계 {statsOpen ? '접기' : '더 보기'}
          {!statsOpen && <span className="text-11 font-normal">객체 총계 · 벤더/모델/OS 현황 · 객체 수 추이</span>}
        </button>

        {statsOpen && (
          <div id="dashboard-stats" className="flex flex-col gap-6 mt-3">
            <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: '네트워크 객체', value: stats?.total_network_objects ?? 0 },
                { label: '네트워크 그룹', value: stats?.total_network_groups ?? 0 },
                { label: '서비스',       value: stats?.total_services ?? 0 },
                { label: '서비스 그룹',  value: stats?.total_service_groups ?? 0 },
              ].map((s) => (
                <div key={s.label} className="card rounded-xl px-4 py-3.5">
                  <p className="text-11 font-semibold text-ds-on-surface-variant">{s.label}</p>
                  <p className="text-2xl font-bold tabular-nums text-ds-on-surface mt-1.5">{num(s.value)}</p>
                </div>
              ))}
            </div>

            {/* 벤더/모델/OS별 현황 */}
            <div className="shrink-0 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="card rounded-xl px-4 py-3.5">
                <p className="text-11 font-semibold text-ds-on-surface-variant mb-2">벤더별 현황</p>
                <div className="flex flex-wrap gap-1.5">
                  {vendorCounts.map(([vendor, count]) => (
                    <span
                      key={vendor}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-11 font-bold uppercase tracking-wide ${VENDOR_BADGE[vendor] ?? 'bg-gray-50 text-gray-500 border border-gray-100'}`}
                    >
                      {VENDOR_LABELS[vendor] ?? vendor}
                      <span className="tabular-nums">{count}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="card rounded-xl px-4 py-3.5">
                <p className="text-11 font-semibold text-ds-on-surface-variant mb-2">모델별 현황</p>
                <div className="flex flex-wrap gap-1.5">
                  {modelCounts.map(([model, count]) => (
                    <span key={model} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-11 font-bold bg-ds-surface-container-low text-ds-on-surface-variant border border-ds-outline-variant/10">
                      {model}
                      <span className="tabular-nums">{count}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="card rounded-xl px-4 py-3.5">
                <p className="text-11 font-semibold text-ds-on-surface-variant mb-2">OS별 현황</p>
                <div className="flex flex-wrap gap-1.5">
                  {osCounts.map(([os, count]) => (
                    <span key={os} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-11 font-bold bg-ds-surface-container-low text-ds-on-surface-variant border border-ds-outline-variant/10">
                      {os}
                      <span className="tabular-nums">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 장비별 객체 증감 추이 */}
            <div className="card rounded-xl shrink-0">
              <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-ds-outline-variant/10">
                <div>
                  <span className="text-13 font-semibold text-ds-on-surface">장비별 객체 증감 추이</span>
                  <span className="text-11 text-ds-on-surface-variant ml-2">최근 12주</span>
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
                        aria-pressed={trendCategory === opt.value}
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
                  <p className="text-xs text-ds-on-surface-variant text-center py-10">장비를 선택하면 추이를 확인할 수 있습니다.</p>
                ) : trendChartData.categories.length === 0 ? (
                  <p className="text-xs text-ds-on-surface-variant text-center py-10">최근 12주간 동기화 이력이 없습니다.</p>
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
          </div>
        )}
      </section>
    </div>
  )
}
