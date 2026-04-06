import { useState, useRef, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Search, Download, SlidersHorizontal, AlertTriangle, X } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { listDevices } from '@/api/devices'
import { searchPolicies, exportToExcel, type Policy, type PolicySearchRequest } from '@/api/firewall'
import { daysSinceHit } from '@/lib/utils'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'

interface SearchParams {
  device_ids: number[]
  rule_name: string
  action: string
  enable: string
  src_ip: string   // comma-sep → src_ips[]
  dst_ip: string   // comma-sep → dst_ips[]
  protocol: string // combined with port → services[]
  port: string     // comma-sep ports
  user: string
  application: string
  security_profile: string
  category: string
  description: string
  unused_days: string  // "90" → last_hit_date_to = now - N days
}

const DEFAULT_PARAMS: SearchParams = {
  device_ids: [], rule_name: '', action: '', enable: '',
  src_ip: '', dst_ip: '', protocol: '', port: '',
  user: '', application: '', security_profile: '', category: '', description: '',
  unused_days: '',
}

const ACTION_BADGE: Record<string, string> = {
  allow:  'bg-green-100 text-green-700',
  deny:   'bg-red-100 text-red-700',
  drop:   'bg-red-100 text-red-700',
  reject: 'bg-orange-100 text-orange-700',
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
  if (!value) return <span className="text-[11px] font-medium text-amber-600">사용 기록 없음</span>
  const days = daysSinceHit(value)
  if (days === null) return <span className="text-[11px] text-ds-on-surface-variant">-</span>
  if (days >= 90) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ds-error">
        <AlertTriangle className="w-3 h-3" />{days}일 미사용
      </span>
    )
  }
  if (days >= 30) return <span className="text-[11px] font-medium text-amber-600">{days}일 전</span>
  return <span className="text-[11px] text-ds-on-surface-variant">{days}일 전</span>
}

/** 활성 필터 태그 표시 */
function buildActiveFilterTags(draft: SearchParams): { label: string; key: keyof SearchParams }[] {
  const tags: { label: string; key: keyof SearchParams }[] = []
  if (draft.rule_name)       tags.push({ label: `정책명: ${draft.rule_name}`, key: 'rule_name' })
  if (draft.src_ip)          tags.push({ label: `출발지: ${draft.src_ip}`, key: 'src_ip' })
  if (draft.dst_ip)          tags.push({ label: `목적지: ${draft.dst_ip}`, key: 'dst_ip' })
  if (draft.port)            tags.push({ label: `포트: ${draft.port}`, key: 'port' })
  if (draft.protocol)        tags.push({ label: `프로토콜: ${draft.protocol}`, key: 'protocol' })
  if (draft.action)          tags.push({ label: `액션: ${draft.action}`, key: 'action' })
  if (draft.enable)          tags.push({ label: draft.enable === 'true' ? '활성' : '비활성', key: 'enable' })
  if (draft.user)            tags.push({ label: `사용자: ${draft.user}`, key: 'user' })
  if (draft.application)     tags.push({ label: `앱: ${draft.application}`, key: 'application' })
  if (draft.security_profile) tags.push({ label: `보안프로파일: ${draft.security_profile}`, key: 'security_profile' })
  if (draft.category)        tags.push({ label: `카테고리: ${draft.category}`, key: 'category' })
  if (draft.description)     tags.push({ label: `설명: ${draft.description}`, key: 'description' })
  if (draft.unused_days)     tags.push({ label: `미사용 ${draft.unused_days}일+`, key: 'unused_days' })
  return tags
}

export function PoliciesPage() {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [draft, setDraft] = useState<SearchParams>(DEFAULT_PARAMS)
  const [quickFilter, setQuickFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [searched, setSearched] = useState(false)
  const [validObjectNames, setValidObjectNames] = useState<Set<string>>(new Set())
  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  // URL 파라미터로 필터 자동 세팅 (ObjectDetailModal → 정책 검색 연동)
  useEffect(() => {
    const srcIp = searchParams.get('src_ip')
    const dstIp = searchParams.get('dst_ip')
    if (srcIp || dstIp) {
      setDraft(prev => ({
        ...prev,
        ...(srcIp ? { src_ip: srcIp } : {}),
        ...(dstIp ? { dst_ip: dstIp } : {}),
      }))
      setFiltersOpen(true)
      // URL 파라미터 제거 (뒤로가기 시 재실행 방지)
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const searchMutation = useMutation({
    mutationFn: (req: PolicySearchRequest) => searchPolicies(req),
    onSuccess: (data) => {
      setPolicies(data.policies)
      setValidObjectNames(new Set(data.valid_object_names))
      setSearched(true)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const buildRequest = (d: SearchParams): PolicySearchRequest => {
    const srcIps = d.src_ip ? d.src_ip.split(',').map(s => s.trim()).filter(Boolean) : undefined
    const dstIps = d.dst_ip ? d.dst_ip.split(',').map(s => s.trim()).filter(Boolean) : undefined

    // Build services array from port + optional protocol
    const portTokens = d.port ? d.port.split(',').map(s => s.trim()).filter(Boolean) : []
    let services: string[] | undefined
    if (portTokens.length > 0) {
      services = portTokens.map(p => d.protocol ? `${d.protocol.trim().toLowerCase()}/${p}` : p)
    } else if (d.protocol) {
      services = [`${d.protocol.trim().toLowerCase()}/0-65535`]
    }

    // Unused days → last_hit_date_to
    let lastHitDateTo: string | undefined
    if (d.unused_days) {
      const days = parseInt(d.unused_days, 10)
      if (!isNaN(days) && days > 0) {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        lastHitDateTo = cutoff.toISOString()
      }
    }

    return {
      device_ids: d.device_ids,
      rule_name: d.rule_name || undefined,
      action: d.action || undefined,
      enable: d.enable === '' ? undefined : d.enable === 'true',
      src_ips: srcIps,
      dst_ips: dstIps,
      services,
      user: d.user || undefined,
      application: d.application || undefined,
      security_profile: d.security_profile || undefined,
      category: d.category || undefined,
      description: d.description || undefined,
      last_hit_date_to: lastHitDateTo,
    }
  }

  const handleSearch = () => {
    if (draft.device_ids.length === 0) { toast.warning('장비를 선택하세요.'); return }
    searchMutation.mutate(buildRequest(draft))
  }

  // 장비 유지, 필터만 초기화, AG Grid 컬럼 필터도 초기화
  const handleReset = () => {
    setDraft(prev => ({ ...DEFAULT_PARAMS, device_ids: prev.device_ids }))
    setQuickFilter('')
    setPolicies([])
    setSearched(false)
    setValidObjectNames(new Set())
    gridRef.current?.gridApi?.setFilterModel(null)
  }

  const clearFilter = (key: keyof SearchParams) => {
    setDraft(prev => ({ ...prev, [key]: key === 'device_ids' ? [] : '' }))
  }

  const handleExport = async () => {
    if (policies.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try { await exportToExcel(policies as unknown as Record<string, unknown>[], '방화벽정책') }
    catch (e: unknown) { toast.error((e as Error).message) }
  }

  const set = (key: keyof SearchParams, val: string | number[]) =>
    setDraft((prev) => ({ ...prev, [key]: val }))

  const summary = useMemo(() => {
    if (!searched || policies.length === 0) return null
    const allow    = policies.filter(p => p.action?.toLowerCase() === 'allow').length
    const deny     = policies.filter(p => ['deny', 'drop', 'reject'].includes(p.action?.toLowerCase() ?? '')).length
    const disabled = policies.filter(p => !p.enable).length
    const stale    = policies.filter(p => { const d = daysSinceHit(p.last_hit_date); return d !== null && d >= 90 }).length
    const noHit    = policies.filter(p => !p.last_hit_date).length
    return { total: policies.length, allow, deny, disabled, stale, noHit }
  }, [policies, searched])

  const activeFilterTags = useMemo(() => buildActiveFilterTags(draft), [draft])

  const makeCellRenderer = () => (p: { value: string; data: Policy }) => (
    <TagCell
      value={p.value}
      isClickable={(name) => validObjectNames.has(name)}
      onClickName={(name) => setObjectModal({ deviceId: p.data.device_id, name })}
    />
  )

  const columnDefs: ColDef<Policy>[] = [
    {
      field: 'seq', headerName: '#', filter: 'agNumberColumnFilter', width: 55,
      cellRenderer: (p: { value: number }) => (
        <span className="font-mono text-xs text-ds-on-surface-variant">{p.value}</span>
      ),
    },
    {
      field: 'rule_name', headerName: '정책명', filter: 'agTextColumnFilter', width: 200,
      cellRenderer: (p: { value: string }) => (
        <span className="font-mono text-xs font-semibold text-ds-on-surface">{p.value ?? '-'}</span>
      ),
    },
    {
      field: 'action', headerName: '액션', filter: 'agTextColumnFilter', width: 75,
      cellRenderer: (p: { value: string }) => {
        const cls = ACTION_BADGE[p.value?.toLowerCase()] ?? 'bg-ds-surface-container text-ds-on-surface-variant'
        return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${cls}`}>{p.value}</span>
      },
    },
    {
      field: 'enable', headerName: '활성', width: 65,
      cellRenderer: (p: { value: boolean }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${p.value ? 'bg-green-100 text-green-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
          {p.value ? '활성' : '비활성'}
        </span>
      ),
    },
    { field: 'source',      headerName: '출발지', filter: 'agTextColumnFilter', flex: 1, minWidth: 150, autoHeight: true, cellRenderer: makeCellRenderer() },
    { field: 'destination', headerName: '목적지', filter: 'agTextColumnFilter', flex: 1, minWidth: 150, autoHeight: true, cellRenderer: makeCellRenderer() },
    { field: 'service',     headerName: '서비스', filter: 'agTextColumnFilter', width: 150, autoHeight: true, cellRenderer: makeCellRenderer() },
    { field: 'user',        headerName: '사용자',      filter: 'agTextColumnFilter', width: 110 },
    { field: 'application', headerName: '애플리케이션', filter: 'agTextColumnFilter', width: 130, hide: true },
    {
      field: 'security_profile', headerName: '보안 프로파일', filter: 'agTextColumnFilter', width: 140,
      cellRenderer: (p: { value: string | null }) =>
        p.value ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">{p.value}</span> : <span className="text-[11px] text-ds-on-surface-variant">-</span>,
    },
    {
      field: 'category', headerName: '카테고리', filter: 'agTextColumnFilter', width: 110,
      cellRenderer: (p: { value: string | null }) =>
        p.value ? <span className="text-[11px] text-ds-on-surface-variant">{p.value}</span> : <span className="text-[11px] text-ds-on-surface-variant">-</span>,
    },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 140 },
    {
      field: 'last_hit_date', headerName: '마지막 사용일', filter: 'agTextColumnFilter', width: 130,
      cellRenderer: (p: { value: string | null }) => <LastHitCell value={p.value} />,
    },
    { field: 'vsys', headerName: 'VSYS', filter: 'agTextColumnFilter', width: 75, hide: true },
  ]

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-64px)]">
      {/* Page header */}
      <header className="flex items-center justify-between gap-4 shrink-0">
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

      {/* Search + filter panel */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow overflow-hidden border border-ds-outline-variant/10 shrink-0">
        {/* Search bar — quickFilter across all columns */}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Search className="w-4 h-4 text-ds-outline shrink-0" />
          <input
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value)}
            placeholder="모든 컬럼 포함 검색 (로드된 데이터 실시간 필터)…"
            className="flex-1 bg-transparent border-none focus:ring-0 text-ds-on-surface placeholder:text-ds-outline/50 text-sm focus:outline-none"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${
                filtersOpen || activeFilterTags.length > 0
                  ? 'text-ds-tertiary bg-ds-tertiary/10'
                  : 'text-ds-on-surface-variant bg-ds-surface-container-low hover:text-ds-tertiary'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              필터{activeFilterTags.length > 0 && <span className="ml-1 bg-ds-tertiary text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold">{activeFilterTags.length}</span>}
            </button>
            {policies.length > 0 && (
              <button onClick={handleExport} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-ds-on-surface-variant bg-ds-surface-container-low rounded-md hover:text-ds-on-surface transition-colors">
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
            )}
            <button onClick={handleReset} className="text-xs font-semibold text-ds-on-surface-variant hover:text-ds-on-surface px-2.5 py-1.5 rounded-md hover:bg-ds-surface-container-low transition-colors">
              초기화
            </button>
            <button
              onClick={handleSearch}
              disabled={draft.device_ids.length === 0 || searchMutation.isPending}
              className="bg-ds-primary text-ds-on-primary text-xs font-bold px-4 py-1.5 rounded-md hover:brightness-110 transition-all disabled:opacity-50"
            >
              {searchMutation.isPending ? '검색 중…' : '검색'}
            </button>
          </div>
        </div>

        {/* Active filter tags */}
        {activeFilterTags.length > 0 && !filtersOpen && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {activeFilterTags.map(tag => (
              <span key={tag.key} className="inline-flex items-center gap-1 px-2 py-0.5 bg-ds-tertiary/10 text-ds-tertiary rounded text-[11px] font-semibold">
                {tag.label}
                <button onClick={() => clearFilter(tag.key)} className="hover:text-ds-error transition-colors"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}

        {/* Advanced filters */}
        {filtersOpen && (
          <div className="border-t border-ds-outline-variant/10 bg-ds-surface-container-low/30 px-4 py-3">
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2.5">
              {([
                { label: '정책명', key: 'rule_name', placeholder: 'test-policy, web-*', mono: true },
                { label: '출발지 IP', key: 'src_ip', placeholder: '10.0.0.0/8, 192.168.1.1', mono: true },
                { label: '목적지 IP', key: 'dst_ip', placeholder: '0.0.0.0/0, 172.16.0.0/12', mono: true },
                { label: '포트', key: 'port', placeholder: '80, 443, 8080-8090', mono: true },
                { label: '프로토콜', key: 'protocol', placeholder: 'tcp, udp, icmp', mono: true },
                { label: '사용자', key: 'user', placeholder: '', mono: false },
                { label: '애플리케이션', key: 'application', placeholder: '', mono: false },
                { label: '보안 프로파일', key: 'security_profile', placeholder: '', mono: false },
                { label: '카테고리', key: 'category', placeholder: '', mono: false },
                { label: '설명', key: 'description', placeholder: '', mono: false },
                { label: '미사용 기간 (일)', key: 'unused_days', placeholder: '180', mono: true },
              ] as { label: string; key: keyof SearchParams; placeholder: string; mono: boolean }[]).map(({ label, key, placeholder, mono }) => (
                <div key={key as string}>
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
                <label className="text-[9px] font-bold uppercase text-ds-primary/60 tracking-wider block mb-1">액션</label>
                <ShadSelect value={draft.action || '_all_'} onValueChange={(v) => set('action', v === '_all_' ? '' : v)}>
                  <SelectTrigger className="bg-white border-ds-outline-variant/25 text-xs h-[30px]">
                    <SelectValue placeholder="전체" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all_">전체</SelectItem>
                    <SelectItem value="allow">Allow</SelectItem>
                    <SelectItem value="deny">Deny</SelectItem>
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
          </div>
        )}
      </div>

      {/* Summary banner */}
      {summary && (
        <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 shrink-0">
          <span className="text-sm font-bold text-ds-on-surface">총 {summary.total.toLocaleString()}건</span>
          <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><span className="w-2 h-2 rounded-full bg-green-500" />허용 {summary.allow.toLocaleString()}</span>
          <span className="flex items-center gap-1 text-xs font-semibold text-red-700"><span className="w-2 h-2 rounded-full bg-red-500" />차단 {summary.deny.toLocaleString()}</span>
          {summary.disabled > 0 && <span className="flex items-center gap-1 text-xs text-ds-on-surface-variant"><span className="w-2 h-2 rounded-full bg-gray-400" />비활성 {summary.disabled.toLocaleString()}</span>}
          {summary.stale > 0 && <span className="flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="w-3 h-3" />90일+ 미사용 {summary.stale.toLocaleString()}</span>}
          {summary.noHit > 0 && <span className="text-xs text-ds-on-surface-variant">사용 기록 없음 {summary.noHit.toLocaleString()}</span>}
        </div>
      )}

      {/* Results grid — flex-1 takes all remaining height */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden flex-1 min-h-0">
        <AgGridWrapper<Policy>
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={policies}
          getRowId={(p) => String(p.data.id)}
          quickFilterText={quickFilter}
          height="100%"
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
