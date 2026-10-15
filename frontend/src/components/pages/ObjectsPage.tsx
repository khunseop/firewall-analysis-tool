import { useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, Search, ArrowRight, AlertTriangle } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { Button } from '@/components/ui/button'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'
import { DeviceSelector } from '@/components/shared/DeviceSelector'
import { listDevices } from '@/api/devices'
import { useDeviceStore } from '@/store/deviceStore'
import {
  exportToExcel,
  getObjectUsageCounts,
  type NetworkObject, type NetworkGroup, type Service, type ServiceGroup,
} from '@/api/firewall'
import { queryKeys } from '@/api/queryKeys'
import { PageHeader } from '@/components/shared/PageHeader'
import { ObjectSearchBar } from './objects/ObjectSearchBar'
import { useObjectsData, type TabKey } from './objects/useObjectsData'

const objectRowId = (p: { data: unknown }) => String((p.data as Record<string, unknown>)['id'])

const TABS: { key: TabKey; label: string }[] = [
  { key: 'network_objects', label: '네트워크 객체' },
  { key: 'network_groups', label: '네트워크 그룹' },
  { key: 'services', label: '서비스' },
  { key: 'service_groups', label: '서비스 그룹' },
]

function SearchPolicyButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title="정책에서 검색"
      aria-label={`${name}을(를) 사용하는 정책 검색`}
      className="ml-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-11 font-semibold text-ds-tertiary hover:bg-ds-tertiary/10 transition-all"
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
  // 서버 범위 검색 — null이면 장비 전체 목록을 보여준다.
  const [searchExpr, setSearchExpr] = useState<string | null>(null)
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const queryClient = useQueryClient()
  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string; kind: 'address' | 'service' } | null>(null)
  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })
  const navigate = useNavigate()
  const objects = useObjectsData(deviceIds, activeTab, searchExpr)
  const rows = objects.data?.rows ?? []
  const failedDevices = objects.data?.failed ?? []

  const usageQuery = useQuery({
    queryKey: queryKeys.objectUsageCounts(deviceIds),
    queryFn: () => getObjectUsageCounts(deviceIds),
    enabled: deviceIds.length > 0,
    staleTime: 60_000,
  })
  // 사용 현황을 못 가져왔는데 0으로 취급하면 모든 객체가 "미사용"으로 보여 삭제 후보를 잘못 고르게 된다.
  const usageReady = usageQuery.isSuccess
  const usageCounts = useMemo(() => usageQuery.data ?? [], [usageQuery.data])

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
    setSearchExpr(null)
  }

  const deviceNameMap = useMemo(
    () => new Map(devices.map(d => [d.id, d.name])),
    [devices]
  )

  const handleExport = async (filename: string) => {
    // 화면에 보이는 결과(결과 내 필터·컬럼 필터 적용 후)를 그대로 내보낸다.
    const data: unknown[] = []
    gridRef.current?.gridApi?.forEachNodeAfterFilterAndSort((n) => { if (n.data) data.push(n.data) })
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
      <span className="text-11 font-semibold text-ds-tertiary font-mono">{p.value}</span>
    ),
  })

  const usageCol = <T extends { device_id: number; name: string }>(usageMap: Map<string, number>): ColDef<T> => ({
    headerName: '사용 정책',
    filter: 'agNumberColumnFilter',
    width: 112,
    sort: 'asc' as const,
    // 사용 현황을 아직 못 가져왔다면 null — 0("미사용")과 구분한다.
    valueGetter: (p) => usageReady ? (usageMap.get(`${(p.data as T)?.device_id}_${(p.data as T)?.name}`) ?? 0) : null,
    cellRenderer: (p: { value: number | null }) => {
      if (p.value == null) {
        return <span className="text-11 text-ds-on-surface-variant" title={usageQuery.isError ? '사용 정책 수를 불러오지 못했습니다.' : '사용 정책 수를 확인하는 중입니다.'}>{usageQuery.isError ? '확인 불가' : '…'}</span>
      }
      if (p.value === 0) {
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-11 font-bold bg-red-100 text-red-700">미사용</span>
      }
      return <span className="text-xs font-semibold tabular-nums text-ds-on-surface">{p.value}</span>
    },
  })

  const networkObjectCols: ColDef<NetworkObject>[] = [
    deviceNameCol<NetworkObject>() as ColDef<NetworkObject>,
    {
      field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 220,
      cellRenderer: (p: { value: string; data: NetworkObject }) => (
        <div className="group flex items-center gap-1">
          <button
            onClick={() => setObjectModal({ deviceId: p.data.device_id, name: p.value, kind: 'address' })}
            className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left truncate"
          >
            {p.value}
          </button>
          <SearchPolicyButton name={p.value} onClick={() => navigate(`/policies?obj_name=${encodeURIComponent(p.value)}`)} />
        </div>
      ),
    },
    usageCol<NetworkObject>(addrUsageMap) as ColDef<NetworkObject>,
    { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', width: 180, cellRenderer: (p: { value: string }) => <span className="font-mono text-xs text-ds-on-surface-variant">{p.value ?? '-'}</span> },
    { field: 'type', headerName: '타입', filter: 'agTextColumnFilter', width: 100, cellRenderer: (p: { value: string }) => <span className="inline-flex items-center px-2 py-0.5 rounded text-11 font-semibold bg-ds-surface-container text-ds-on-surface-variant uppercase">{p.value}</span> },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', flex: 1 },
  ]

  const networkGroupCols: ColDef<NetworkGroup>[] = [
    deviceNameCol<NetworkGroup>() as ColDef<NetworkGroup>,
    {
      field: 'name', headerName: '이름', filter: 'agTextColumnFilter', width: 220,
      cellRenderer: (p: { value: string; data: NetworkGroup }) => (
        <div className="group flex items-center gap-1">
          <button
            onClick={() => setObjectModal({ deviceId: p.data.device_id, name: p.value, kind: 'address' })}
            className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left truncate"
          >
            {p.value}
          </button>
          <SearchPolicyButton name={p.value} onClick={() => navigate(`/policies?obj_name=${encodeURIComponent(p.value)}`)} />
        </div>
      ),
    },
    usageCol<NetworkGroup>(addrUsageMap) as ColDef<NetworkGroup>,
    {
      field: 'members', headerName: '멤버', filter: 'agTextColumnFilter', flex: 1,
      cellRenderer: (p: { value: string }) => {
        const members = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean)
        if (members.length === 0) return <span className="text-11 text-ds-on-surface-variant">-</span>
        const MAX = 3
        const visible = members.slice(0, MAX)
        const extra = members.length - MAX
        return (
          <div className="flex items-center gap-1 overflow-hidden">
            {visible.map((m, i) => (
              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-11 font-mono bg-ds-secondary-container text-ds-tertiary whitespace-nowrap shrink-0">{m}</span>
            ))}
            {extra > 0 && <span className="text-11 font-semibold text-ds-on-surface-variant whitespace-nowrap shrink-0">+{extra}</span>}
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
            onClick={() => setObjectModal({ deviceId: p.data.device_id, name: p.value, kind: 'service' })}
            className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left truncate"
          >
            {p.value}
          </button>
          <SearchPolicyButton name={p.value} onClick={() => navigate(`/policies?svc_name=${encodeURIComponent(p.value)}`)} />
        </div>
      ),
    },
    usageCol<Service>(svcUsageMap) as ColDef<Service>,
    { field: 'protocol', headerName: '프로토콜', filter: 'agTextColumnFilter', width: 110, cellRenderer: (p: { value: string }) => <span className="inline-flex items-center px-2 py-0.5 rounded text-11 font-semibold bg-ds-surface-container text-ds-on-surface-variant uppercase">{p.value}</span> },
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
            onClick={() => setObjectModal({ deviceId: p.data.device_id, name: p.value, kind: 'service' })}
            className="font-mono text-xs font-semibold text-ds-tertiary hover:underline text-left truncate"
          >
            {p.value}
          </button>
          <SearchPolicyButton name={p.value} onClick={() => navigate(`/policies?svc_name=${encodeURIComponent(p.value)}`)} />
        </div>
      ),
    },
    usageCol<ServiceGroup>(svcUsageMap) as ColDef<ServiceGroup>,
    {
      field: 'members', headerName: '멤버', filter: 'agTextColumnFilter', flex: 1,
      cellRenderer: (p: { value: string }) => {
        const members = (p.value ?? '').split(',').map((m: string) => m.trim()).filter(Boolean)
        if (members.length === 0) return <span className="text-11 text-ds-on-surface-variant">-</span>
        const MAX = 3
        const visible = members.slice(0, MAX)
        const extra = members.length - MAX
        return (
          <div className="flex items-center gap-1 overflow-hidden">
            {visible.map((m, i) => (
              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-11 font-mono bg-ds-surface-container text-ds-on-surface-variant whitespace-nowrap shrink-0">{m}</span>
            ))}
            {extra > 0 && <span className="text-11 font-semibold text-ds-on-surface-variant whitespace-nowrap shrink-0">+{extra}</span>}
          </div>
        )
      },
    },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 200 },
  ]

  const colsByTab: Record<TabKey, { cols: ColDef<unknown>[]; filename: string; noun: string }> = {
    network_objects: { cols: networkObjectCols as ColDef<unknown>[], filename: '네트워크객체', noun: '네트워크 객체' },
    network_groups:  { cols: networkGroupCols as ColDef<unknown>[],  filename: '네트워크그룹', noun: '네트워크 그룹' },
    services:        { cols: serviceCols as ColDef<unknown>[],        filename: '서비스',       noun: '서비스' },
    service_groups:  { cols: serviceGroupCols as ColDef<unknown>[],  filename: '서비스그룹',   noun: '서비스 그룹' },
  }
  const current = colsByTab[activeTab]
  const hasDevices = deviceIds.length > 0

  // 다른 탭의 건수는 이미 조회해 둔 캐시에서만 읽는다(조회하지 않은 탭은 배지를 숨긴다).
  const cachedCount = (tab: TabKey) => {
    if (tab === activeTab) return searchExpr != null ? null : rows.length
    return queryClient.getQueryData<{ rows: unknown[] }>(queryKeys.objectsList(tab, deviceIds))?.rows.length ?? null
  }

  const noRowsText = !hasDevices
    ? '장비를 선택하면 객체가 표시됩니다. 오른쪽 위 "장비 선택"에서 장비를 고르세요.'
    : searchExpr != null
      ? `“${searchExpr}”에 해당하는 ${current.noun}가 없습니다. 입력한 값과 겹치는 항목이 없습니다.`
      : quickFilter
        ? '결과 내 필터에 맞는 항목이 없습니다. 필터를 지워 보세요.'
        : `선택한 장비에 수집된 ${current.noun}가 없습니다.`

  const retry = () => { void objects.refetch(); if (usageQuery.isError) void usageQuery.refetch() }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="객체" actions={<DeviceSelector />} />

      {/* Tabs + Grid */}
      <div className="card rounded-xl overflow-hidden">
        {/* Tab bar + toolbar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-ds-outline-variant/10" role="tablist" aria-label="객체 종류">
          {TABS.map((tab) => {
            const count = cachedCount(tab.key)
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`px-4 py-1.5 text-13 font-semibold tracking-tight transition-colors duration-150 border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'text-ds-tertiary border-ds-tertiary'
                    : 'text-ds-on-surface-variant border-transparent hover:text-ds-on-surface hover:border-ds-outline-variant/30'
                }`}
              >
                {tab.label}
                {count != null && count > 0 && (
                  <span className={`ml-1.5 text-11 px-1.5 py-0.5 rounded-full font-bold tabular-nums ${activeTab === tab.key ? 'bg-ds-tertiary/10 text-ds-tertiary' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
                    {count.toLocaleString()}
                  </span>
                )}
              </button>
            )
          })}

          {/* 우측 툴바 */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2.5 py-1.5 border border-ds-outline-variant/10">
              <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
              <input
                placeholder="결과 내 필터…"
                aria-label="결과 내 필터"
                value={quickFilter}
                onChange={(e) => setQuickFilter(e.target.value)}
                className="text-xs bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/70 w-40"
              />
            </div>
            {!objects.isError && (
              <span className="text-11 text-ds-on-surface-variant whitespace-nowrap tabular-nums">{rows.length.toLocaleString()}건</span>
            )}
            <button
              onClick={() => handleExport(current.filename)}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface disabled:opacity-40 transition-colors"
            >
              <Download className="w-3 h-3" />
              Excel
            </button>
          </div>
        </div>

        <ObjectSearchBar
          key={activeTab}
          tab={activeTab}
          applied={searchExpr}
          disabled={!hasDevices}
          searching={searchExpr != null && objects.isFetching}
          resultCount={searchExpr != null && objects.isSuccess ? rows.length : null}
          onSearch={setSearchExpr}
          onClear={() => setSearchExpr(null)}
        />

        {/* 조회 실패 — "결과 없음"으로 보이지 않도록 목록 대신 오류를 보여준다 */}
        {objects.isError && (
          <div role="alert" className="m-4 rounded-xl border border-ds-error/25 bg-ds-error/5 px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-ds-error shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-13 font-semibold text-ds-error">{current.noun} 목록을 불러오지 못했습니다</p>
              <p className="text-11 text-ds-on-surface-variant mt-0.5">{(objects.error as Error)?.message}</p>
            </div>
            <Button variant="subtle" size="auto" onClick={retry} disabled={objects.isFetching} className="px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0">
              다시 시도
            </Button>
          </div>
        )}

        {/* 일부 장비만 실패 — 나머지 장비의 결과는 표시하되, 빠진 장비를 알린다 */}
        {failedDevices.length > 0 && (
          <div role="alert" className="mx-4 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
            <p className="text-11 text-amber-900 flex-1 min-w-0">
              장비 {failedDevices.length}대의 {current.noun}를 불러오지 못해 나머지 장비의 결과만 표시 중입니다:{' '}
              <span className="font-mono font-semibold">{failedDevices.map((f) => deviceNameMap.get(f.deviceId) ?? `#${f.deviceId}`).join(', ')}</span>
            </p>
            <Button variant="subtle" size="auto" onClick={retry} disabled={objects.isFetching} className="px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0">
              다시 시도
            </Button>
          </div>
        )}

        {usageQuery.isError && (
          <div role="alert" className="mx-4 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
            <p className="text-11 text-amber-900 flex-1">
              사용 정책 수를 불러오지 못해 "사용 정책" 컬럼을 "확인 불가"로 표시합니다. 이 상태에서는 미사용 여부를 판단할 수 없습니다.
            </p>
            <Button variant="subtle" size="auto" onClick={() => { void usageQuery.refetch() }} disabled={usageQuery.isFetching} className="px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0">
              다시 시도
            </Button>
          </div>
        )}

        {!objects.isError && (
          <div className="p-4">
            <AgGridWrapper
              ref={gridRef}
              columnDefs={current.cols}
              rowData={rows}
              getRowId={objectRowId}
              quickFilterText={quickFilter}
              height="calc(100vh - 300px)"
              loading={objects.isFetching}
              loadingLabel={searchExpr != null ? '객체 검색 중…' : '객체 불러오는 중…'}
              noRowsText={noRowsText}
              rowHeight={34}
            />
          </div>
        )}
      </div>

      {objectModal && (
        <ObjectDetailModal
          deviceId={objectModal.deviceId}
          name={objectModal.name}
          objectType={objectModal.kind}
          onClose={() => setObjectModal(null)}
        />
      )}
    </div>
  )
}
