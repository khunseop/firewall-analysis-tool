import { useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { ColDef, GridApi } from '@ag-grid-community/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { getDashboardStats, type DeviceStats } from '@/api/devices'
import { useSyncStatusWebSocket } from '@/hooks/useWebSocket'
import { formatNumber, formatDate } from '@/lib/utils'

const VENDOR_LABELS: Record<string, string> = {
  paloalto: 'Palo Alto',
  ngf: 'SECUI NGF',
  mf2: 'SECUI MF2',
  mock: 'Mock',
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  success: { label: '성공', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  in_progress: { label: '진행중', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  pending: { label: '대기중', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  failure: { label: '실패', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  error: { label: '오류', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
}

interface DeviceRow {
  id: number
  name: string
  vendor: string
  ip_address?: string
  policies: number
  active_policies: number
  disabled_policies: number
  network_objects: number
  services: number
  sync_status: string | null
  sync_step: string | null
  sync_time: string | null
}

function transformDeviceStats(d: DeviceStats): DeviceRow {
  return {
    id: d.id,
    name: d.name,
    vendor: d.vendor,
    policies: d.total_policies ?? 0,
    active_policies: d.active_policies ?? 0,
    disabled_policies: d.disabled_policies ?? 0,
    network_objects: d.total_network_objects ?? 0,
    services: d.total_services ?? 0,
    sync_status: d.last_sync_status,
    sync_step: d.last_sync_step,
    sync_time: d.last_sync_at,
  }
}

const COLUMN_DEFS: ColDef<DeviceRow>[] = [
  { field: 'name', headerName: '장비명', filter: 'agTextColumnFilter', width: 150 },
  { field: 'vendor', headerName: '벤더', filter: 'agTextColumnFilter', width: 100 },
  { field: 'policies', headerName: '정책 수', filter: 'agNumberColumnFilter', width: 100, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'active_policies', headerName: '활성 정책', filter: 'agNumberColumnFilter', width: 100, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'disabled_policies', headerName: '비활성', filter: 'agNumberColumnFilter', width: 90, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'network_objects', headerName: '네트워크 객체', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'services', headerName: '서비스 객체', filter: 'agNumberColumnFilter', width: 120, valueFormatter: (p) => formatNumber(p.value) },
  {
    field: 'sync_time',
    headerName: '마지막 동기화',
    filter: 'agTextColumnFilter',
    width: 160,
    valueFormatter: (p) => formatDate(p.value),
  },
  {
    field: 'sync_status',
    headerName: '동기화 상태',
    width: 120,
    cellRenderer: (params: { value: string | null; data: DeviceRow }) => {
      const status = params.value
      const step = params.data?.sync_step
      const title = step ? `${status}: ${step}` : (status ?? '-')
      const container = document.createElement('div')
      container.className = 'flex items-center h-full'
      container.title = title
      const dot = document.createElement('span')
      const colors: Record<string, string> = {
        success: '#22c55e',
        in_progress: '#3b82f6',
        pending: '#f59e0b',
        failure: '#ef4444',
        error: '#ef4444',
      }
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${colors[status ?? ''] ?? '#94a3b8'};display:inline-block;`
      if (status === 'in_progress') dot.style.animation = 'pulse 1.5s ease-in-out infinite'
      container.appendChild(dot)
      return container
    },
  },
]

export function DashboardPage() {
  const queryClient = useQueryClient()
  const gridRef = useRef<AgGridWrapperHandle>(null)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
    staleTime: 60_000,
  })

  const rowData: DeviceRow[] = stats?.device_stats.map(transformDeviceStats) ?? []

  const handleSyncMessage = useCallback(
    (msg: { device_id: number; status: string; step: string | null }) => {
      const api: GridApi<DeviceRow> | null = gridRef.current?.gridApi ?? null
      if (api) {
        const node = api.getRowNode(String(msg.device_id))
        if (node?.data) {
          const updated: DeviceRow = {
            ...node.data,
            sync_status: msg.status,
            sync_step: msg.step,
            sync_time: msg.status === 'success' || msg.status === 'failure' ? new Date().toISOString() : node.data.sync_time,
          }
          node.setData(updated)
        }
      }
      if (msg.status === 'success' || msg.status === 'failure') {
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      }
    },
    [queryClient]
  )

  useSyncStatusWebSocket(handleSyncMessage)

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
  }

  // 동기화 상태별 집계
  const statusCounts = rowData.reduce<Record<string, number>>((acc, d) => {
    const s = d.sync_status ?? 'unknown'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  // 벤더별 집계
  const vendorMap = rowData.reduce<Record<string, { count: number; policies: number; activePolicies: number; networkObjects: number; services: number }>>((acc, d) => {
    const v = d.vendor ?? 'Unknown'
    if (!acc[v]) acc[v] = { count: 0, policies: 0, activePolicies: 0, networkObjects: 0, services: 0 }
    acc[v].count += 1
    acc[v].policies += d.policies
    acc[v].activePolicies += d.active_policies
    acc[v].networkObjects += d.network_objects
    acc[v].services += d.services
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '전체 장비', value: stats?.total_devices, sub: `활성: ${formatNumber(stats?.active_devices)}` },
          { label: '전체 정책', value: stats?.total_policies, sub: `활성: ${formatNumber(stats?.total_active_policies)} / 비활성: ${formatNumber(stats?.total_disabled_policies)}` },
          { label: '네트워크 객체', value: stats?.total_network_objects, sub: '' },
          { label: '서비스 객체', value: stats?.total_services, sub: '' },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="text-3xl font-bold mt-1 text-primary">
                {isLoading ? '...' : formatNumber(card.value)}
              </p>
              {card.sub && <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 동기화 상태 요약 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">동기화 상태 요약</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rowData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">등록된 장비가 없습니다.</p>
            ) : (
              Object.entries(statusCounts).map(([status, count]) => {
                const conf = STATUS_CONFIG[status] ?? STATUS_CONFIG['pending']
                return (
                  <div key={status} className={`flex items-center justify-between rounded-md border px-3 py-2 ${conf.bg}`}>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={status} showLabel={false} />
                      <span className={`text-sm font-medium ${conf.color}`}>{conf.label}</span>
                    </div>
                    <span className={`text-lg font-bold ${conf.color}`}>{count}</span>
                  </div>
                )
              })
            )}
            {rowData.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">총 {formatNumber(rowData.length)}개 장비</p>
            )}
          </CardContent>
        </Card>

        {/* 벤더별 통계 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">벤더별 통계</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(vendorMap).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">장비 데이터가 없습니다.</p>
            ) : (
              Object.entries(vendorMap)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([vendor, v]) => (
                  <div key={vendor} className="rounded-md border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">{VENDOR_LABELS[vendor.toLowerCase()] ?? vendor}</span>
                      <span className="text-xs text-muted-foreground">{v.count}개 장비</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">정책</p>
                        <p className="font-medium">{formatNumber(v.policies)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">활성 정책</p>
                        <p className="font-medium">{formatNumber(v.activePolicies)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">네트워크 객체</p>
                        <p className="font-medium">{formatNumber(v.networkObjects)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">서비스 객체</p>
                        <p className="font-medium">{formatNumber(v.services)}</p>
                      </div>
                    </div>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* 장비별 통계 그리드 */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">장비별 통계</CardTitle>
          <Button variant="outline" size="sm" onClick={handleRefresh} className="h-7 gap-1.5">
            <RefreshCw className="h-3 w-3" />
            새로고침
          </Button>
        </CardHeader>
        <CardContent className="p-0 px-4 pb-4">
          <AgGridWrapper<DeviceRow>
            ref={gridRef}
            columnDefs={COLUMN_DEFS}
            rowData={rowData}
            getRowId={(p) => String(p.data.id)}
            height={300}
            noRowsText="장비를 추가하세요."
          />
        </CardContent>
      </Card>
    </div>
  )
}
