import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, SlidersHorizontal, AlertTriangle, X, History, Search, Bookmark, BookmarkPlus } from 'lucide-react'
import type { ColDef, RowClickedEvent } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { rowIdFromId } from '@/lib/utils'
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
import { usePolicySearchStore } from '@/store/policySearchStore'
import { queryKeys } from '@/api/queryKeys'

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

/**
 * 콤마 구분 문자열을 파싱합니다. LDAP DN처럼 값 내부에 콤마가 있는 경우
 * list_to_string이 생성한 quoted CSV 형식("v1,v2","v3,v4")을 올바르게 처리합니다.
 */
function parseCSVTokens(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of value) {
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      const trimmed = current.trim()
      if (trimmed) tokens.push(trimmed)
      current = ''
    } else {
      current += ch
    }
  }
  const trimmed = current.trim()
  if (trimmed) tokens.push(trimmed)
  return tokens
}

/** parseCSVTokens로 파싱한 뒤, 콤마를 포함한 토큰을 따옴표로 재감싸 list_to_string 형식으로 복원합니다. */
function formatCSVField(value: string | null | undefined): string {
  if (!value) return ''
  const tokens = parseCSVTokens(value)
  return tokens.map(t => t.includes(',') ? `"${t}"` : t).join(',')
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

const GRID_DEFAULT_COL_DEF_OVERRIDE = { filter: false }

export function PoliciesPage() {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { selectedIds: deviceIds, setSelectedIds: setDeviceIds } = useDeviceStore()

  const {
    filterTree, setFilterTree,
    searchRequest, setSearchRequest,
    quickFilterText, setQuickFilterText,
    filtersOpen, setFiltersOpen,
    reset: resetStore,
  } = usePolicySearchStore()

  // 검색 결과는 React Query 캐시가 단일 소스 — searchRequest가 persist되므로
  // 새로고침 시에도 쿼리가 자동으로 재실행된다.
  const searched = searchRequest !== null
  const searchQuery = useQuery({
    queryKey: queryKeys.policySearch(searchRequest),
    enabled: searched,
    queryFn: async () => {
      const req = searchRequest!
      const ids = req.device_ids ?? []
      const [policyRes, logs] = await Promise.all([
        searchPolicies(req),
        ids.length > 0 ? getChangeLogs(ids).catch(() => [] as ChangeLogEntry[]) : Promise.resolve([] as ChangeLogEntry[]),
      ])
      // 변경 이력 — 최신 로그만 (key 기준 첫 번째)
      const seen = new Set<string>()
      const deduped: ChangeLogEntry[] = []
      for (const log of logs) {
        const key = `${log.device_id}_${log.object_name}`
        if (!seen.has(key)) { seen.add(key); deduped.push(log) }
      }
      return { policyRes, changeLogEntries: deduped }
    },
  })

  useEffect(() => {
    if (searchQuery.error) toast.error((searchQuery.error as Error).message)
  }, [searchQuery.error])

  const policies = useMemo(() => searchQuery.data?.policyRes.policies ?? [], [searchQuery.data])
  const changeLogEntries = useMemo(() => searchQuery.data?.changeLogEntries ?? [], [searchQuery.data])
  const validObjectNames = useMemo(
    () => new Set(searchQuery.data?.policyRes.valid_object_names ?? []),
    [searchQuery.data]
  )
  const changeLogMap = useMemo(() => {
    const map = new Map<string, ChangeLogEntry>()
    for (const log of changeLogEntries) {
      const key = `${log.device_id}_${log.object_name}`
      if (!map.has(key)) map.set(key, log)
    }
    return map
  }, [changeLogEntries])

  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)
  const [historyModal, setHistoryModal] = useState<{ deviceId: number; ruleName: string } | null>(null)
  const [detailModal, setDetailModal] = useState<Policy | null>(null)
  const [quickFilterInput, setQuickFilterInput] = useState(quickFilterText)

  // 검색 조건 프리셋 (localStorage)
  type Preset = { name: string; tree: FilterTree }
  const PRESET_KEY = 'fat_policy_presets'
  const [presets, setPresets] = useState<Preset[]>(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') } catch { return [] }
  })
  const [presetNameInput, setPresetNameInput] = useState('')
  const [showPresetInput, setShowPresetInput] = useState(false)
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false)
  const presetBtnRef = useRef<HTMLButtonElement>(null)

  const savePreset = () => {
    const name = presetNameInput.trim()
    if (!name) return
    const updated = [...presets.filter(p => p.name !== name), { name, tree: filterTree }]
    setPresets(updated)
    localStorage.setItem(PRESET_KEY, JSON.stringify(updated))
    setPresetNameInput('')
    setShowPresetInput(false)
    toast.success(`프리셋 "${name}" 저장됨`)
  }

  const loadPreset = (preset: Preset) => {
    setFilterTree(preset.tree)
    setFiltersOpen(true)
    toast.info(`프리셋 "${preset.name}" 불러옴`)
  }

  const deletePreset = (name: string) => {
    const updated = presets.filter(p => p.name !== name)
    setPresets(updated)
    localStorage.setItem(PRESET_KEY, JSON.stringify(updated))
  }

  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })

  // URL 파라미터로 필터 자동 세팅 (ObjectDetailModal / AnalysisDetailPage → 정책 검색 연동)
  useEffect(() => {
    const srcName  = searchParams.get('src_name')
    const dstName  = searchParams.get('dst_name')
    const svcName  = searchParams.get('svc_name')
    const srcIp    = searchParams.get('src_ip')
    const dstIp    = searchParams.get('dst_ip')
    const objName  = searchParams.get('obj_name') // 출발지+목적지 OR 검색
    const ruleName = searchParams.get('rule_name')
    if (srcName || dstName || svcName || srcIp || dstIp || objName || ruleName) {
      let newTree: FilterTree
      if (objName) {
        // src_name OR dst_name 동시 검색
        newTree = [{
          id: crypto.randomUUID(),
          joinOperator: 'AND',
          conditions: [
            { field: 'src_name', operator: 'contains' as const, value: objName, joinOperator: 'OR' as const },
            { field: 'dst_name', operator: 'contains' as const, value: objName, joinOperator: 'AND' as const },
          ],
        }]
      } else {
        const newConds = []
        if (ruleName) newConds.push({ field: 'rule_name', operator: 'equals' as const, value: ruleName })
        if (srcName)  newConds.push({ field: 'src_name', operator: 'contains' as const, value: srcName })
        if (dstName)  newConds.push({ field: 'dst_name', operator: 'contains' as const, value: dstName })
        if (svcName)  newConds.push({ field: 'service_name', operator: 'contains' as const, value: svcName })
        if (srcIp)    newConds.push({ field: 'src_ip', operator: 'contains' as const, value: srcIp })
        if (dstIp)    newConds.push({ field: 'dst_ip', operator: 'contains' as const, value: dstIp })
        newTree = conditionsToFilterTree(newConds)
      }
      setFilterTree(newTree)
      setFiltersOpen(true)
      setSearchParams({}, { replace: true })
      // 장비가 이미 선택된 상태면 자동 검색
      if (deviceIds.length > 0) {
        const payload = buildRequestFromFilterTree(newTree, deviceIds)
        setSearchRequest(payload as unknown as PolicySearchRequest)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const buildRequest = (): PolicySearchRequest => {
    const payload = buildRequestFromFilterTree(filterTree, deviceIds)
    return payload as unknown as PolicySearchRequest
  }

  const handleSearch = () => {
    if (deviceIds.length === 0) { toast.warning('장비를 선택하세요.'); return }
    const req = buildRequest()
    setSearchRequest(req)
    // 동일 조건으로 다시 검색해도 서버를 재조회하도록 캐시를 무효화
    queryClient.invalidateQueries({ queryKey: queryKeys.policySearch(req) })
  }

  const handleReset = () => {
    resetStore()
    setQuickFilterInput('')
    gridRef.current?.gridApi?.setFilterModel(null)
  }

  const handleApplyQuickFilter = () => setQuickFilterText(quickFilterInput)

  const handleExport = async () => {
    if (policies.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try {
      const exportData = policies.map(p => ({
        '장비명': deviceNameMap.get(p.device_id) ?? String(p.device_id),
        '#': p.seq,
        '정책명': p.rule_name,
        '액션': p.action,
        '활성': p.enable ? '활성' : '비활성',
        '출발지': p.source,
        '목적지': p.destination,
        '서비스': p.service,
        '사용자': formatCSVField(p.user),
        '보안 프로파일': p.security_profile,
        '카테고리': p.category,
        '설명': p.description,
        '마지막 사용일': p.last_hit_date,
      }))
      await exportToExcel(exportData, '방화벽정책')
    }
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

  const handleRowClick = useCallback((event: RowClickedEvent<Policy>) => {
    if (event.data) setDetailModal(event.data)
  }, [])

  const columnDefs = useMemo<ColDef<Policy>[]>(() => [
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
        const users = parseCSVTokens(p.value)
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
    {
      field: 'hit_count', headerName: '히트 횟수', width: 100,
      cellRenderer: (p: { value: number | null }) => (
        <span className="text-[11px] text-ds-on-surface-variant">{p.value ?? '-'}</span>
      ),
    },
    { field: 'vsys', headerName: 'VSYS', width: 72, hide: true },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [deviceNameMap, changeLogMap])

  const allConditions = filterTree.flatMap(g => g.conditions)
  const hasConditions = allConditions.some(c => c.value.trim())

  return (
    <div className="flex flex-col gap-3">
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
            onClick={() => setFiltersOpen(!filtersOpen)}
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
            {/* 프리셋 */}
            {presets.length > 0 && (
              <div className="relative">
                <button
                  ref={presetBtnRef}
                  onClick={() => setPresetDropdownOpen(o => !o)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
                >
                  <Bookmark className="w-3 h-3" /> 프리셋
                </button>
                {presetDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setPresetDropdownOpen(false)} />
                    <div
                      className="fixed z-50 bg-white border border-ds-outline-variant/20 rounded-lg shadow-xl min-w-44 py-1"
                      style={{
                        top: (presetBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                        right: window.innerWidth - (presetBtnRef.current?.getBoundingClientRect().right ?? 0),
                      }}
                    >
                      {presets.map(p => (
                        <div key={p.name} className="flex items-center justify-between px-3 py-1.5 hover:bg-ds-surface-container-low gap-2">
                          <button className="text-[12px] text-ds-on-surface truncate flex-1 text-left" onClick={() => { loadPreset(p); setPresetDropdownOpen(false) }}>{p.name}</button>
                          <button className="text-ds-error hover:text-ds-error/70 shrink-0" onClick={() => deletePreset(p.name)}><X className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {hasConditions && !showPresetInput && (
              <button
                onClick={() => setShowPresetInput(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
              >
                <BookmarkPlus className="w-3 h-3" /> 저장
              </button>
            )}
            {showPresetInput && (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={presetNameInput}
                  onChange={e => setPresetNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setShowPresetInput(false) }}
                  placeholder="프리셋 이름"
                  className="h-7 px-2 text-[12px] border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary w-28"
                />
                <button onClick={savePreset} className="text-[12px] font-semibold text-ds-tertiary px-2 py-1 rounded hover:bg-ds-tertiary/10 transition-colors">저장</button>
                <button onClick={() => setShowPresetInput(false)} className="text-[12px] text-ds-on-surface-variant px-1 py-1 rounded hover:bg-ds-surface-container-low transition-colors"><X className="w-3 h-3" /></button>
              </div>
            )}
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
              disabled={deviceIds.length === 0 || searchQuery.isFetching}
              className="btn-primary-gradient text-ds-on-tertiary text-[12px] font-semibold px-4 py-1.5 rounded-lg shadow-sm hover:opacity-90 transition-all disabled:opacity-50"
            >
              {searchQuery.isFetching ? '검색 중…' : '검색'}
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
      <div className="card rounded-xl overflow-hidden">
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
          getRowId={rowIdFromId}
          height="800px"
          noRowsText="장비를 선택하고 검색 버튼을 클릭하세요."
          defaultColDefOverride={GRID_DEFAULT_COL_DEF_OVERRIDE}
          quickFilterText={quickFilterText}
          onRowClicked={handleRowClick}
          rowHeight={34}
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
// refresh
 
