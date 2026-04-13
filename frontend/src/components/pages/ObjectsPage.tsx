import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Search } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'
import { listDevices } from '@/api/devices'
import { useDeviceStore } from '@/store/deviceStore'
import {
  getNetworkObjects, getNetworkGroups, getServices, getServiceGroups, exportToExcel,
  type NetworkObject, type NetworkGroup, type Service, type ServiceGroup,
} from '@/api/firewall'

const NETWORK_OBJECT_COLS: ColDef<NetworkObject>[] = [
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 200, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs font-semibold text-ds-on-surface">{p.value}</span> },
  { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', width: 180, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs text-ds-on-surface-variant">{p.value ?? '-'}</span> },
  { field: 'type', headerName: '타입', filter: 'agTextColumnFilter', width: 100, cellRenderer: (p: { value: string }) => <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-ds-surface-container text-ds-on-surface-variant uppercase">{p.value}</span> },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', flex: 1 },
]

const NETWORK_GROUP_COLS: ColDef<NetworkGroup>[] = [
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 200, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs font-semibold text-ds-on-surface">{p.value}</span> },
  {
    field: 'members', headerName: '멤버', filter: 'agTextColumnFilter', flex: 1, autoHeight: true,
    cellRenderer: (p: { value: string }) => {
      const members = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean)
      return (
        <div className="flex flex-wrap gap-1 py-1">
          {members.map((m, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-ds-secondary-container text-ds-tertiary">{m}</span>
          ))}
        </div>
      )
    },
  },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 200 },
]

const SERVICE_COLS: ColDef<Service>[] = [
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 200, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs font-semibold text-ds-on-surface">{p.value}</span> },
  { field: 'protocol', headerName: '프로토콜', filter: 'agTextColumnFilter', width: 110, cellRenderer: (p: { value: string }) => <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-ds-surface-container text-ds-on-surface-variant uppercase">{p.value}</span> },
  { field: 'port', headerName: '포트', filter: 'agTextColumnFilter', width: 140, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs text-ds-on-surface-variant">{p.value ?? '-'}</span> },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', flex: 1 },
]

const SERVICE_GROUP_COLS: ColDef<ServiceGroup>[] = [
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 200, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs font-semibold text-ds-on-surface">{p.value}</span> },
  {
    field: 'members', headerName: '멤버', filter: 'agTextColumnFilter', flex: 1, autoHeight: true,
    cellRenderer: (p: { value: string }) => {
      const members = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean)
      return (
        <div className="flex flex-wrap gap-1 py-1">
          {members.map((m, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-ds-surface-container text-ds-on-surface-variant">{m}</span>
          ))}
        </div>
      )
    },
  },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 200 },
]

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
    queryKey: ['network-objects', ...deviceIds],
    queryFn: async () => (await Promise.all(deviceIds.map((id) => getNetworkObjects(id)))).flat(),
    enabled: enabled && tab === 'network_objects', staleTime: 30_000,
  })
  const networkGroups = useQuery({
    queryKey: ['network-groups', ...deviceIds],
    queryFn: async () => (await Promise.all(deviceIds.map((id) => getNetworkGroups(id)))).flat(),
    enabled: enabled && tab === 'network_groups', staleTime: 30_000,
  })
  const services = useQuery({
    queryKey: ['services', ...deviceIds],
    queryFn: async () => (await Promise.all(deviceIds.map((id) => getServices(id)))).flat(),
    enabled: enabled && tab === 'services', staleTime: 30_000,
  })
  const serviceGroups = useQuery({
    queryKey: ['service-groups', ...deviceIds],
    queryFn: async () => (await Promise.all(deviceIds.map((id) => getServiceGroups(id)))).flat(),
    enabled: enabled && tab === 'service_groups', staleTime: 30_000,
  })
  return { networkObjects, networkGroups, services, serviceGroups }
}

function TabGrid<T>({ columnDefs, rowData, isLoading, onExport }: {
  columnDefs: ColDef<T>[]
  rowData: T[]
  isLoading: boolean
  onExport: () => void
}) {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [quickFilter, setQuickFilter] = useState('')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 bg-ds-surface-container-low rounded-md px-3 py-1.5 border border-ds-outline-variant/20">
          <Search className="w-3.5 h-3.5 text-ds-outline shrink-0" />
          <input
            placeholder="빠른 검색…"
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value)}
            className="flex-1 bg-transparent text-sm focus:outline-none text-ds-on-surface placeholder:text-ds-outline/50"
          />
        </div>
        <span className="text-xs text-ds-on-surface-variant whitespace-nowrap">{rowData.length.toLocaleString()}건</span>
        <button
          onClick={onExport}
          disabled={rowData.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ds-on-surface-variant bg-ds-surface-container-low rounded-md hover:text-ds-on-surface disabled:opacity-40 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Excel
        </button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
      ) : (
        <AgGridWrapper<T>
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={rowData}
          getRowId={(p) => String((p.data as Record<string, unknown>)['id'])}
          quickFilterText={quickFilter}
          height="calc(100vh - 280px)"
          noRowsText="장비를 선택하세요."
        />
      )}
    </div>
  )
}

export function ObjectsPage() {
  const { selectedIds: deviceIds, setSelectedIds: setDeviceIds } = useDeviceStore()
  const [activeTab, setActiveTab] = useState<TabKey>('network_objects')
  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const { networkObjects, networkGroups, services, serviceGroups } = useObjectsData(deviceIds, activeTab)

  const handleExport = async (data: unknown[], filename: string) => {
    if (data.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try { await exportToExcel(data as Record<string, unknown>[], filename) }
    catch (e: unknown) { toast.error((e as Error).message) }
  }

  const openModal = (name: string) => {
    if (deviceIds.length > 0) setObjectModal({ deviceId: deviceIds[0], name })
  }

  // Inject click handler into name column for network_objects/groups
  const networkObjectColsWithClick: ColDef<NetworkObject>[] = NETWORK_OBJECT_COLS.map((c) =>
    c.field === 'name'
      ? { ...c, cellRenderer: (p: { value: string }) => (
          <button onClick={() => openModal(p.value)} className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left w-full truncate">
            {p.value}
          </button>
        )}
      : c
  )

  const tabContent: Record<TabKey, { data: unknown[]; isFetching: boolean; cols: ColDef<unknown>[]; filename: string }> = {
    network_objects: { data: networkObjects.data ?? [], isFetching: networkObjects.isFetching, cols: networkObjectColsWithClick as ColDef<unknown>[], filename: '네트워크객체' },
    network_groups:  { data: networkGroups.data ?? [],  isFetching: networkGroups.isFetching,  cols: NETWORK_GROUP_COLS as ColDef<unknown>[],  filename: '네트워크그룹' },
    services:        { data: services.data ?? [],        isFetching: services.isFetching,        cols: SERVICE_COLS as ColDef<unknown>[],        filename: '서비스' },
    service_groups:  { data: serviceGroups.data ?? [],   isFetching: serviceGroups.isFetching,   cols: SERVICE_GROUP_COLS as ColDef<unknown>[],  filename: '서비스그룹' },
  }

  const current = tabContent[activeTab]

  return (
    <div className="space-y-4">
      {/* Page header */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ds-on-surface font-headline">오브젝트</h1>
          <p className="text-ds-on-surface-variant text-xs mt-0.5">네트워크 객체, 그룹, 서비스를 확인합니다.</p>
        </div>
        <div className="w-72 shrink-0">
          <div className="bg-white rounded-md border border-ds-outline-variant/30">
            <DeviceSelect devices={devices} value={deviceIds} onChange={setDeviceIds} isMulti placeholder="장비 선택…" />
          </div>
        </div>
      </header>

      {/* Tabs + Grid */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-ds-outline-variant/10 px-4 pt-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-semibold tracking-tight transition-colors duration-150 border-b-2 -mb-px rounded-t ${
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
        </div>

        <div className="p-4">
          <TabGrid
            columnDefs={current.cols}
            rowData={current.data as unknown[]}
            isLoading={current.isFetching}
            onExport={() => handleExport(current.data, current.filename)}
          />
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
