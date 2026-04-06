import { useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Router, ShieldCheck, Database, Network, AlertTriangle, ArrowRight, CheckCircle2, Loader2, XCircle, Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { GridApi } from '@ag-grid-community/core'
import type { ColDef } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { getDashboardStats, type DeviceStats } from '@/api/devices'
import { getNotifications, type NotificationLog } from '@/api/notifications'
import { useSyncStatusWebSocket } from '@/hooks/useWebSocket'
import { formatNumber, formatRelativeTime } from '@/lib/utils'

const VENDOR_LABELS: Record<string, string> = {
  paloalto: 'Palo Alto',
  ngf: 'SECUI NGF',
  mf2: 'SECUI MF2',
  mock: 'Mock',
}

const VENDOR_BADGE: Record<string, string> = {
  paloalto: 'bg-orange-100 text-orange-700',
  ngf:      'bg-blue-100 text-blue-700',
  mf2:      'bg-indigo-100 text-indigo-700',
  mock:     'bg-gray-100 text-gray-600',
}

const STATUS_CONFIG: Record<string, { label: string; classes: string; dotColor: string }> = {
  success:     { label: '완료',   classes: 'bg-green-100 text-green-700', dotColor: 'bg-green-500' },
  in_progress: { label: '진행중', classes: 'bg-amber-100 text-amber-700', dotColor: 'bg-amber-500 animate-pulse' },
  pending:     { label: '대기중', classes: 'bg-blue-100 text-blue-700',   dotColor: 'bg-blue-400' },
  failure:     { label: '실패',   classes: 'bg-red-100 text-red-700',     dotColor: 'bg-red-500' },
  error:       { label: '오류',   classes: 'bg-red-100 text-red-700',     dotColor: 'bg-red-500' },
}

const NOTIF_CATEGORY_BORDER: Record<string, string> = {
  sync:     'border-l-ds-tertiary',
  analysis: 'border-l-purple-500',
  system:   'border-l-ds-on-surface-variant',
}

const NOTIF_TYPE_ICON: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  success: { icon: CheckCircle2,  color: 'text-green-600' },
  info:    { icon: Clock,         color: 'text-ds-tertiary' },
  warning: { icon: AlertTriangle, color: 'text-amber-600' },
  error:   { icon: XCircle,       color: 'text-ds-error' },
}

interface DeviceRow {
  id: number; name: string; vendor: string; ip_address?: string
  policies: number; active_policies: number; disabled_policies: number
  network_objects: number; services: number
  sync_status: string | null; sync_step: string | null; sync_time: string | null
}

function transformDeviceStats(d: DeviceStats): DeviceRow {
  return {
    id: d.id, name: d.name, vendor: d.vendor,
    policies: d.total_policies ?? 0, active_policies: d.active_policies ?? 0,
    disabled_policies: d.disabled_policies ?? 0,
    network_objects: d.total_network_objects ?? 0, services: d.total_services ?? 0,
    sync_status: d.last_sync_status, sync_step: d.last_sync_step, sync_time: d.last_sync_at,
  }
}

function MiniBar({ value, total, color = 'bg-ds-tertiary' }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-ds-surface-container-high rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-semibold text-ds-on-surface-variant w-8 text-right">{pct}%</span>
    </div>
  )
}

// Dashboard still needs AG Grid for real-time WebSocket updates (row.setData)
const COLUMN_DEFS: ColDef<DeviceRow>[] = [
  { field: 'name', headerName: '장비명', filter: 'agTextColumnFilter', width: 160 },
  { field: 'vendor', headerName: '벤더', filter: 'agTextColumnFilter', width: 100,
    cellRenderer: (p: { value: string }) => {
      const cls = VENDOR_BADGE[p.value?.toLowerCase()] ?? 'bg-gray-100 text-gray-600'
      return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${cls}`}>{VENDOR_LABELS[p.value?.toLowerCase()] ?? p.value}</span>
    },
  },
  { field: 'policies', headerName: '전체 정책', filter: 'agNumberColumnFilter', width: 100, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'active_policies', headerName: '활성', filter: 'agNumberColumnFilter', width: 80, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'disabled_policies', headerName: '비활성', filter: 'agNumberColumnFilter', width: 80, valueFormatter: (p) => formatNumber(p.value) },
  {
    headerName: '활성률',
    width: 140,
    sortable: false,
    cellRenderer: (p: { data: DeviceRow }) => (
      <div className="w-full py-1">
        <MiniBar value={p.data.active_policies} total={p.data.policies} />
      </div>
    ),
  },
  { field: 'network_objects', headerName: '네트워크 객체', filter: 'agNumberColumnFilter', width: 120, valueFormatter: (p) => formatNumber(p.value) },
  { field: 'services', headerName: '서비스 객체', filter: 'agNumberColumnFilter', width: 110, valueFormatter: (p) => formatNumber(p.value) },
  {
    field: 'sync_time', headerName: '마지막 동기화', filter: 'agTextColumnFilter', width: 130,
    valueFormatter: (p) => formatRelativeTime(p.value),
  },
  {
    field: 'sync_status', headerName: '상태', width: 100,
    cellRenderer: (params: { value: string | null; data: DeviceRow }) => {
      const conf = STATUS_CONFIG[params.value ?? '']
      if (!conf) return <span className="text-ds-on-surface-variant text-xs">-</span>
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${conf.classes}`}
          title={params.data.sync_step ?? ''}>
          <span className={`w-1.5 h-1.5 rounded-full ${conf.dotColor}`} />
          {conf.label}
        </span>
      )
    },
  },
]

export function DashboardPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const gridRef = useRef<AgGridWrapperHandle>(null)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'], queryFn: getDashboardStats, staleTime: 60_000,
  })

  const { data: notifData } = useQuery({
    queryKey: ['notifications-feed'],
    queryFn: () => getNotifications({ limit: 8 }),
    staleTime: 30_000,
  })
  const notifications: NotificationLog[] = notifData?.items ?? []

  const rowData: DeviceRow[] = stats?.device_stats.map(transformDeviceStats) ?? []

  const handleSyncMessage = useCallback(
    (msg: { device_id: number; status: string; step: string | null }) => {
      const api: GridApi<DeviceRow> | null = gridRef.current?.gridApi ?? null
      if (api) {
        const node = api.getRowNode(String(msg.device_id))
        if (node?.data) {
          node.setData({ ...node.data, sync_status: msg.status, sync_step: msg.step,
            sync_time: msg.status === 'success' || msg.status === 'failure' ? new Date().toISOString() : node.data.sync_time,
          })
        }
      }
      if (msg.status === 'success' || msg.status === 'failure') {
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
        queryClient.invalidateQueries({ queryKey: ['notifications-feed'] })
      }
    },
    [queryClient]
  )
  useSyncStatusWebSocket(handleSyncMessage)

  const statusCounts = rowData.reduce<Record<string, number>>((acc, d) => {
    const s = d.sync_status ?? 'unknown'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  const vendorMap = rowData.reduce<Record<string, { count: number; policies: number; activePolicies: number; networkObjects: number; services: number }>>((acc, d) => {
    const v = d.vendor ?? 'Unknown'
    if (!acc[v]) acc[v] = { count: 0, policies: 0, activePolicies: 0, networkObjects: 0, services: 0 }
    acc[v].count += 1; acc[v].policies += d.policies; acc[v].activePolicies += d.active_policies
    acc[v].networkObjects += d.network_objects; acc[v].services += d.services
    return acc
  }, {})

  const errorDevices = rowData.filter(d => d.sync_status === 'failure' || d.sync_status === 'error')

  const totalPolicies = stats?.total_policies ?? 0
  const activePolicies = stats?.total_active_policies ?? 0
  const activeDevices = stats?.active_devices ?? 0
  const totalDevices = stats?.total_devices ?? 0
  const successDevices = statusCounts['success'] ?? 0

  const STAT_CARDS = [
    {
      label: '전체 장비', value: totalDevices, icon: Router,
      iconBg: 'bg-ds-primary-container', iconColor: 'text-ds-on-primary-container',
      sub: null,
      bar: { value: successDevices, total: totalDevices, label: `동기화 성공 ${totalDevices > 0 ? Math.round(successDevices/totalDevices*100) : 0}%`, color: 'bg-green-500' },
    },
    {
      label: '전체 정책', value: totalPolicies, icon: ShieldCheck,
      iconBg: 'bg-blue-100', iconColor: 'text-blue-700',
      sub: null,
      bar: { value: activePolicies, total: totalPolicies, label: `활성 ${totalPolicies > 0 ? Math.round(activePolicies/totalPolicies*100) : 0}%`, color: 'bg-ds-tertiary' },
    },
    {
      label: '네트워크 객체', value: stats?.total_network_objects,
      icon: Network, iconBg: 'bg-ds-secondary-container', iconColor: 'text-ds-on-secondary-container',
      sub: null, bar: null,
    },
    {
      label: '서비스 객체', value: stats?.total_services,
      icon: Database, iconBg: 'bg-ds-primary-container', iconColor: 'text-ds-on-primary-container',
      sub: `활성 장비: ${formatNumber(activeDevices)}`,
      bar: null,
    },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tighter text-ds-on-surface font-headline">대시보드</h1>
          <p className="text-ds-on-surface-variant text-sm mt-1">방화벽 장비 현황 및 동기화 상태를 실시간으로 확인합니다.</p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-ds-on-surface bg-ds-surface-container-lowest ghost-border rounded-xl ambient-shadow hover:bg-ds-surface-container-low transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          새로고침
        </button>
      </div>

      {/* 오류 장비 경고 배너 */}
      {errorDevices.length > 0 && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-ds-error shrink-0" />
            <div>
              <p className="text-sm font-bold text-ds-error">
                {errorDevices.length}개 장비에 동기화 오류가 발생했습니다
              </p>
              <p className="text-xs text-red-600 mt-0.5">
                {errorDevices.map(d => d.name).join(', ')}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/devices')}
            className="flex items-center gap-1.5 text-sm font-bold text-ds-error hover:underline shrink-0"
          >
            장비 관리로 이동 <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-ds-surface-container-lowest p-6 rounded-xl ambient-shadow ghost-border">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-ds-on-surface-variant font-medium text-xs tracking-wide uppercase">{card.label}</p>
                  <h3 className="text-4xl font-extrabold text-ds-on-surface mt-2 font-headline">
                    {isLoading ? '…' : formatNumber(card.value)}
                  </h3>
                </div>
                <div className={`p-3 ${card.iconBg} rounded-lg ${card.iconColor} shrink-0 ml-3`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              {card.bar && (
                <div className="mt-4">
                  <MiniBar value={card.bar.value} total={card.bar.total} color={card.bar.color} />
                  <p className="text-[10px] text-ds-on-surface-variant mt-1 font-medium">{card.bar.label}</p>
                </div>
              )}
              {card.sub && !card.bar && (
                <p className="text-xs text-ds-on-surface-variant mt-4 font-medium">{card.sub}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Middle: 동기화 상태 + 벤더별 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border p-6">
          <h2 className="text-base font-bold text-ds-on-surface font-headline mb-4">동기화 상태</h2>
          {rowData.length === 0 ? (
            <p className="text-sm text-ds-on-surface-variant text-center py-6">등록된 장비가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(statusCounts).map(([status, count]) => {
                const conf = STATUS_CONFIG[status]
                if (!conf) return null
                return (
                  <div key={status} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-ds-surface-container-low">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${conf.classes}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${conf.dotColor}`} />
                      {conf.label}
                    </span>
                    <span className="text-2xl font-extrabold text-ds-on-surface font-headline">{count}</span>
                  </div>
                )
              })}
              <p className="text-xs text-ds-on-surface-variant text-right pt-1">총 {formatNumber(rowData.length)}개 장비</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border p-6">
          <h2 className="text-base font-bold text-ds-on-surface font-headline mb-4">벤더별 통계</h2>
          {Object.entries(vendorMap).length === 0 ? (
            <p className="text-sm text-ds-on-surface-variant text-center py-6">장비 데이터가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(vendorMap).sort((a, b) => b[1].count - a[1].count).map(([vendor, v]) => (
                <div key={vendor} className="bg-ds-surface-container-low rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${VENDOR_BADGE[vendor.toLowerCase()] ?? 'bg-gray-100 text-gray-600'}`}>
                        {VENDOR_LABELS[vendor.toLowerCase()] ?? vendor}
                      </span>
                      <span className="text-xs text-ds-on-surface-variant">{v.count}개 장비</span>
                    </div>
                    <div className="flex-1 max-w-[120px] ml-4">
                      <MiniBar value={v.activePolicies} total={v.policies} />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: '정책', value: v.policies },
                      { label: '활성', value: v.activePolicies },
                      { label: '네트워크 객체', value: v.networkObjects },
                      { label: '서비스 객체', value: v.services },
                    ].map((item) => (
                      <div key={item.label}>
                        <p className="text-ds-on-surface-variant text-[10px] uppercase tracking-wide font-medium">{item.label}</p>
                        <p className="font-bold text-ds-on-surface mt-0.5 text-sm">{formatNumber(item.value)}</p>
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
        <div className="flex items-center justify-between px-8 py-5 border-b border-ds-outline-variant/10">
          <div>
            <h2 className="text-base font-bold text-ds-on-surface font-headline">장비별 현황</h2>
            <p className="text-xs text-ds-on-surface-variant mt-0.5">실시간 동기화 상태 반영</p>
          </div>
          <div className="flex items-center text-sm text-ds-on-surface-variant bg-ds-surface-container-low px-3 py-1.5 rounded-lg">
            <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
            WebSocket 연결됨
          </div>
        </div>
        <AgGridWrapper<DeviceRow>
          ref={gridRef}
          columnDefs={COLUMN_DEFS}
          rowData={rowData}
          getRowId={(p) => String(p.data.id)}
          height={rowData.length > 0 ? Math.min(rowData.length * 52 + 50, 400) : 200}
          noRowsText="장비를 추가하세요."
        />
      </div>

      {/* 최근 활동 피드 */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        <div className="flex items-center justify-between px-8 py-5 border-b border-ds-outline-variant/10">
          <h2 className="text-base font-bold text-ds-on-surface font-headline">최근 활동</h2>
          <button
            onClick={() => navigate('/notifications')}
            className="flex items-center gap-1 text-xs font-semibold text-ds-tertiary hover:underline"
          >
            전체 보기 <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        {notifications.length === 0 ? (
          <div className="px-8 py-10 text-center text-sm text-ds-on-surface-variant">활동 기록이 없습니다.</div>
        ) : (
          <div className="divide-y divide-ds-outline-variant/10">
            {notifications.map((n) => {
              const typeConf = NOTIF_TYPE_ICON[n.type] ?? NOTIF_TYPE_ICON.info
              const Icon = typeConf.icon
              const borderCls = NOTIF_CATEGORY_BORDER[n.category ?? 'system'] ?? 'border-l-ds-on-surface-variant'
              return (
                <div key={n.id} className={`flex items-start gap-4 px-8 py-4 hover:bg-ds-surface-container-low/30 transition-colors border-l-2 ${borderCls}`}>
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${typeConf.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-semibold text-ds-on-surface truncate">{n.title}</p>
                      <span className="text-[10px] text-ds-on-surface-variant shrink-0">{formatRelativeTime(n.timestamp)}</span>
                    </div>
                    {n.device_name && (
                      <span className="text-[10px] font-mono text-ds-tertiary mt-0.5 block">{n.device_name}</span>
                    )}
                    {n.message && (
                      <p className="text-xs text-ds-on-surface-variant mt-0.5 truncate">{n.message}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
