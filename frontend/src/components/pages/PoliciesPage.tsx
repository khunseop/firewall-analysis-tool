import { useState, useRef, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, SlidersHorizontal, AlertTriangle, X, History, Search } from 'lucide-react'
import type { ColDef, RowClickedEvent } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { listDevices } from '@/api/devices'
import {
  searchPolicies, getChangeLogs, exportToExcel,
  type Policy, type PolicySearchRequest, type ChangeLogEntry,
} from '@/api/firewall'
import { daysSinceHit } from '@/lib/utils'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'
import { PolicyHistoryModal } from '@/components/shared/PolicyHistoryModal'
import { PolicyDetailModal } from '@/components/shared/PolicyDetailModal'
import {
  QueryBuilder, buildRequestFromFilterTree, conditionsToFilterTree,
  QB_FIELDS, OP_LABELS,
  type FilterTree,
} from '@/components/shared/QueryBuilder'
import { DeviceSelector } from '@/components/shared/DeviceSelector'
import { useDeviceStore } from '@/store/deviceStore'

const ACTION_BADGE: Record<string, string> = {
  allow:  'bg-green-100 text-green-700',
  deny:   'bg-red-100 text-red-700',
  drop:   'bg-red-100 text-red-700',
  reject: 'bg-orange-100 text-orange-700',
}

const CHANGE_META: Record<string, { label: string; cls: string }> = {
  created:          { label: '추가', cls: 'bg-emerald-100 text-emerald-700' },
  updated:          { label: '변경', cls: 'bg-amber-100  text-amber-700' },
  deleted:          { label: '삭제', cls: 'bg-red-100    text-red-700' },
  hit_date_updated: { label: '히트', cls: 'bg-gray-100   text-gray-500' },
}

/** 그리드 셀용 인라인 태그 (고정 높이, 최대 2개 + 개수) */
function InlineTagCell({ value }: { value: string }) {
  const names = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (names.length === 0) return <span className="text-[11px] text-ds-on-surface-variant">-</span>
  const MAX = 2
  const visible = names.slice(0, MAX)
  const extra = names.length - MAX
  return (
    <div className="flex items-center gap-1 overflow-hidden">
      {visible.map((name, i) => (
        <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-ds-surface-container text-ds-on-surface whitespace-nowrap shrink-0">
          {name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] font-semibold text-ds-on-surface-variant whitespace-nowrap shrink-0">+{extra}</span>
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

export function PoliciesPage() {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const { selectedIds: deviceIds, setSelectedIds: setDeviceIds } = useDeviceStore()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterTree, setFilterTree] = useState<FilterTree>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [searched, setSearched] = useState(false)
  const [validObjectNames, setValidObjectNames] = useState<Set<string>>(new Set())
  const [changeLogMap, setChangeLogMap] = useState<Map<string, ChangeLogEntry>>(new Map())
  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)
  const [historyModal, setHistoryModal] = useState<{ deviceId: number; ruleName: string } | null>(null)
  const [detailModal, setDetailModal] = useState<Policy | null>(null)
  const [quickFilterInput, setQuickFilterInput] = useState('')
  const [quickFilterText, setQuickFilterText] = useState('')

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  // URL 파라미터로 필터 자동 세팅 (ObjectDetailModal → 정책 검색 연동)
  useEffect(() => {
    const srcName = searchParams.get('src_name')
    const dstName = searchParams.get('dst_name')
    const svcName = searchParams.get('svc_name')
    const srcIp   = searchParams.get('src_ip')
    const dstIp   = searchParams.get('dst_ip')
    if (srcName || dstName || svcName || srcIp || dstIp) {
      const newConds = []
      if (srcName) newConds.push({ field: 'src_name', operator: 'contains' as const, value: srcName })
      if (dstName) newConds.push({ field: 'dst_name', operator: 'contains' as const, value: dstName })
      if (svcName) newConds.push({ field: 'service_name', operator: 'contains' as const, value: svcName })
      if (srcIp)   newConds.push({ field: 'src_ip', operator: 'contains' as const, value: srcIp })
      if (dstIp)   newConds.push({ field: 'dst_ip', operator: 'contains' as const, value: dstIp })
      setFilterTree(conditionsToFilterTree(newConds))
      setFiltersOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const searchMutation = useMutation({
    mutationFn: async (req: PolicySearchRequest) => {
      const [policyRes, logs] = await Promise.all([
        searchPolicies(req),
        deviceIds.length > 0 ? getChangeLogs(deviceIds).catch(() => []) : Promise.resolve([]),
      ])
      return { policyRes, logs }
    },
    onSuccess: ({ policyRes, logs }) => {
      setPolicies(policyRes.policies)
      setValidObjectNames(new Set(policyRes.valid_object_names))
      setSearched(true)

      // 변경 이력 맵 갱신 (최신 로그만)
      const map = new Map<string, ChangeLogEntry>()
      for (const log of logs as ChangeLogEntry[]) {
        const key = `${log.device_id}_${log.object_name}`
        if (!map.has(key)) map.set(key, log)
      }
      setChangeLogMap(map)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const buildRequest = (): PolicySearchRequest => {
    const payload = buildRequestFromFilterTree(filterTree, deviceIds)
    return payload as unknown as PolicySearchRequest
  }

  const handleSearch = () => {
    if (deviceIds.length === 0) { toast.warning('장비를 선택하세요.'); return }
    searchMutation.mutate(buildRequest())
  }

  const handleReset = () => {
    setFilterTree([])
    setPolicies([])
    setSearched(false)
    setValidObjectNames(new Set())
    setChangeLogMap(new Map())
    setQuickFilterInput('')
    setQuickFilterText('')
    gridRef.current?.gridApi?.setFilterModel(null)
  }

  const handleApplyQuickFilter = () => setQuickFilterText(quickFilterInput)

  const handleExport = async () => {
    if (policies.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try { await exportToExcel(policies as unknown as Record<string, unknown>[], '방화벽정책') }
    catch (e: unknown) { toast.error((e as Error).message) }
  }

  const summary = useMemo(() => {
    if (!searched || policies.length === 0) return null
    const allow    = policies.filter(p => p.action?.toLowerCase() === 'allow').length
    const deny     = policies.filter(p => ['deny', 'drop', 'reject'].includes(p.action?.toLowerCase() ?? '')).length
    const disabled = policies.filter(p => !p.enable).length
    const stale    = policies.filter(p => { const d = daysSinceHit(p.last_hit_date); return d !== null && d >= 90 }).length
    const noHit    = policies.filter(p => !p.last_hit_date).length
    return { total: policies.length, allow, deny, disabled, stale, noHit }
  }, [policies, searched])

  const deviceNameMap = useMemo(
    () => new Map(devices.map(d => [d.id, d.name])),
    [devices]
  )

  const handleRowClick = (event: RowClickedEvent<Policy>) => {
    if (event.data) setDetailModal(event.data)
  }

  const columnDefs: ColDef<Policy>[] = [
    {
      headerName: '장비명',
      width: 120,
      pinned: 'left',
      valueGetter: (p) => deviceNameMap.get(p.data?.device_id ?? -1) ?? String(p.data?.device_id ?? '-'),
      cellRenderer: (p: { value: string }) => (
        <span className="text-[11px] font-semibold text-ds-tertiary font-mono">{p.value}</span>
      ),
    },
    {
      field: 'seq', headerName: '#', width: 52,
      cellRenderer: (p: { value: number }) => (
        <span className="font-mono text-xs text-ds-on-surface-variant">{p.value}</span>
      ),
    },
    {
      field: 'rule_name', headerName: '정책명', width: 200,
      cellRenderer: (p: { value: string; data: Policy }) => {
        const key = `${p.data.device_id}_${p.data.rule_name}`
        const log = changeLogMap.get(key)
        const meta = log ? (CHANGE_META[log.action] ?? { label: log.action, cls: 'bg-gray-100 text-gray-500' }) : null
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-xs font-semibold text-ds-on-surface truncate">{p.value ?? '-'}</span>
            {meta && (
              <button
                title={`${meta.label} — 클릭하여 이력 보기`}
                onClick={() => setHistoryModal({ deviceId: p.data.device_id, ruleName: p.data.rule_name })}
                className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition-opacity hover:opacity-70 ${meta.cls}`}
              >
                <History className="w-2.5 h-2.5" />
                {meta.label}
              </button>
            )}
          </div>
        )
      },
    },
    {
      field: 'action', headerName: '액션', width: 72,
      cellRenderer: (p: { value: string }) => {
        const cls = ACTION_BADGE[p.value?.toLowerCase()] ?? 'bg-ds-surface-container text-ds-on-surface-variant'
        return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${cls}`}>{p.value}</span>
      },
    },
    {
      field: 'enable', headerName: '활성', width: 62,
      cellRenderer: (p: { value: boolean }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${p.value ? 'bg-green-100 text-green-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
          {p.value ? '활성' : '비활성'}
        </span>
      ),
    },
    { field: 'source',      headerName: '출발지', minWidth: 160, cellRenderer: (p: { value: string }) => <InlineTagCell value={p.value} /> },
    { field: 'destination', headerName: '목적지', minWidth: 160, cellRenderer: (p: { value: string }) => <InlineTagCell value={p.value} /> },
    { field: 'service',     headerName: '서비스', minWidth: 130, cellRenderer: (p: { value: string }) => <InlineTagCell value={p.value} /> },
    {
      field: 'user', headerName: '사용자', minWidth: 100,
      cellRenderer: (p: { value: string | null }) => {
        if (!p.value) return <span className="text-[11px] text-ds-on-surface-variant">-</span>
        const users = p.value.split(',').map((u) => u.trim()).filter(Boolean)
        const first = users[0]
        const extra = users.length - 1
        return (
          <span className="font-mono text-xs text-ds-on-surface">
            {first}{extra > 0 && <span className="text-ds-on-surface-variant"> +{extra}</span>}
          </span>
        )
      },
    },
    { field: 'application', headerName: '애플리케이션', width: 130, hide: true },
    {
      field: 'security_profile', headerName: '보안 프로파일', width: 130,
      cellRenderer: (p: { value: string | null }) =>
        p.value ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">{p.value}</span> : <span className="text-[11px] text-ds-on-surface-variant">-</span>,
    },
    {
      field: 'category', headerName: '카테고리', width: 100,
      cellRenderer: (p: { value: string | null }) =>
        p.value ? <span className="text-[11px] text-ds-on-surface-variant">{p.value}</span> : <span className="text-[11px] text-ds-on-surface-variant">-</span>,
    },
    {
      field: 'description', headerName: '설명', flex: 1, minWidth: 120,
      cellRenderer: (p: { value: string | null }) => (
        <span className="text-xs text-ds-on-surface-variant">{p.value ?? '-'}</span>
      ),
    },
    {
      field: 'last_hit_date', headerName: '마지막 사용일', minWidth: 120,
      cellRenderer: (p: { value: string | null }) => <LastHitCell value={p.value} />,
    },
    { field: 'vsys', headerName: 'VSYS', width: 72, hide: true },
  ]

  const allConditions = filterTree.flatMap(g => g.conditions)
  const hasConditions = allConditions.some(c => c.value.trim())

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-64px)]">
      {/* Page header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">Policies</h1>
        <DeviceSelector />
      </div>

      {/* Filter panel */}
      <div className="card rounded-xl overflow-hidden shrink-0">
        {/* 툴바 */}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
              filtersOpen || hasConditions
                ? 'text-ds-tertiary bg-ds-tertiary/10'
                : 'text-ds-on-surface-variant bg-ds-surface-container-low hover:text-ds-tertiary border border-ds-outline-variant/10'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            상세 검색
            {hasConditions && (
              <span className="ml-1 bg-ds-tertiary text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold">
                {allConditions.filter(c => c.value.trim()).length}
              </span>
            )}
          </button>

          {/* 활성 조건 태그 (패널 닫혔을 때) */}
          {!filtersOpen && hasConditions && (
            <div className="flex flex-wrap gap-1.5 flex-1">
              {filterTree.map((group, gi) => (
                group.conditions.filter(c => c.value.trim()).map((c, ci) => {
                  const fieldLabel = QB_FIELDS.find(f => f.key === c.field)?.label ?? c.field
                  const opLabel = OP_LABELS[c.operator as keyof typeof OP_LABELS] ?? c.operator
                  const isNot = c.operator === 'not_equals' || c.operator === 'not_contains'
                  return (
                    <span key={`${gi}-${ci}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${isNot ? 'bg-ds-error/10 text-ds-error' : 'bg-ds-tertiary/10 text-ds-tertiary'}`}>
                      {gi > 0 && ci === 0 && (
                        <span className="opacity-50 mr-0.5 text-[10px]">{filterTree[gi - 1].joinOperator}</span>
                      )}
                      {fieldLabel} <span className="opacity-60">{opLabel}</span> {c.value}
                    </span>
                  )
                })
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {policies.length > 0 && (
              <button onClick={handleExport} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors">
                <Download className="w-3 h-3" /> Excel
              </button>
            )}
            <button onClick={handleReset} className="text-[12px] font-medium text-ds-on-surface-variant hover:text-ds-on-surface px-2.5 py-1.5 rounded-lg hover:bg-ds-surface-container-low transition-colors">
              초기화
            </button>
            <button
              onClick={handleSearch}
              disabled={deviceIds.length === 0 || searchMutation.isPending}
              className="btn-primary-gradient text-ds-on-tertiary text-[12px] font-semibold px-4 py-1.5 rounded-lg shadow-sm hover:opacity-90 transition-all disabled:opacity-50"
            >
              {searchMutation.isPending ? '검색 중…' : '검색'}
            </button>
          </div>
        </div>

        {/* 쿼리 빌더 패널 */}
        {filtersOpen && (
          <div className="border-t border-ds-outline-variant/10 bg-ds-surface-container-low/30 px-4 py-3">
            <p className="text-[10px] text-ds-on-surface-variant mb-2">조건을 추가하고 검색하세요. AND/OR 토글로 조건을 결합하고, 그룹 추가로 괄호 묶음을 만들 수 있습니다.</p>
            <QueryBuilder tree={filterTree} onTreeChange={setFilterTree} />
          </div>
        )}
      </div>

      {/* Summary banner */}
      {summary && (
        <div className="card rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 shrink-0">
          <span className="text-sm font-bold text-ds-on-surface">총 {summary.total.toLocaleString()}건</span>
          <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><span className="w-2 h-2 rounded-full bg-green-500" />허용 {summary.allow.toLocaleString()}</span>
          <span className="flex items-center gap-1 text-xs font-semibold text-red-700"><span className="w-2 h-2 rounded-full bg-red-500" />차단 {summary.deny.toLocaleString()}</span>
          {summary.disabled > 0 && <span className="flex items-center gap-1 text-xs text-ds-on-surface-variant"><span className="w-2 h-2 rounded-full bg-gray-400" />비활성 {summary.disabled.toLocaleString()}</span>}
          {summary.stale > 0 && <span className="flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="w-3 h-3" />90일+ 미사용 {summary.stale.toLocaleString()}</span>}
          {summary.noHit > 0 && <span className="text-xs text-ds-on-surface-variant">사용 기록 없음 {summary.noHit.toLocaleString()}</span>}
        </div>
      )}

      {/* Results grid */}
      <div className="card rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col">
        {searched && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-ds-outline-variant/10 shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ds-on-surface-variant pointer-events-none" />
              <input
                type="text"
                value={quickFilterInput}
                onChange={e => setQuickFilterInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleApplyQuickFilter()}
                placeholder="결과 내 검색 (Enter)…"
                className="w-full pl-8 pr-8 py-1.5 text-xs bg-ds-surface-container-low border border-ds-outline-variant/20 rounded-lg focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary placeholder:text-ds-on-surface-variant/50"
              />
              {quickFilterInput && (
                <button
                  onClick={() => { setQuickFilterInput(''); setQuickFilterText('') }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ds-on-surface-variant hover:text-ds-on-surface transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              onClick={handleApplyQuickFilter}
              className="shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-ds-surface-container text-ds-on-surface-variant hover:text-ds-on-surface border border-ds-outline-variant/15 transition-colors"
            >
              필터
            </button>
            {quickFilterText && (
              <span className="text-[11px] text-ds-tertiary font-semibold shrink-0">"{quickFilterText}" 필터 중</span>
            )}
          </div>
        )}
        <AgGridWrapper<Policy>
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={policies}
          getRowId={(p) => String(p.data.id)}
          height="100%"
          noRowsText="장비를 선택하고 검색 버튼을 클릭하세요."
          defaultColDefOverride={{ filter: false }}
          quickFilterText={quickFilterText}
          onRowClicked={handleRowClick}
        />
      </div>

      {objectModal && (
        <ObjectDetailModal
          deviceId={objectModal.deviceId}
          name={objectModal.name}
          onClose={() => setObjectModal(null)}
        />
      )}

      {historyModal && (
        <PolicyHistoryModal
          deviceId={historyModal.deviceId}
          ruleName={historyModal.ruleName}
          onClose={() => setHistoryModal(null)}
        />
      )}

      {detailModal && (
        <PolicyDetailModal
          policy={detailModal}
          deviceName={deviceNameMap.get(detailModal.device_id) ?? String(detailModal.device_id)}
          validObjectNames={validObjectNames}
          onObjectClick={(deviceId, name) => {
            setDetailModal(null)
            setObjectModal({ deviceId, name })
          }}
          onHistoryClick={(deviceId, ruleName) => {
            setDetailModal(null)
            setHistoryModal({ deviceId, ruleName })
          }}
          onClose={() => setDetailModal(null)}
        />
      )}
    </div>
  )
}
