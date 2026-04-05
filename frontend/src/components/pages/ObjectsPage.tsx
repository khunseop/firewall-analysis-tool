import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
    field: 'members',
    headerName: '멤버',
    filter: 'agTextColumnFilter',
    flex: 1,
    cellRenderer: (p: { value: string }) => {
      const div = document.createElement('div')
      div.style.whiteSpace = 'normal'
      div.style.lineHeight = '1.4'
      div.style.padding = '4px 0'
      div.innerHTML = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean).join('<br>')
      return div
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
    field: 'members',
    headerName: '멤버',
    filter: 'agTextColumnFilter',
    flex: 1,
    cellRenderer: (p: { value: string }) => {
      const div = document.createElement('div')
      div.style.whiteSpace = 'normal'
      div.style.lineHeight = '1.4'
      div.style.padding = '4px 0'
      div.innerHTML = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean).join('<br>')
      return div
    },
  },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 180 },
]

type TabKey = 'network_objects' | 'network_groups' | 'services' | 'service_groups'

function useObjectsData(deviceIds: number[], tab: TabKey) {
  const enabled = deviceIds.length > 0

  const networkObjects = useQuery({
    queryKey: ['network-objects', ...deviceIds],
    queryFn: async () => {
      const all = await Promise.all(deviceIds.map((id) => getNetworkObjects(id)))
      return all.flat()
    },
    enabled: enabled && tab === 'network_objects',
    staleTime: 30_000,
  })

  const networkGroups = useQuery({
    queryKey: ['network-groups', ...deviceIds],
    queryFn: async () => {
      const all = await Promise.all(deviceIds.map((id) => getNetworkGroups(id)))
      return all.flat()
    },
    enabled: enabled && tab === 'network_groups',
    staleTime: 30_000,
  })

  const services = useQuery({
    queryKey: ['services', ...deviceIds],
    queryFn: async () => {
      const all = await Promise.all(deviceIds.map((id) => getServices(id)))
      return all.flat()
    },
    enabled: enabled && tab === 'services',
    staleTime: 30_000,
  })

  const serviceGroups = useQuery({
    queryKey: ['service-groups', ...deviceIds],
    queryFn: async () => {
      const all = await Promise.all(deviceIds.map((id) => getServiceGroups(id)))
      return all.flat()
    },
    enabled: enabled && tab === 'service_groups',
    staleTime: 30_000,
  })

  return { networkObjects, networkGroups, services, serviceGroups }
}

function TabGrid<T>({
  columnDefs,
  rowData,
  isLoading,
  gridId,
  onExport,
}: {
  columnDefs: ColDef<T>[]
  rowData: T[]
  isLoading: boolean
  gridId: string
  onExport: () => void
}) {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [quickFilter, setQuickFilter] = useState('')

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          placeholder="빠른 검색..."
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value)}
          className="h-8 w-48 text-sm"
        />
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onExport} disabled={rowData.length === 0}>
          <Download className="h-3 w-3" /> Excel
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{rowData.length.toLocaleString()}건</span>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">로딩 중...</div>
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">오브젝트 조회</CardTitle>
        <div className="mt-2">
          <DeviceSelect devices={devices} value={deviceIds} onChange={setDeviceIds} isMulti placeholder="장비를 선택하세요..." />
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <TabsList className="mb-3">
            <TabsTrigger value="network_objects">네트워크 객체</TabsTrigger>
            <TabsTrigger value="network_groups">네트워크 그룹</TabsTrigger>
            <TabsTrigger value="services">서비스</TabsTrigger>
            <TabsTrigger value="service_groups">서비스 그룹</TabsTrigger>
          </TabsList>

          <TabsContent value="network_objects">
            <TabGrid
              columnDefs={NETWORK_OBJECT_COLS}
              rowData={networkObjects.data ?? []}
              isLoading={networkObjects.isFetching}
              gridId="network-objects"
              onExport={() => handleExport(networkObjects.data ?? [], '네트워크객체')}
            />
          </TabsContent>
          <TabsContent value="network_groups">
            <TabGrid
              columnDefs={NETWORK_GROUP_COLS}
              rowData={networkGroups.data ?? []}
              isLoading={networkGroups.isFetching}
              gridId="network-groups"
              onExport={() => handleExport(networkGroups.data ?? [], '네트워크그룹')}
            />
          </TabsContent>
          <TabsContent value="services">
            <TabGrid
              columnDefs={SERVICE_COLS}
              rowData={services.data ?? []}
              isLoading={services.isFetching}
              gridId="services"
              onExport={() => handleExport(services.data ?? [], '서비스')}
            />
          </TabsContent>
          <TabsContent value="service_groups">
            <TabGrid
              columnDefs={SERVICE_GROUP_COLS}
              rowData={serviceGroups.data ?? []}
              isLoading={serviceGroups.isFetching}
              gridId="service-groups"
              onExport={() => handleExport(serviceGroups.data ?? [], '서비스그룹')}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
