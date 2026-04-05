import { useState, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Download, X, SlidersHorizontal } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { listDevices } from '@/api/devices'
import { searchPolicies, getObjectDetails, exportToExcel, type Policy, type PolicySearchRequest } from '@/api/firewall'
import { formatDate } from '@/lib/utils'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'

// suppress unused import warning
void getObjectDetails

interface SearchParams {
  device_ids: number[]; rule_name: string; action: string; enable: string
  src_ip: string; dst_ip: string; protocol: string; port: string
  user: string; application: string; description: string
}

const DEFAULT_PARAMS: SearchParams = {
  device_ids: [], rule_name: '', action: '', enable: '', src_ip: '', dst_ip: '',
  protocol: '', port: '', user: '', application: '', description: '',
}

const ACTION_BADGE: Record<string, string> = {
  allow: 'bg-green-100 text-green-700',
  deny:  'bg-red-100 text-red-700',
  drop:  'bg-red-100 text-red-700',
}

export function PoliciesPage() {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [params, setParams] = useState<SearchParams>(DEFAULT_PARAMS)
  const [draft, setDraft] = useState<SearchParams>(DEFAULT_PARAMS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [validObjectNames, setValidObjectNames] = useState<Set<string>>(new Set())
  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  const searchMutation = useMutation({
    mutationFn: (req: PolicySearchRequest) => searchPolicies(req),
    onSuccess: (data) => {
      setPolicies(data.policies)
      setValidObjectNames(new Set(data.valid_object_names))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSearch = () => {
    setParams(draft)
    searchMutation.mutate({
      device_ids: draft.device_ids,
      rule_name: draft.rule_name || undefined,
      action: draft.action || undefined,
      enable: draft.enable === '' ? undefined : draft.enable === 'true',
      src_ip: draft.src_ip || undefined,
      dst_ip: draft.dst_ip || undefined,
      protocol: draft.protocol || undefined,
      port: draft.port || undefined,
      user: draft.user || undefined,
      application: draft.application || undefined,
      description: draft.description || undefined,
    })
  }

  const handleExport = async () => {
    if (policies.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try { await exportToExcel(policies as unknown as Record<string, unknown>[], '방화벽정책') }
    catch (e: unknown) { toast.error((e as Error).message) }
  }

  const set = (key: keyof SearchParams, val: string | number[]) =>
    setDraft((prev) => ({ ...prev, [key]: val }))

  const makeCellRenderer = (_field: string) => (p: { value: string; data: Policy }) => {
    const names = (p.value ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', height: '100%' }}>
        {names.map((name, i) => (
          <span key={i}>
            {validObjectNames.has(name) ? (
              <span
                style={{ color: '#005bc4', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}
                onClick={() => setObjectModal({ deviceId: p.data.device_id, name })}
              >
                {name}
              </span>
            ) : <span style={{ fontSize: 12 }}>{name}</span>}
            {i < names.length - 1 && ', '}
          </span>
        ))}
      </div>
    )
  }

  const columnDefs: ColDef<Policy>[] = [
    { field: 'rule_name', headerName: '정책명', filter: 'agTextColumnFilter', width: 160 },
    { field: 'seq', headerName: '순번', filter: 'agNumberColumnFilter', width: 70 },
    {
      field: 'action', headerName: '액션', filter: 'agTextColumnFilter', width: 90,
      cellRenderer: (p: { value: string }) => {
        const classes = ACTION_BADGE[p.value?.toLowerCase()] ?? 'bg-ds-surface-container text-ds-on-surface-variant'
        return (
          <div className="flex items-center h-full">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${classes}`}>
              {p.value}
            </span>
          </div>
        )
      },
    },
    { field: 'enable', headerName: '활성', width: 70, cellRenderer: (p: { value: boolean }) => (
      <div className="flex items-center h-full">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${p.value ? 'bg-green-100 text-green-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
          {p.value ? '활성' : '비활성'}
        </span>
      </div>
    )},
    { field: 'source', headerName: '출발지', filter: 'agTextColumnFilter', width: 180, cellRenderer: makeCellRenderer('source') },
    { field: 'destination', headerName: '목적지', filter: 'agTextColumnFilter', width: 180, cellRenderer: makeCellRenderer('destination') },
    { field: 'service', headerName: '서비스', filter: 'agTextColumnFilter', width: 150, cellRenderer: makeCellRenderer('service') },
    { field: 'user', headerName: '사용자', filter: 'agTextColumnFilter', width: 120 },
    { field: 'application', headerName: '애플리케이션', filter: 'agTextColumnFilter', width: 140 },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 150 },
    { field: 'last_hit_date', headerName: '마지막 사용일', filter: 'agTextColumnFilter', width: 150, valueFormatter: (p) => formatDate(p.value) },
    { field: 'vsys', headerName: 'VSYS', filter: 'agTextColumnFilter', width: 80 },
  ]

  const hasActiveFilters = params.device_ids.length > 0

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ds-on-surface font-headline">방화벽 정책</h1>
        <p className="text-ds-on-surface-variant text-sm mt-1">정책을 검색하고 필터링합니다. 총 {policies.length.toLocaleString()}건</p>
      </div>

      {/* Search panel */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        {/* Search bar row */}
        <div className="relative flex items-center px-5 py-4 border-b border-ds-outline-variant/10">
          <Search className="w-5 h-5 text-ds-outline mr-3 shrink-0" />
          <div className="flex-1">
            <DeviceSelect
              devices={devices}
              value={draft.device_ids}
              onChange={(ids) => set('device_ids', ids)}
              isMulti
              placeholder="장비를 선택하세요…"
            />
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-lg transition-colors ${filtersOpen ? 'text-ds-tertiary bg-ds-secondary-container' : 'text-ds-tertiary bg-ds-tertiary/5 hover:bg-ds-tertiary/10'}`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              고급 필터
            </button>
          </div>
        </div>

        {/* Advanced filter panel */}
        {filtersOpen && (
          <div className="bg-ds-surface-container-low/40 p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5 border-b border-ds-outline-variant/10">
            {[
              { label: '정책명', key: 'rule_name' as const, placeholder: '부분 일치' },
              { label: '출발지 IP', key: 'src_ip' as const, placeholder: '예: 192.168.1.0/24' },
              { label: '목적지 IP', key: 'dst_ip' as const, placeholder: '예: 10.0.0.0/8' },
              { label: '프로토콜', key: 'protocol' as const, placeholder: 'tcp, udp' },
              { label: '포트', key: 'port' as const, placeholder: '예: 80, 443' },
              { label: '사용자', key: 'user' as const, placeholder: '' },
              { label: '애플리케이션', key: 'application' as const, placeholder: '' },
              { label: '설명', key: 'description' as const, placeholder: '' },
            ].map(({ label, key, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-ds-primary/70 tracking-wider">{label}</label>
                <input
                  value={draft[key] as string}
                  onChange={(e) => set(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full bg-ds-surface-container-lowest border border-ds-outline-variant/30 rounded-md text-sm px-3 py-2 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-ds-primary/70 tracking-wider">액션</label>
              <ShadSelect value={draft.action} onValueChange={(v) => set('action', v)}>
                <SelectTrigger className="bg-ds-surface-container-lowest border-ds-outline-variant/30 text-sm h-9">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">전체</SelectItem>
                  <SelectItem value="allow">allow</SelectItem>
                  <SelectItem value="deny">deny</SelectItem>
                  <SelectItem value="drop">drop</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-ds-primary/70 tracking-wider">활성 여부</label>
              <ShadSelect value={draft.enable} onValueChange={(v) => set('enable', v)}>
                <SelectTrigger className="bg-ds-surface-container-lowest border-ds-outline-variant/30 text-sm h-9">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">전체</SelectItem>
                  <SelectItem value="true">활성</SelectItem>
                  <SelectItem value="false">비활성</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center justify-between px-5 py-3 bg-ds-surface-container-low/20 border-t border-ds-outline-variant/10">
          <div className="flex items-center gap-2 flex-wrap">
            {hasActiveFilters && (
              <>
                <span className="text-xs text-ds-on-surface-variant">적용 필터:</span>
                {params.device_ids.length > 0 && (
                  <span className="text-[11px] bg-ds-secondary-container text-ds-on-secondary-container rounded px-2 py-0.5 font-medium">
                    장비 {params.device_ids.length}개
                  </span>
                )}
                {params.rule_name && <span className="text-[11px] bg-ds-secondary-container text-ds-on-secondary-container rounded px-2 py-0.5 font-medium">정책명: {params.rule_name}</span>}
                {params.action && <span className="text-[11px] bg-ds-secondary-container text-ds-on-secondary-container rounded px-2 py-0.5 font-medium">액션: {params.action}</span>}
                {params.src_ip && <span className="text-[11px] bg-ds-secondary-container text-ds-on-secondary-container rounded px-2 py-0.5 font-medium">출발지: {params.src_ip}</span>}
                {params.dst_ip && <span className="text-[11px] bg-ds-secondary-container text-ds-on-secondary-container rounded px-2 py-0.5 font-medium">목적지: {params.dst_ip}</span>}
                <button onClick={() => { setParams(DEFAULT_PARAMS); setDraft(DEFAULT_PARAMS); setPolicies([]) }} className="p-1 text-ds-on-surface-variant hover:text-ds-error transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {policies.length > 0 && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-ds-on-surface ghost-border bg-ds-surface-container-lowest rounded-md hover:bg-ds-surface-container-low transition-colors"
              >
                <Download className="w-4 h-4" />
                Excel
              </button>
            )}
            <button
              onClick={handleSearch}
              disabled={draft.device_ids.length === 0 || searchMutation.isPending}
              className="flex items-center gap-2 px-5 py-1.5 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50 transition-all"
            >
              <Search className="w-4 h-4" />
              {searchMutation.isPending ? '검색 중…' : '검색'}
            </button>
          </div>
        </div>
      </div>

      {/* Results grid */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        <AgGridWrapper<Policy>
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={policies}
          getRowId={(p) => String(p.data.id)}
          height="calc(100vh - 380px)"
          noRowsText="장비를 선택하고 검색 버튼을 클릭하세요."
        />
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
