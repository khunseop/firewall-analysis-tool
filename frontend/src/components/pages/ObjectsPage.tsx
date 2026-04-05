import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { listDevices } from '@/api/devices'
import {
  getNetworkObjects, getNetworkGroups, getServices, getServiceGroups, exportToExcel,
  type NetworkObject, type NetworkGroup, type Service, type ServiceGroup,
} from '@/api/firewall'

const NETWORK_OBJECT_COLS: ColDef<NetworkObject>[] = [
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 180 },
  { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', width: 150 },
  { field: 'type', headerName: '타입', filter: 'agTextColumnFilter', width: 100 },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 180 },
]

const NETWORK_GROUP_COLS: ColDef<NetworkGroup>[] = [
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 180 },
  {
    field: 'members', headerName: '멤버', filter: 'agTextColumnFilter', flex: 1, autoHeight: true,
    cellRenderer: (p: { value: string }) => {
      const members = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean)
      return (
        <div style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '4px 0', fontSize: 12 }}>
          {members.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )
    },
  },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 180 },
]

const SERVICE_COLS: ColDef<Service>[] = [
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 180 },
  { field: 'protocol', headerName: '프로토콜', filter: 'agTextColumnFilter', width: 100 },
  { field: 'port', headerName: '포트', filter: 'agTextColumnFilter', width: 120 },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 200 },
]

const SERVICE_GROUP_COLS: ColDef<ServiceGroup>[] = [
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 180 },
  {
    field: 'members', headerName: '멤버', filter: 'agTextColumnFilter', flex: 1, autoHeight: true,
    cellRenderer: (p: { value: string }) => {
      const members = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean)
      return (
        <div style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '4px 0', fontSize: 12 }}>
          {members.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )
    },
  },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 180 },
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
  columnDefs: ColDef<T>[]; rowData: T[]; isLoading: boolean; onExport: () => void
}) {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [quickFilter, setQuickFilter] = useState('')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <input
          placeholder="빠른 검색…"
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value)}
          className="h-8 w-48 text-sm px-3 bg-ds-surface-container-low rounded-md border border-ds-outline-variant/30 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-ds-on-surface-variant">{rowData.length.toLocaleString()}건</span>
          <button
            onClick={onExport}
            disabled={rowData.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-ds-on-surface ghost-border bg-ds-surface-container-lowest rounded-md hover:bg-ds-surface-container-low disabled:opacity-40 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
        </div>
      </div>
      {isLoading ? (
        <div className="py-10 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
      ) : (
        <AgGridWrapper<T>
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={rowData}
          getRowId={(p) => String((p.data as Record<string, unknown>)['id'])}
          quickFilterText={quickFilter}
          height={400}
          noRowsText="장비를 선택하세요."
        />
      )}
    </div>
  )
}

export function ObjectsPage() {
  const [deviceIds, setDeviceIds] = useState<number[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('network_objects')
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const { networkObjects, networkGroups, services, serviceGroups } = useObjectsData(deviceIds, activeTab)

  const handleExport = async (data: unknown[], filename: string) => {
    if (data.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try { await exportToExcel(data as Record<string, unknown>[], filename) }
    catch (e: unknown) { toast.error((e as Error).message) }
  }

  const tabContent: Record<TabKey, { data: unknown[]; isFetching: boolean; cols: ColDef<unknown>[]; filename: string }> = {
    network_objects: { data: networkObjects.data ?? [], isFetching: networkObjects.isFetching, cols: NETWORK_OBJECT_COLS as ColDef<unknown>[], filename: '네트워크객체' },
    network_groups:  { data: networkGroups.data ?? [],  isFetching: networkGroups.isFetching,  cols: NETWORK_GROUP_COLS as ColDef<unknown>[],  filename: '네트워크그룹' },
    services:        { data: services.data ?? [],        isFetching: services.isFetching,        cols: SERVICE_COLS as ColDef<unknown>[],        filename: '서비스' },
    service_groups:  { data: serviceGroups.data ?? [],   isFetching: serviceGroups.isFetching,   cols: SERVICE_GROUP_COLS as ColDef<unknown>[],  filename: '서비스그룹' },
  }

  const current = tabContent[activeTab]

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ds-on-surface font-headline">오브젝트 조회</h1>
        <p className="text-ds-on-surface-variant text-sm mt-1">네트워크 객체, 그룹, 서비스를 확인합니다.</p>
      </div>

      {/* Device selector */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border p-5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary block mb-2">장비 선택</label>
        <DeviceSelect devices={devices} value={deviceIds} onChange={setDeviceIds} isMulti placeholder="장비를 선택하세요…" />
      </div>

      {/* Tabs + Grid */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center border-b border-ds-outline-variant/10 px-4 pt-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-semibold font-headline tracking-tight transition-colors duration-200 border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'text-ds-tertiary border-ds-tertiary'
                  : 'text-ds-on-surface-variant border-transparent hover:text-ds-on-surface hover:border-ds-outline-variant/30'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          <TabGrid
            columnDefs={current.cols}
            rowData={current.data as unknown[]}
            isLoading={current.isFetching}
            onExport={() => handleExport(current.data, current.filename)}
          />
        </div>
      </div>
    </div>
  )
}
