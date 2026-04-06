import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Download, SlidersHorizontal, AlertTriangle } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { listDevices } from '@/api/devices'
import { searchPolicies, exportToExcel, type Policy, type PolicySearchRequest } from '@/api/firewall'
import { daysSinceHit } from '@/lib/utils'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'

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

/** 쉼표/공백 구분 문자열 → chip 태그 렌더러 */
function TagCell({
  value, isClickable, onClickName, maxVisible = 3,
}: {
  value: string
  isClickable?: (name: string) => boolean
  onClickName?: (name: string) => void
  maxVisible?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const names = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (names.length === 0) return <span className="text-[11px] text-ds-on-surface-variant">-</span>

  const visible = expanded ? names : names.slice(0, maxVisible)
  const overflow = names.length - maxVisible

  return (
    <div className="flex flex-wrap gap-1 items-center py-1">
      {visible.map((name, i) => {
        const clickable = isClickable?.(name) && onClickName
        return (
          <span
            key={i}
            onClick={clickable ? () => onClickName!(name) : undefined}
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono leading-tight
              ${clickable
                ? 'bg-ds-secondary-container text-ds-tertiary cursor-pointer hover:bg-ds-primary-container transition-colors'
                : 'bg-ds-surface-container text-ds-on-surface'
              }`}
          >
            {name}
          </span>
        )
      })}
      {!expanded && overflow > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[10px] font-semibold text-ds-tertiary bg-ds-tertiary/5 rounded px-1.5 py-0.5 hover:bg-ds-tertiary/10"
        >
          +{overflow}
        </button>
      )}
    </div>
  )
}

/** 마지막 사용일 스마트 렌더 */
function LastHitCell({ value }: { value: string | null }) {
  if (!value) {
    return <span className="text-[11px] font-medium text-amber-600">사용 기록 없음</span>
  }
  const days = daysSinceHit(value)
  if (days === null) return <span className="text-[11px] text-ds-on-surface-variant">-</span>

  if (days >= 90) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ds-error">
        <AlertTriangle className="w-3 h-3" />
        {days}일 미사용
      </span>
    )
  }
  if (days >= 30) {
    return <span className="text-[11px] font-medium text-amber-600">{days}일 전</span>
  }
  return <span className="text-[11px] text-ds-on-surface-variant">{days}일 전</span>
}

export function PoliciesPage() {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [draft, setDraft] = useState<SearchParams>(DEFAULT_PARAMS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [searched, setSearched] = useState(false)
  const [validObjectNames, setValidObjectNames] = useState<Set<string>>(new Set())
  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  const searchMutation = useMutation({
    mutationFn: (req: PolicySearchRequest) => searchPolicies(req),
    onSuccess: (data) => {
      setPolicies(data.policies)
      setValidObjectNames(new Set(data.valid_object_names))
      setSearched(true)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSearch = () => {
    if (draft.device_ids.length === 0) { toast.warning('장비를 선택하세요.'); return }
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

  const handleReset = () => {
    setDraft(DEFAULT_PARAMS)
    setPolicies([])
    setSearched(false)
    setValidObjectNames(new Set())
  }

  const handleExport = async () => {
    if (policies.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try { await exportToExcel(policies as unknown as Record<string, unknown>[], '방화벽정책') }
    catch (e: unknown) { toast.error((e as Error).message) }
  }

  const set = (key: keyof SearchParams, val: string | number[]) =>
    setDraft((prev) => ({ ...prev, [key]: val }))

  // 검색 결과 요약 통계
  const summary = useMemo(() => {
    if (!searched || policies.length === 0) return null
    const allow = policies.filter(p => p.action?.toLowerCase() === 'allow').length
    const deny = policies.filter(p => ['deny', 'drop'].includes(p.action?.toLowerCase() ?? '')).length
    const disabled = policies.filter(p => !p.enable).length
    const stale = policies.filter(p => daysSinceHit(p.last_hit_date) !== null && daysSinceHit(p.last_hit_date)! >= 90).length
    const noHit = policies.filter(p => !p.last_hit_date).length
    return { total: policies.length, allow, deny, disabled, stale, noHit }
  }, [policies, searched])

  const makeCellRenderer = () => (p: { value: string; data: Policy }) => (
    <TagCell
      value={p.value}
      isClickable={(name) => validObjectNames.has(name)}
      onClickName={(name) => setObjectModal({ deviceId: p.data.device_id, name })}
    />
  )

  const columnDefs: ColDef<Policy>[] = [
    {
      field: 'rule_name', headerName: '정책명', filter: 'agTextColumnFilter', width: 200,
      cellRenderer: (p: { value: string }) => (
        <span className="font-mono text-xs font-semibold text-ds-on-surface">{p.value ?? '-'}</span>
      ),
    },
    {
      field: 'seq', headerName: '#', filter: 'agNumberColumnFilter', width: 60,
      cellRenderer: (p: { value: number }) => (
        <span className="font-mono text-xs text-ds-on-surface-variant">{p.value}</span>
      ),
    },
    {
      field: 'action', headerName: '액션', filter: 'agTextColumnFilter', width: 80,
      cellRenderer: (p: { value: string }) => {
        const classes = ACTION_BADGE[p.value?.toLowerCase()] ?? 'bg-ds-surface-container text-ds-on-surface-variant'
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${classes}`}>
            {p.value}
          </span>
        )
      },
    },
    {
      field: 'enable', headerName: '활성', width: 70,
      cellRenderer: (p: { value: boolean }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${p.value ? 'bg-green-100 text-green-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
          {p.value ? '활성' : '비활성'}
        </span>
      ),
    },
    { field: 'source', headerName: '출발지', filter: 'agTextColumnFilter', flex: 1, minWidth: 160, autoHeight: true, cellRenderer: makeCellRenderer() },
    { field: 'destination', headerName: '목적지', filter: 'agTextColumnFilter', flex: 1, minWidth: 160, autoHeight: true, cellRenderer: makeCellRenderer() },
    { field: 'service', headerName: '서비스', filter: 'agTextColumnFilter', width: 160, autoHeight: true, cellRenderer: makeCellRenderer() },
    { field: 'user', headerName: '사용자', filter: 'agTextColumnFilter', width: 120 },
    { field: 'application', headerName: '애플리케이션', filter: 'agTextColumnFilter', width: 140 },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 150 },
    {
      field: 'last_hit_date', headerName: '마지막 사용일', filter: 'agTextColumnFilter', width: 140,
      cellRenderer: (p: { value: string | null }) => <LastHitCell value={p.value} />,
    },
    { field: 'vsys', headerName: 'VSYS', filter: 'agTextColumnFilter', width: 80 },
  ]

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ds-on-surface font-headline">방화벽 정책</h1>
          <p className="text-ds-on-surface-variant text-xs mt-0.5">정책을 검색하고 필터링합니다.</p>
        </div>
        <div className="w-72 shrink-0">
          <div className="bg-white rounded-md border border-ds-outline-variant/30">
            <DeviceSelect
              devices={devices}
              value={draft.device_ids}
              onChange={(ids) => set('device_ids', ids)}
              isMulti
              placeholder="장비 선택…"
            />
          </div>
        </div>
      </header>

      {/* Search / filter panel */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow overflow-hidden border border-ds-outline-variant/10">
        {/* Search bar row */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Search className="w-4 h-4 text-ds-outline shrink-0" />
          <input
            value={draft.rule_name}
            onChange={(e) => set('rule_name', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="정책명 검색 (Enter)…"
            className="flex-1 bg-transparent border-none focus:ring-0 text-ds-on-surface placeholder:text-ds-outline/50 text-sm focus:outline-none font-mono"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${filtersOpen ? 'text-ds-tertiary bg-ds-tertiary/10' : 'text-ds-on-surface-variant bg-ds-surface-container-low hover:text-ds-tertiary'}`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              필터
            </button>
            {policies.length > 0 && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ds-on-surface-variant bg-ds-surface-container-low rounded-md hover:text-ds-on-surface transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Excel
              </button>
            )}
            <button onClick={handleReset} className="text-xs font-semibold text-ds-on-surface-variant hover:text-ds-on-surface px-3 py-1.5 rounded-md hover:bg-ds-surface-container-low transition-colors">
              초기화
            </button>
            <button
              onClick={handleSearch}
              disabled={draft.device_ids.length === 0 || searchMutation.isPending}
              className="bg-ds-primary text-ds-on-primary text-xs font-bold px-5 py-1.5 rounded-md hover:brightness-110 transition-all disabled:opacity-50"
            >
              {searchMutation.isPending ? '검색 중…' : '쿼리 실행'}
            </button>
          </div>
        </div>

        {/* Collapsible advanced filters */}
        {filtersOpen && (
          <div className="border-t border-ds-outline-variant/10 bg-ds-surface-container-low/30 px-4 py-3 grid grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: '출발지 IP', key: 'src_ip' as const, placeholder: '10.0.0.0/8', mono: true },
              { label: '목적지 IP', key: 'dst_ip' as const, placeholder: '0.0.0.0/0', mono: true },
              { label: '포트', key: 'port' as const, placeholder: '443', mono: true },
              { label: '사용자', key: 'user' as const, placeholder: '' },
              { label: '애플리케이션', key: 'application' as const, placeholder: '' },
              { label: '설명', key: 'description' as const, placeholder: '' },
            ].map(({ label, key, placeholder, mono }) => (
              <div key={key}>
                <label className="text-[9px] font-bold uppercase text-ds-primary/60 tracking-wider block mb-1">{label}</label>
                <input
                  value={draft[key] as string}
                  onChange={(e) => set(key, e.target.value)}
                  placeholder={placeholder}
                  className={`w-full bg-white border border-ds-outline-variant/25 rounded text-xs px-2.5 py-1.5 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary ${mono ? 'font-mono' : ''}`}
                />
              </div>
            ))}
            <div>
              <label className="text-[9px] font-bold uppercase text-ds-primary/60 tracking-wider block mb-1">프로토콜</label>
              <ShadSelect value={draft.protocol || '_all_'} onValueChange={(v) => set('protocol', v === '_all_' ? '' : v)}>
                <SelectTrigger className="bg-white border-ds-outline-variant/25 text-xs h-[30px]">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">Any</SelectItem>
                  <SelectItem value="tcp">TCP</SelectItem>
                  <SelectItem value="udp">UDP</SelectItem>
                  <SelectItem value="icmp">ICMP</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase text-ds-primary/60 tracking-wider block mb-1">액션</label>
              <ShadSelect value={draft.action || '_all_'} onValueChange={(v) => set('action', v === '_all_' ? '' : v)}>
                <SelectTrigger className="bg-white border-ds-outline-variant/25 text-xs h-[30px]">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">전체</SelectItem>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                  <SelectItem value="drop">Drop</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase text-ds-primary/60 tracking-wider block mb-1">활성</label>
              <ShadSelect value={draft.enable || '_all_'} onValueChange={(v) => set('enable', v === '_all_' ? '' : v)}>
                <SelectTrigger className="bg-white border-ds-outline-variant/25 text-xs h-[30px]">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">전체</SelectItem>
                  <SelectItem value="true">활성</SelectItem>
                  <SelectItem value="false">비활성</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>
        )}
      </div>

      {/* 검색 결과 요약 배너 */}
      {summary && (
        <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-sm font-bold text-ds-on-surface">총 {summary.total.toLocaleString()}건</span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            허용 {summary.allow.toLocaleString()}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            차단 {summary.deny.toLocaleString()}
          </span>
          {summary.disabled > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-ds-on-surface-variant">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              비활성 {summary.disabled.toLocaleString()}
            </span>
          )}
          {summary.stale > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <AlertTriangle className="w-3 h-3" />
              90일+ 미사용 {summary.stale.toLocaleString()}
            </span>
          )}
          {summary.noHit > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-ds-on-surface-variant">
              사용 기록 없음 {summary.noHit.toLocaleString()}
            </span>
          )}
        </div>
      )}

      {/* Results grid */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        <AgGridWrapper<Policy>
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={policies}
          getRowId={(p) => String(p.data.id)}
          height="calc(100vh - 380px)"
          noRowsText="장비를 선택하고 쿼리 실행 버튼을 클릭하세요."
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
