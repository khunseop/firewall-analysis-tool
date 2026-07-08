import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, Search, ArrowRight } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { AgGridWrapper } from '@/components/shared/AgGridWrapper'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'
import { DeviceSelector } from '@/components/shared/DeviceSelector'
import { listDevices } from '@/api/devices'
import { useDeviceStore } from '@/store/deviceStore'
import {
  getNetworkObjects, getNetworkGroups, getServices, getServiceGroups, exportToExcel,
  getObjectUsageCounts,
  type NetworkObject, type NetworkGroup, type Service, type ServiceGroup,
} from '@/api/firewall'
import { queryKeys } from '@/api/queryKeys'

const objectRowId = (p: { data: unknown }) => String((p.data as Record<string, unknown>)['id'])

type TabKey = 'network_objects' | 'network_groups' | 'services' | 'service_groups'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'network_objects', label: '네트워크 객체' },
  { key: 'network_groups', label: '네트워크 그룹' },
  { key: 'services', label: '서비스' },
  { key: 'service_groups', label: '서비스 그룹' },
]

function useObjectsData(deviceIds: number[], tab: TabKey) {
  const enabled = deviceIds.length > 0
  const networkObjects = useQuery({
    queryKey: queryKeys.networkObjects(deviceIds),
    queryFn: async () => (await Promise.all(deviceIds.map((id) => getNetworkObjects(id)))).flat(),
    enabled: enabled && tab === 'network_objects', staleTime: 30_000,
  })
  const networkGroups = useQuery({
    queryKey: queryKeys.networkGroups(deviceIds),
    queryFn: async () => (await Promise.all(deviceIds.map((id) => getNetworkGroups(id)))).flat(),
    enabled: enabled && tab === 'network_groups', staleTime: 30_000,
  })
  const services = useQuery({
    queryKey: queryKeys.services(deviceIds),
    queryFn: async () => (await Promise.all(deviceIds.map((id) => getServices(id)))).flat(),
    enabled: enabled && tab === 'services', staleTime: 30_000,
  })
  const serviceGroups = useQuery({
    queryKey: queryKeys.serviceGroups(deviceIds),
    queryFn: async () => (await Promise.all(deviceIds.map((id) => getServiceGroups(id)))).flat(),
    enabled: enabled && tab === 'service_groups', staleTime: 30_000,
  })
  return { networkObjects, networkGroups, services, serviceGroups }
}


function SearchPolicyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title="정책에서 검색"
      className="ml-1 opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold text-ds-tertiary/70 hover:text-ds-tertiary hover:bg-ds-tertiary/10 transition-all"
    >
      <ArrowRight className="w-2.5 h-2.5" />
      정책
    </button>
  )
}

export function ObjectsPage() {
  const { selectedIds: deviceIds } = useDeviceStore()
  const [activeTab, setActiveTab] = useState<TabKey>('network_objects')
  const [quickFilter, setQuickFilter] = useState('')
  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)
  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })
  const navigate = useNavigate()
  const { networkObjects, networkGroups, services, serviceGroups } = useObjectsData(deviceIds, activeTab)

  const { data: usageCounts = [] } = useQuery({
    queryKey: queryKeys.objectUsageCounts(deviceIds),
    queryFn: () => getObjectUsageCounts(deviceIds),
    enabled: deviceIds.length > 0,
    staleTime: 60_000,
  })

  // key: "{device_id}_{name}" → policy_count (address용, service용 분리)
  const addrUsageMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of usageCounts) {
      if (u.member_type === 'address') m.set(`${u.device_id}_${u.name}`, u.policy_count)
    }
    return m
  }, [usageCounts])

  const svcUsageMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of usageCounts) {
      if (u.member_type === 'service') m.set(`${u.device_id}_${u.name}`, u.policy_count)
    }
    return m
  }, [usageCounts])

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab)
    setQuickFilter('')
  }

  const deviceNameMap = useMemo(
    () => new Map(devices.map(d => [d.id, d.name])),
    [devices]
  )

  const handleExport = async (data: unknown[], filename: string) => {
    if (data.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try {
      let exportData: Record<string, unknown>[]
      if (activeTab === 'network_objects') {
        exportData = (data as NetworkObject[]).map(o => ({
          '장비명': deviceNameMap.get(o.device_id) ?? String(o.device_id),
          '이름': o.name,
          'IP 주소': o.ip_address,
          '타입': o.type,
          '설명': o.description,
        }))
      } else if (activeTab === 'network_groups') {
        exportData = (data as NetworkGroup[]).map(o => ({
          '장비명': deviceNameMap.get(o.device_id) ?? String(o.device_id),
          '이름': o.name,
          '멤버': o.members,
          '설명': o.description,
        }))
      } else if (activeTab === 'services') {
        exportData = (data as Service[]).map(o => ({
          '장비명': deviceNameMap.get(o.device_id) ?? String(o.device_id),
          '이름': o.name,
          '프로토콜': o.protocol,
          '포트': o.port,
          '설명': o.description,
        }))
      } else {
        exportData = (data as ServiceGroup[]).map(o => ({
          '장비명': deviceNameMap.get(o.device_id) ?? String(o.device_id),
          '이름': o.name,
          '멤버': o.members,
          '설명': o.description,
        }))
      }
      await exportToExcel(exportData, filename)
    }
    catch (e: unknown) { toast.error((e as Error).message) }
  }

  const deviceNameCol = <T extends { device_id: number }>(): ColDef<T> => ({
    headerName: '장비명',
    filter: 'agTextColumnFilter',
    width: 130,
    pinned: 'left' as const,
    valueGetter: (p) => deviceNameMap.get((p.data as T)?.device_id ?? -1) ?? String((p.data as T)?.device_id ?? '-'),
    cellRenderer: (p: { value: string }) => (
      <span className="text-[11px] font-semibold text-ds-tertiary font-mono">{p.value}</span>
    ),
  })

  const usageCol = <T extends { device_id: number; name: string }>(usageMap: Map<string, number>): ColDef<T> => ({
    headerName: '사용 정책',
    filter: 'agNumberColumnFilter',
    width: 100,
    sort: 'asc' as const,
    valueGetter: (p) => usageMap.get(`${(p.data as T)?.device_id}_${(p.data as T)?.name}`) ?? 0,
    cellRenderer: (p: { value: number }) => {
      if (p.value === 0) {
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600">미사용</span>
      }
      return <span className="text-[12px] font-semibold tabular-nums text-ds-on-surface">{p.value}</span>
    },
  })

  const networkObjectCols: ColDef<NetworkObject>[] = [
    deviceNameCol<NetworkObject>() as ColDef<NetworkObject>,
    {
      field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 220,
      cellRenderer: (p: { value: string; data: NetworkObject }) => (
        <div className="group flex items-center gap-1">
          <button
            onClick={() => setObjectModal({ deviceId: p.data.device_id, name: p.value })}
            className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left truncate"
          >
            {p.value}
          </button>
          <SearchPolicyButton onClick={() => navigate(`/policies?obj_name=${encodeURIComponent(p.value)}`)} />
        </div>
      ),
    },
    usageCol<NetworkObject>(addrUsageMap) as ColDef<NetworkObject>,
    { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', width: 180, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs text-ds-on-surface-variant">{p.value ?? '-'}</span> },
    { field: 'type', headerName: '타입', filter: 'agTextColumnFilter', width: 100, cellRenderer: (p: { value: string }) => <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-ds-surface-container text-ds-on-surface-variant uppercase">{p.value}</span> },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', flex: 1 },
  ]

  const networkGroupCols: ColDef<NetworkGroup>[] = [
    deviceNameCol<NetworkGroup>() as ColDef<NetworkGroup>,
    {
      field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 220,
      cellRenderer: (p: { value: string; data: NetworkGroup }) => (
        <div className="group flex items-center gap-1">
          <button
            onClick={() => setObjectModal({ deviceId: p.data.device_id, name: p.value })}
            className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left truncate"
          >
            {p.value}
          </button>
          <SearchPolicyButton onClick={() => navigate(`/policies?obj_name=${encodeURIComponent(p.value)}`)} />
        </div>
      ),
    },
    usageCol<NetworkGroup>(addrUsageMap) as ColDef<NetworkGroup>,
    {
      field: 'members', headerName: '멤버', filter: 'agTextColumnFilter', flex: 1,
      cellRenderer: (p: { value: string }) => {
        const members = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean)
        if (members.length === 0) return <span className="text-[11px] text-ds-on-surface-variant">-</span>
        const MAX = 3
        const visible = members.slice(0, MAX)
        const extra = members.length - MAX
        return (
          <div className="flex items-center gap-1 overflow-hidden">
            {visible.map((m, i) => (
              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-ds-secondary-container text-ds-tertiary whitespace-nowrap shrink-0">{m}</span>
            ))}
            {extra > 0 && <span className="text-[10px] font-semibold text-ds-on-surface-variant whitespace-nowrap shrink-0">+{extra}</span>}
          </div>
        )
      },
    },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 200 },
  ]

  const serviceCols: ColDef<Service>[] = [
    deviceNameCol<Service>() as ColDef<Service>,
    {
      field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 220,
      cellRenderer: (p: { value: string; data: Service }) => (
        <div className="group flex items-center gap-1">
          <button
            onClick={() => setObjectModal({ deviceId: p.data.device_id, name: p.value })}
            className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left truncate"
          >
            {p.value}
          </button>
          <SearchPolicyButton onClick={() => navigate(`/policies?svc_name=${encodeURIComponent(p.value)}`)} />
        </div>
      ),
    },
    usageCol<Service>(svcUsageMap) as ColDef<Service>,
    { field: 'protocol', headerName: '프로토콜', filter: 'agTextColumnFilter', width: 110, cellRenderer: (p: { value: string }) => <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-ds-surface-container text-ds-on-surface-variant uppercase">{p.value}</span> },
    { field: 'port', headerName: '포트', filter: 'agTextColumnFilter', width: 140, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs text-ds-on-surface-variant">{p.value ?? '-'}</span> },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', flex: 1 },
  ]

  const serviceGroupCols: ColDef<ServiceGroup>[] = [
    deviceNameCol<ServiceGroup>() as ColDef<ServiceGroup>,
    {
      field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 220,
      cellRenderer: (p: { value: string; data: ServiceGroup }) => (
        <div className="group flex items-center gap-1">
          <button
            onClick={() => setObjectModal({ deviceId: p.data.device_id, name: p.value })}
            className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left truncate"
          >
            {p.value}
          </button>
          <SearchPolicyButton onClick={() => navigate(`/policies?svc_name=${encodeURIComponent(p.value)}`)} />
        </div>
      ),
    },
    usageCol<ServiceGroup>(svcUsageMap) as ColDef<ServiceGroup>,
    {
      field: 'members', headerName: '멤버', filter: 'agTextColumnFilter', flex: 1,
      cellRenderer: (p: { value: string }) => {
        const members = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean)
        if (members.length === 0) return <span className="text-[11px] text-ds-on-surface-variant">-</span>
        const MAX = 3
        const visible = members.slice(0, MAX)
        const extra = members.length - MAX
        return (
          <div className="flex items-center gap-1 overflow-hidden">
            {visible.map((m, i) => (
              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-ds-surface-container text-ds-on-surface-variant whitespace-nowrap shrink-0">{m}</span>
            ))}
            {extra > 0 && <span className="text-[10px] font-semibold text-ds-on-surface-variant whitespace-nowrap shrink-0">+{extra}</span>}
          </div>
        )
      },
    },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 200 },
  ]

  const tabContent: Record<TabKey, { data: unknown[]; isFetching: boolean; cols: ColDef<unknown>[]; filename: string }> = {
    network_objects: { data: networkObjects.data ?? [], isFetching: networkObjects.isFetching, cols: networkObjectCols as ColDef<unknown>[], filename: '네트워크객체' },
    network_groups:  { data: networkGroups.data ?? [],  isFetching: networkGroups.isFetching,  cols: networkGroupCols as ColDef<unknown>[],  filename: '네트워크그룹' },
    services:        { data: services.data ?? [],        isFetching: services.isFetching,        cols: serviceCols as ColDef<unknown>[],        filename: '서비스' },
    service_groups:  { data: serviceGroups.data ?? [],   isFetching: serviceGroups.isFetching,   cols: serviceGroupCols as ColDef<unknown>[],  filename: '서비스그룹' },
  }

  const current = tabContent[activeTab]

  return (
    <div className="flex flex-col gap-4">
      {/* Page header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">Objects</h1>
        <DeviceSelector />
      </div>

      {/* Tabs + Grid */}
      <div className="card rounded-xl overflow-hidden">
        {/* Tab bar + toolbar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-ds-outline-variant/10">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-4 py-1.5 text-[13px] font-semibold tracking-tight transition-colors duration-150 border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'text-ds-tertiary border-ds-tertiary'
                  : 'text-ds-on-surface-variant border-transparent hover:text-ds-on-surface hover:border-ds-outline-variant/30'
              }`}
            >
              {tab.label}
              {tabContent[tab.key].data.length > 0 && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.key ? 'bg-ds-tertiary/10 text-ds-tertiary' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
                  {tabContent[tab.key].data.length.toLocaleString()}
                </span>
              )}
            </button>
          ))}

          {/* 우측 툴바 */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2.5 py-1.5 border border-ds-outline-variant/10">
              <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
              <input
                placeholder="검색…"
                value={quickFilter}
                onChange={(e) => setQuickFilter(e.target.value)}
                className="text-[12px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/40 w-40"
              />
            </div>
            <span className="text-[11px] text-ds-on-surface-variant/60 whitespace-nowrap tabular-nums">{current.data.length.toLocaleString()}건</span>
            <button
              onClick={() => handleExport(current.data, current.filename)}
              disabled={current.data.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface disabled:opacity-40 transition-colors"
            >
              <Download className="w-3 h-3" />
              Excel
            </button>
          </div>
        </div>

        <div className="p-4">
          {current.isFetching ? (
            <div className="py-12 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
          ) : (
            <AgGridWrapper
              columnDefs={current.cols}
              rowData={current.data as unknown[]}
              getRowId={objectRowId}
              quickFilterText={quickFilter}
              height="calc(100vh - 240px)"
              noRowsText="사이드바에서 장비를 선택하세요."
              rowHeight={34}
            />
          )}
        </div>
      </div>

      {objectModal && (
        <ObjectDetailModal
          deviceId={objectModal.deviceId}
          name={objectModal.name}
          onClose={() => setObjectModal(null)}
        />
      )}
    </div>
  )
}
