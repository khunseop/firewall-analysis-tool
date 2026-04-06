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
  paloalto: 'bg-ds-surface-container-high text-ds-on-surface-variant',
  ngf:      'bg-ds-surface-container-high text-ds-on-surface-variant',
  mf2:      'bg-ds-surface-container-high text-ds-on-surface-variant',
  mock:     'bg-ds-surface-container-high text-ds-on-surface-variant',
}

const STATUS_CONFIG: Record<string, { label: string; classes: string; dotColor: string }> = {
  success:     { label: '완료',   classes: 'bg-ds-secondary-container text-ds-on-secondary-container', dotColor: 'bg-green-500' },
  in_progress: { label: '진행중', classes: 'bg-ds-tertiary/10 text-ds-tertiary', dotColor: 'bg-ds-tertiary animate-pulse' },
  pending:     { label: '대기중', classes: 'bg-ds-surface-container text-ds-on-surface-variant',   dotColor: 'bg-ds-outline' },
  failure:     { label: '실패',   classes: 'bg-ds-error-container/20 text-ds-error',     dotColor: 'bg-ds-error' },
  error:       { label: '오류',   classes: 'bg-ds-error-container/20 text-ds-error',     dotColor: 'bg-ds-error' },
}

const NOTIF_CATEGORY_BG: Record<string, string> = {
  sync:     'bg-ds-tertiary/5',
  analysis: 'bg-purple-500/5',
  system:   'bg-ds-on-surface-variant/5',
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
    id: d.id,
    name: d.name,
    vendor: d.vendor,
    ip_address: d.ip_address,
    policies: d.policies ?? 0,
    active_policies: d.active_policies ?? 0,
    disabled_policies: d.disabled_policies ?? 0,
    network_objects: d.network_objects ?? 0,
    services: d.services ?? 0,
    sync_status: d.sync_status,
    sync_step: d.sync_step,
    sync_time: d.sync_time,
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
    acc[v].count += 1
    acc[v].policies += d.policies
    acc[v].activePolicies += d.active_policies
    acc[v].networkObjects += d.network_objects
    acc[v].services += d.services
    return acc
  }, {})

  const errorDevices = rowData.filter(d => d.sync_status === 'failure' || d.sync_status === 'error')

  const totalPolicies = stats?.total_policies ?? 0
  const activePolicies = stats?.total_active_policies ?? 0
  const totalDevices = stats?.total_devices ?? 0
  const successDevices = stats?.active_devices ?? 0

  const STAT_CARDS = [
    {
      label: '전체 장비', value: totalDevices, icon: Router,
      iconBg: 'bg-ds-primary-container', iconColor: 'text-ds-on-primary-container',
      sub: null,
      bar: { 
        value: successDevices, 
        total: totalDevices, 
        label: `동기화 성공률: ${totalDevices > 0 ? Math.round(successDevices/totalDevices*100) : 0}%`, 
        color: 'bg-green-500' 
      },
    },
    {
      label: '전체 정책', value: totalPolicies, icon: ShieldCheck,
      iconBg: 'bg-blue-100', iconColor: 'text-blue-700',
      sub: null,
      bar: { 
        value: activePolicies, 
        total: totalPolicies, 
        label: `정책 활성률: ${totalPolicies > 0 ? Math.round(activePolicies/totalPolicies*100) : 0}%`, 
        color: 'bg-ds-tertiary' 
      },
    },
    {
      label: '네트워크 객체', value: stats?.total_network_objects ?? 0,
      icon: Network, iconBg: 'bg-ds-secondary-container', iconColor: 'text-ds-on-secondary-container',
      sub: `총 ${formatNumber(stats?.total_network_objects ?? 0)}개 식별`, bar: null,
    },
    {
      label: '서비스 객체', value: stats?.total_services ?? 0,
      icon: Database, iconBg: 'bg-ds-primary-container', iconColor: 'text-ds-on-primary-container',
      sub: `총 ${formatNumber(stats?.total_services ?? 0)}개 식별`, bar: null,
    },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tighter text-ds-on-surface font-headline">대시보드</h1>
          <p className="text-ds-on-surface-variant text-sm mt-1.5 font-medium">실시간 방화벽 장비 및 동기화 인프라 현황</p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-ds-on-surface bg-white rounded-xl shadow-sm border border-ds-outline-variant/10 hover:bg-ds-surface-container-low transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          현황 갱신
        </button>
      </div>

      {/* 오류 장비 경고 배너 */}
      {errorDevices.length > 0 && (
        <div className="flex items-center justify-between bg-ds-error-container/10 border border-ds-error/20 rounded-2xl px-6 py-4 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-ds-error-container/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-ds-error" />
            </div>
            <div>
              <p className="text-sm font-bold text-ds-error">
                {errorDevices.length}개 장비의 동기화가 중단되었습니다
              </p>
              <p className="text-xs text-ds-error/70 mt-0.5 font-medium">
                {errorDevices.map(d => d.name).join(', ')}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/devices')}
            className="px-4 py-2 bg-ds-error text-white text-xs font-bold rounded-lg hover:brightness-110 transition-all shrink-0"
          >
            장비 진단하러 가기
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-white p-6 rounded-2xl shadow-sm border border-ds-outline-variant/5">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-ds-on-surface-variant font-bold text-[10px] uppercase tracking-widest">{card.label}</p>
                  <h3 className="text-4xl font-extrabold text-ds-on-surface mt-2 font-headline tracking-tighter">
                    {isLoading ? '…' : formatNumber(card.value)}
                  </h3>
                </div>
                <div className={`p-3 ${card.iconBg} rounded-xl ${card.iconColor} shrink-0 ml-3 shadow-inner`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              {card.bar && (
                <div className="mt-5">
                  <MiniBar value={card.bar.value} total={card.bar.total} color={card.bar.color} />
                  <p className="text-[10px] text-ds-on-surface-variant mt-2 font-bold tracking-tight">{card.bar.label}</p>
                </div>
              )}
              {card.sub && !card.bar && (
                <p className="text-xs text-ds-on-surface-variant mt-5 font-semibold">{card.sub}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Middle: 동기화 상태 + 벤더별 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-ds-outline-variant/5 p-7">
          <h2 className="text-lg font-bold text-ds-on-surface font-headline mb-5">동기화 상태</h2>
          {rowData.length === 0 ? (
            <p className="text-sm text-ds-on-surface-variant text-center py-10 font-medium">등록된 장비가 없습니다.</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(statusCounts).map(([status, count]) => {
                const conf = STATUS_CONFIG[status]
                if (!conf) return null
                return (
                  <div key={status} className="flex items-center justify-between py-3 px-4 rounded-xl bg-ds-surface-container-low/50">
                    <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-tight ${conf.classes}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${conf.dotColor}`} />
                      {conf.label}
                    </span>
                    <span className="text-2xl font-extrabold text-ds-on-surface font-headline">{count}</span>
                  </div>
                )
              })}
              <div className="pt-2 flex justify-end">
                <span className="text-[11px] font-bold text-ds-on-surface-variant uppercase tracking-widest">Total: {formatNumber(rowData.length)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-ds-outline-variant/5 p-7">
          <h2 className="text-lg font-bold text-ds-on-surface font-headline mb-5">벤더별 통계</h2>
          {Object.entries(vendorMap).length === 0 ? (
            <p className="text-sm text-ds-on-surface-variant text-center py-10 font-medium">장비 데이터가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(vendorMap).sort((a, b) => b[1].count - a[1].count).map(([vendor, v]) => (
                <div key={vendor} className="bg-ds-surface-container-low/30 rounded-xl p-5 border border-ds-outline-variant/5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${VENDOR_BADGE[vendor.toLowerCase()] ?? 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
                        {VENDOR_LABELS[vendor.toLowerCase()] ?? vendor}
                      </span>
                      <span className="text-xs font-bold text-ds-on-surface-variant">{v.count} Devices</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                    {[
                      { label: '전체 정책', value: v.policies },
                      { label: '활성 정책', value: v.activePolicies },
                      { label: '네트워크 객체', value: v.networkObjects },
                      { label: '서비스 객체', value: v.services },
                    ].map((item) => (
                      <div key={item.label}>
                        <p className="text-ds-on-surface-variant text-[10px] uppercase tracking-widest font-bold opacity-60">{item.label}</p>
                        <p className="font-extrabold text-ds-on-surface mt-1 text-base font-headline">{formatNumber(item.value)}</p>
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
      <div className="bg-white rounded-2xl shadow-sm border border-ds-outline-variant/5 overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-ds-outline-variant/5 bg-ds-surface-container-low/20">
          <div>
            <h2 className="text-lg font-bold text-ds-on-surface font-headline">장비별 실시간 현황</h2>
            <p className="text-xs text-ds-on-surface-variant mt-1 font-medium">방화벽 엔진과 실시간 데이터 동기화 중</p>
          </div>
          <div className="flex items-center text-[11px] font-bold text-green-600 bg-green-50 px-3.5 py-1.5 rounded-full border border-green-100 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2 animate-pulse" />
            Live Connection
          </div>
        </div>
        <AgGridWrapper<DeviceRow>
          ref={gridRef}
          columnDefs={COLUMN_DEFS}
          rowData={rowData}
          getRowId={(p) => String(p.data.id)}
          height={rowData.length > 0 ? Math.min(rowData.length * 52 + 50, 400) : 240}
          noRowsText="등록된 장비가 없습니다."
        />
      </div>

      {/* 최근 활동 피드 */}
      <div className="bg-white rounded-2xl shadow-sm border border-ds-outline-variant/5 overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-ds-outline-variant/5 bg-ds-surface-container-low/20">
          <h2 className="text-lg font-bold text-ds-on-surface font-headline">최근 보안 활동</h2>
          <button
            onClick={() => navigate('/notifications')}
            className="flex items-center gap-1.5 text-xs font-bold text-ds-tertiary hover:underline uppercase tracking-widest"
          >
            전체 로그 조회 <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        {notifications.length === 0 ? (
          <div className="px-8 py-16 text-center text-sm text-ds-on-surface-variant font-medium">기록된 활동이 없습니다.</div>
        ) : (
          <div className="divide-y divide-ds-outline-variant/5">
            {notifications.map((n) => {
              const typeConf = NOTIF_TYPE_ICON[n.type] ?? NOTIF_TYPE_ICON.info
              const Icon = typeConf.icon
              return (
                <div key={n.id} className="group flex items-start gap-5 px-8 py-5 hover:bg-ds-surface-container-low/30 transition-all duration-200">
                  <div className={`p-2.5 rounded-xl ${NOTIF_CATEGORY_BG[n.category ?? 'system']} shrink-0`}>
                    <Icon className={`w-4.5 h-4.5 ${typeConf.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-bold text-ds-on-surface group-hover:text-ds-tertiary transition-colors">{n.title}</p>
                      <span className="text-[10px] font-bold text-ds-on-surface-variant uppercase tracking-tight bg-ds-surface-container-low px-2 py-0.5 rounded">{formatRelativeTime(n.timestamp)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      {n.device_name && (
                        <span className="text-[10px] font-bold text-ds-tertiary uppercase tracking-widest">{n.device_name}</span>
                      )}
                      {n.message && (
                        <p className="text-xs text-ds-on-surface-variant font-medium truncate">{n.message}</p>
                      )}
                    </div>
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
