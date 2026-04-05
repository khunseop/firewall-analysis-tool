import { useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { ColDef, GridApi } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { getDashboardStats, type DeviceStats } from '@/api/devices'
import { useSyncStatusWebSocket } from '@/hooks/useWebSocket'
import { formatNumber, formatDate } from '@/lib/utils'

const VENDOR_LABELS: Record<string, string> = {
  paloalto: 'Palo Alto',
  ngf: 'SECUI NGF',
  mf2: 'SECUI MF2',
  mock: 'Mock',
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

const STATUS_PILL: Record<string, { label: string; classes: string }> = {
  success:     { label: '완료',   classes: 'bg-green-100 text-green-700' },
  in_progress: { label: '진행중', classes: 'bg-amber-100 text-amber-700' },
  pending:     { label: '대기중', classes: 'bg-blue-100 text-blue-700' },
  failure:     { label: '실패',   classes: 'bg-red-100 text-red-700' },
  error:       { label: '오류',   classes: 'bg-red-100 text-red-700' },
}

const COLUMN_DEFS: ColDef<DeviceRow>[] = [
  { field: 'name', headerName: '장비명', filter: 'agTextColumnFilter', width: 160 },
  { field: 'vendor', headerName: '벤더', filter: 'agTextColumnFilter', width: 100 },
  { field: 'policies', headerName: '정책 수', filter: 'agNumberColumnFilter', width: 100, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'active_policies', headerName: '활성 정책', filter: 'agNumberColumnFilter', width: 100, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'disabled_policies', headerName: '비활성', filter: 'agNumberColumnFilter', width: 90, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'network_objects', headerName: '네트워크 객체', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'services', headerName: '서비스 객체', filter: 'agNumberColumnFilter', width: 120, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'sync_time', headerName: '마지막 동기화', filter: 'agTextColumnFilter', width: 160, valueFormatter: (p) => formatDate(p.value) },
  {
    field: 'sync_status',
    headerName: '동기화 상태',
    width: 120,
    cellRenderer: (params: { value: string | null; data: DeviceRow }) => {
      const status = params.value
      const step = params.data?.sync_step
      const conf = STATUS_PILL[status ?? '']
      if (!conf) return <span className="text-ds-on-surface-variant text-xs">-</span>
      return (
        <div className="flex items-center h-full" title={step ? `${status}: ${step}` : (status ?? '')}>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${conf.classes}`}>
            {conf.label}
          </span>
        </div>
      )
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
          node.setData({
            ...node.data,
            sync_status: msg.status,
            sync_step: msg.step,
            sync_time: msg.status === 'success' || msg.status === 'failure' ? new Date().toISOString() : node.data.sync_time,
          })
        }
      }
      if (msg.status === 'success' || msg.status === 'failure') {
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      }
    },
    [queryClient]
  )

  useSyncStatusWebSocket(handleSyncMessage)

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

  const STAT_CARDS = [
    {
      label: '전체 장비',
      value: stats?.total_devices,
      sub: `활성: ${formatNumber(stats?.active_devices)}`,
      iconBg: 'bg-ds-primary-container',
      iconColor: 'text-ds-on-primary-container',
    },
    {
      label: '전체 정책',
      value: stats?.total_policies,
      sub: `활성 ${formatNumber(stats?.total_active_policies)} / 비활성 ${formatNumber(stats?.total_disabled_policies)}`,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-700',
    },
    {
      label: '네트워크 객체',
      value: stats?.total_network_objects,
      sub: '',
      iconBg: 'bg-ds-secondary-container',
      iconColor: 'text-ds-on-secondary-container',
    },
    {
      label: '서비스 객체',
      value: stats?.total_services,
      sub: '',
      iconBg: 'bg-ds-primary-container',
      iconColor: 'text-ds-on-primary-container',
    },
  ]

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ds-on-surface font-headline">대시보드</h1>
        <p className="text-ds-on-surface-variant text-sm mt-1">방화벽 장비 현황 및 동기화 상태를 확인합니다.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {STAT_CARDS.map((card) => (
          <div key={card.label} className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border p-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ds-primary">{card.label}</p>
            <p className="text-4xl font-extrabold text-ds-on-surface mt-2 font-headline">
              {isLoading ? '…' : formatNumber(card.value)}
            </p>
            {card.sub && <p className="text-xs text-ds-on-surface-variant mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 동기화 상태 요약 */}
        <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border p-6">
          <h2 className="text-sm font-bold text-ds-on-surface font-headline mb-4">동기화 상태 요약</h2>
          {rowData.length === 0 ? (
            <p className="text-sm text-ds-on-surface-variant text-center py-6">등록된 장비가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(statusCounts).map(([status, count]) => {
                const conf = STATUS_PILL[status]
                if (!conf) return null
                return (
                  <div key={status} className="flex items-center justify-between py-2 px-3 rounded-lg bg-ds-surface-container-low">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${conf.classes}`}>
                      {conf.label}
                    </span>
                    <span className="text-lg font-extrabold text-ds-on-surface font-headline">{count}</span>
                  </div>
                )
              })}
              <p className="text-xs text-ds-on-surface-variant text-right pt-1">총 {formatNumber(rowData.length)}개 장비</p>
            </div>
          )}
        </div>

        {/* 벤더별 통계 */}
        <div className="lg:col-span-2 bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border p-6">
          <h2 className="text-sm font-bold text-ds-on-surface font-headline mb-4">벤더별 통계</h2>
          {Object.entries(vendorMap).length === 0 ? (
            <p className="text-sm text-ds-on-surface-variant text-center py-6">장비 데이터가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(vendorMap)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([vendor, v]) => (
                  <div key={vendor} className="bg-ds-surface-container-low rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-ds-on-surface font-headline">
                        {VENDOR_LABELS[vendor.toLowerCase()] ?? vendor}
                      </span>
                      <span className="text-xs text-ds-on-surface-variant">{v.count}개 장비</span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 text-xs">
                      {[
                        { label: '정책', value: v.policies },
                        { label: '활성 정책', value: v.activePolicies },
                        { label: '네트워크 객체', value: v.networkObjects },
                        { label: '서비스 객체', value: v.services },
                      ].map((item) => (
                        <div key={item.label}>
                          <p className="text-ds-on-surface-variant text-[10px] uppercase tracking-wide">{item.label}</p>
                          <p className="font-bold text-ds-on-surface mt-0.5">{formatNumber(item.value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* 장비별 통계 그리드 */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ds-outline-variant/10">
          <h2 className="text-sm font-bold text-ds-on-surface font-headline">장비별 통계</h2>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ds-on-surface-variant hover:text-ds-on-surface hover:bg-ds-surface-container-low rounded-md transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            새로고침
          </button>
        </div>
        <div className="px-4 pb-4 pt-2">
          <AgGridWrapper<DeviceRow>
            ref={gridRef}
            columnDefs={COLUMN_DEFS}
            rowData={rowData}
            getRowId={(p) => String(p.data.id)}
            height={300}
            noRowsText="장비를 추가하세요."
          />
        </div>
      </div>
    </div>
  )
}
