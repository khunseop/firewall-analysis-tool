import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, SlidersHorizontal, AlertTriangle, X, History, Search, Bookmark, BookmarkPlus, Pencil, Plus, Trash2, ArrowLeftRight, RotateCcw, Terminal, Eye } from 'lucide-react'
import type { CellValueChangedEvent, ColDef, RowClickedEvent } from '@ag-grid-community/core'
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
import { QueryBuilder } from '@/components/shared/QueryBuilder'
import {
  buildRequestFromFilterTree, conditionsToFilterTree, generateId,
  QB_FIELDS, OP_LABELS,
  type FilterTree,
} from '@/components/shared/queryBuilderModel'
import { DeviceSelector } from '@/components/shared/DeviceSelector'
import { useDeviceStore } from '@/store/deviceStore'
import { usePolicySearchStore } from '@/store/policySearchStore'
import { queryKeys } from '@/api/queryKeys'
import { diffMultiValueField, isFieldDiffEmpty } from '@/lib/policyDiff'
import {
  listPendingChanges, addPendingChange, updatePendingChange, removePendingChange, clearPendingChanges, planBulkPolicy, getPreviewOrder,
  type BulkPolicyPlanResponse, type PreviewPolicyRow,
} from '@/api/policyBuilder'
import { CreatePolicyModal } from '@/components/pages/policy-builder/CreatePolicyModal'
import { NewPolicyFormModal } from '@/components/pages/policy-builder/NewPolicyFormModal'
import { ModifyPolicyModal } from '@/components/pages/policy-builder/ModifyPolicyModal'
import { MoveExistingDialog } from '@/components/pages/policy-builder/MoveExistingDialog'
import { PlanResultPanel } from '@/components/pages/policy-builder/PlanResultPanel'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** 편집모드에서 그리드 필드명 ↔ 백엔드(PendingPolicyChange payload) 필드명 매핑 (diff 대상 필드).
 *  from_zone/to_zone은 Palo Alto만 수집하는 필드라 다른 벤더 정책은 항상 빈 값으로 시작함. */
const EDITABLE_FIELD_MAP: Record<string, string> = {
  source: 'source', destination: 'destination', service: 'service',
  application: 'application', user: 'source_user',
  from_zone: 'from_zone', to_zone: 'to_zone',
}

interface EditablePolicyRow extends Policy {
  _pendingStatus?: 'new' | 'modified' | 'deleted' | 'moved'
}

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
  const { selectedIds: deviceIds } = useDeviceStore()

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

  // 편집모드 — 단일 장비 선택 시에만 가능 (대기중 변경사항은 장비 1개 단위로 저장됨)
  const [editMode, setEditMode] = useState(false)
  const editDeviceId = deviceIds.length === 1 ? deviceIds[0] : null
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<number[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showFormModal, setShowFormModal] = useState(false)
  const [showModifyModal, setShowModifyModal] = useState(false)
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [planResult, setPlanResult] = useState<BulkPolicyPlanResponse | null>(null)
  const [planLoading, setPlanLoading] = useState(false)

  // 편집모드 중 장비 선택이 1개가 아니게 바뀌면(예: 다른 화면에서 다시 진입) 상태가 꼬이지 않도록 자동 종료
  useEffect(() => {
    if (editMode && !editDeviceId) setEditMode(false)
  }, [editMode, editDeviceId])

  const pendingChangesQuery = useQuery({
    queryKey: ['policy-builder-pending-changes', editDeviceId],
    queryFn: () => listPendingChanges(editDeviceId!),
    enabled: editMode && !!editDeviceId,
  })
  const pendingChanges = useMemo(() => pendingChangesQuery.data ?? [], [pendingChangesQuery.data])

  // 대기중 변경사항(생성/수정/삭제/이동)을 모두 적용한 실제 결과 순서 — 그리드는 이 데이터를 그대로 표시한다.
  // CLI 생성(/plan)과 동일한 위치 계산 로직(백엔드 insertion_analyzer)을 재사용하므로 화면과
  // 실제 CLI 결과가 어긋나지 않는다.
  const previewOrderQuery = useQuery({
    queryKey: queryKeys.policyBuilderPreviewOrder(editDeviceId),
    queryFn: () => getPreviewOrder(editDeviceId!),
    enabled: editMode && !!editDeviceId,
  })

  const refetchPendingChanges = () => {
    queryClient.invalidateQueries({ queryKey: ['policy-builder-pending-changes', editDeviceId] })
    queryClient.invalidateQueries({ queryKey: queryKeys.policyBuilderPreviewOrder(editDeviceId) })
  }

  // 편집모드에서 정책 1건의 필드 하나를 바꿀 때 공용으로 쓰는 로직 — 그리드 셀 편집과
  // 상세보기(PolicyDetailModal)의 칩 추가/삭제 양쪽에서 재사용한다.
  const applyFieldChange = useCallback((rowId: number, gridField: string, oldValue: string, newValue: string) => {
    if (!editDeviceId || oldValue === newValue) return
    const backendField = EDITABLE_FIELD_MAP[gridField]
    if (!backendField) return
    if (rowId < 0) {
      // 신규 생성행(음수 id) — create pending change의 payload 필드를 직접 갱신
      const change = pendingChangesQuery.data?.find((c) => c.change_type === 'create' && -c.id === rowId)
      if (!change) return
      updatePendingChange(editDeviceId, change.id, { [backendField]: newValue })
        .then(refetchPendingChanges).catch((e: Error) => toast.error(e.message))
      return
    }
    const diff = diffMultiValueField(oldValue, newValue)
    if (isFieldDiffEmpty(diff)) return
    addPendingChange(editDeviceId, {
      change_type: 'modify', target_policy_id: rowId,
      client_key: `modify-${rowId}-${gridField}-${Date.now()}`,
      payload: { [backendField]: diff },
    }).then(refetchPendingChanges).catch((e: Error) => toast.error(e.message))
  }, [editDeviceId, pendingChangesQuery.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCellValueChanged = useCallback((event: CellValueChangedEvent<EditablePolicyRow>) => {
    if (!event.data || !event.colDef.field) return
    applyFieldChange(event.data.id, event.colDef.field, String(event.oldValue ?? ''), String(event.newValue ?? ''))
  }, [applyFieldChange])

  const handleDeleteSelected = async () => {
    if (!editDeviceId || selectedPolicyIds.length === 0) return
    const timestamp = Date.now()
    try {
      for (const policyId of selectedPolicyIds) {
        if (policyId < 0) {
          // 신규 생성행(음수 id) — 아직 실제 정책이 아니므로 delete가 아니라 create 변경사항 자체를 취소한다.
          const change = pendingChangesQuery.data?.find((c) => c.change_type === 'create' && -c.id === policyId)
          if (change) await removePendingChange(editDeviceId, change.id)
          continue
        }
        await addPendingChange(editDeviceId, {
          change_type: 'delete', target_policy_id: policyId, client_key: `delete-${policyId}-${timestamp}`, payload: {},
        })
      }
      toast.success(`정책 ${selectedPolicyIds.length}건 삭제가 대기중 변경사항으로 추가되었습니다.`)
      setSelectedPolicyIds([])
      refetchPendingChanges()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleGenerateCli = async () => {
    if (!editDeviceId) return
    setPlanLoading(true)
    try {
      const result = await planBulkPolicy(editDeviceId)
      setPlanResult(result)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPlanLoading(false)
    }
  }

  const handleClearPending = async () => {
    if (!editDeviceId) return
    await clearPendingChanges(editDeviceId)
    toast.success('대기중 변경사항을 모두 초기화했습니다.')
    refetchPendingChanges()
  }

  // 편집모드 그리드는 백엔드가 계산한 "대기중 변경사항을 모두 적용한 최종 순서"(previewOrderQuery)를
  // 그대로 표시한다 — 이동/생성이 실제로 그 위치에 반영된 것처럼 보이고, CLI 생성(/plan) 결과와도
  // 항상 일치한다(같은 위치 계산 로직을 백엔드에서 공유).
  const toEditableRow = (row: PreviewPolicyRow): EditablePolicyRow => ({
    id: row.id,
    device_id: row.device_id,
    rule_name: row.rule_name,
    source: row.source,
    destination: row.destination,
    service: row.service,
    action: row.action,
    vsys: row.vsys,
    seq: row.seq,
    enable: row.enable ?? true,
    user: row.user,
    application: row.application,
    security_profile: row.security_profile,
    category: row.category,
    description: row.description,
    last_hit_date: row.last_hit_date,
    hit_count: row.hit_count,
    is_active: row.is_active,
    last_seen_at: row.last_seen_at,
    from_zone: row.from_zone,
    to_zone: row.to_zone,
    log_setting: row.log_setting,
    _pendingStatus: row.pending_status ?? undefined,
  })

  const mergedPolicies = useMemo<EditablePolicyRow[]>(() => {
    if (!editMode) return policies
    // 최초 진입 시(아직 미조회) 검색 결과를 그대로 보여주다가, preview-order 응답이 오면 교체한다.
    if (!previewOrderQuery.data) return policies
    return previewOrderQuery.data.map(toEditableRow)
  }, [editMode, policies, previewOrderQuery.data])

  const pendingCounts = useMemo(() => {
    const counts = { create: 0, modify: 0, delete: 0, move: 0 }
    for (const c of pendingChanges) {
      if (c.change_type === 'create') counts.create++
      else if (c.change_type === 'new_object') continue
      else if (c.change_type in counts) counts[c.change_type as keyof typeof counts]++
    }
    return counts
  }, [pendingChanges])

  // 검색 조건 프리셋 (localStorage)
  type Preset = { name: string; tree: FilterTree }
  const PRESET_KEY = 'fat_policy_presets'
  const [presets, setPresets] = useState<Preset[]>(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') } catch { return [] }
  })
  const [presetNameInput, setPresetNameInput] = useState('')
  const [showPresetInput, setShowPresetInput] = useState(false)
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false)
  // 드롭다운 위치는 열 때 측정해 저장 (렌더 중 ref 접근 회피)
  const [presetMenuPos, setPresetMenuPos] = useState<{ top: number; right: number } | null>(null)
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

  const deviceNameMap = useMemo(
    () => new Map(devices.map(d => [d.id, d.name])),
    [devices]
  )

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
          id: generateId(),
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
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // 자동 사용이력 수집이 실패했을 때, Deletion Workflow의 "사용이력 반영" 태스크가
  // 요구하는 컬럼(Rule Name / Unused Days)에 맞춰 수동 반영용 파일을 내보낸다.
  const handleExportUsage = async () => {
    if (policies.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try {
      const exportData = policies.map(p => ({
        'Vsys': p.vsys,
        'Rule Name': p.rule_name,
        'Last Hit Date': p.last_hit_date,
        'Unused Days': daysSinceHit(p.last_hit_date),
      }))
      await exportToExcel(exportData, '사용이력_반영용')
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


  const handleRowClick = useCallback((event: RowClickedEvent<Policy>) => {
    if (editMode) return // 편집모드에서는 행 클릭이 상세 모달 대신 셀 편집/체크박스 선택에 쓰임
    if (event.data) setDetailModal(event.data)
  }, [editMode])

  // 편집모드면 기존 정책(양수 id)/신규 생성행(음수 id) 모두 그리드에서 직접 편집 가능.
  const isRowEditable = useCallback(
    (params: { data?: EditablePolicyRow }) => editMode && params.data?.id != null,
    [editMode]
  )

  const columnDefs = useMemo<ColDef<Policy>[]>(() => [
    {
      headerName: '장비명',
      width: 120,
      suppressSizeToFit: true,
      pinned: 'left',
      valueGetter: (p) => deviceNameMap.get(p.data?.device_id ?? -1) ?? String(p.data?.device_id ?? '-'),
      cellRenderer: (p: { value: string }) => (
        <span className="text-[11px] font-semibold text-ds-tertiary font-mono">{p.value}</span>
      ),
    },
    {
      field: 'seq', headerName: '#', width: 52, suppressSizeToFit: true,
      cellRenderer: (p: { value: number }) => (
        <span className="font-mono text-xs text-ds-on-surface-variant">{p.value}</span>
      ),
    },
    {
      field: 'rule_name', headerName: '정책명', width: 220, maxWidth: 260, suppressSizeToFit: true,
      cellRenderer: (p: { value: string; data: Policy }) => {
        const key = `${p.data.device_id}_${p.data.rule_name}`
        const log = changeLogMap.get(key)
        const meta = log ? (CHANGE_META[log.action] ?? { label: log.action, cls: 'bg-gray-100 text-gray-500' }) : null
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-xs font-semibold text-ds-on-surface truncate">{p.value ?? '-'}</span>
            {editMode && (
              <button
                type="button"
                title="상세보기(필드 편집)"
                onClick={(e) => { e.stopPropagation(); setDetailModal(p.data) }}
                className="shrink-0 text-ds-on-surface-variant hover:text-ds-tertiary transition-colors"
              >
                <Eye className="w-3 h-3" />
              </button>
            )}
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
      field: 'action', headerName: '액션', width: 72, suppressSizeToFit: true,
      cellRenderer: (p: { value: string }) => {
        const cls = ACTION_BADGE[p.value?.toLowerCase()] ?? 'bg-ds-surface-container text-ds-on-surface-variant'
        return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${cls}`}>{p.value}</span>
      },
    },
    {
      field: 'enable', headerName: '활성', width: 62, suppressSizeToFit: true,
      cellRenderer: (p: { value: boolean }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${p.value ? 'bg-green-100 text-green-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
          {p.value ? '활성' : '비활성'}
        </span>
      ),
    },
    { field: 'source',      headerName: '출발지', width: 180, minWidth: 160, maxWidth: 260, editable: isRowEditable, cellRenderer: (p: { value: string }) => <InlineTagCell value={p.value} /> },
    { field: 'destination', headerName: '목적지', width: 180, minWidth: 160, maxWidth: 260, editable: isRowEditable, cellRenderer: (p: { value: string }) => <InlineTagCell value={p.value} /> },
    { field: 'service',     headerName: '서비스', width: 150, minWidth: 130, maxWidth: 220, editable: isRowEditable, cellRenderer: (p: { value: string }) => <InlineTagCell value={p.value} /> },
    {
      field: 'user', headerName: '사용자', width: 110, minWidth: 100, maxWidth: 160, suppressSizeToFit: true, editable: isRowEditable,
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
    { field: 'application', headerName: '애플리케이션', width: 130, suppressSizeToFit: true, hide: !editMode, editable: isRowEditable },
    { field: 'from_zone', headerName: 'from(존)', width: 110, suppressSizeToFit: true, hide: !editMode, editable: isRowEditable },
    { field: 'to_zone', headerName: 'to(존)', width: 110, suppressSizeToFit: true, hide: !editMode, editable: isRowEditable },
    { field: 'log_setting', headerName: 'log-setting', width: 120, suppressSizeToFit: true, hide: !editMode },
    {
      field: 'security_profile', headerName: '보안 프로파일', width: 130, suppressSizeToFit: true,
      cellRenderer: (p: { value: string | null }) =>
        p.value ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">{p.value}</span> : <span className="text-[11px] text-ds-on-surface-variant">-</span>,
    },
    {
      field: 'category', headerName: '카테고리', width: 100, suppressSizeToFit: true,
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
      field: 'last_hit_date', headerName: '마지막 사용일', width: 130, minWidth: 120, suppressSizeToFit: true,
      cellRenderer: (p: { value: string | null }) => <LastHitCell value={p.value} />,
    },
    {
      field: 'hit_count', headerName: '히트 횟수', width: 100, suppressSizeToFit: true,
      cellRenderer: (p: { value: number | null }) => (
        <span className="text-[11px] text-ds-on-surface-variant">{p.value ?? '-'}</span>
      ),
    },
    { field: 'vsys', headerName: 'VSYS', width: 72, hide: true },
  ], [deviceNameMap, changeLogMap, editMode, isRowEditable])

  const allConditions = filterTree.flatMap(g => g.conditions)
  const hasConditions = allConditions.some(c => c.value.trim())

  return (
    <div className="flex flex-col gap-3">
      {/* Page header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">Policies</h1>
        <div className="flex items-center gap-2">
          {editMode && (
            <>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold text-ds-tertiary bg-ds-tertiary/10 rounded-lg border border-ds-tertiary/20 hover:bg-ds-tertiary/15 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 새 정책 붙여넣기
              </button>
              <button
                onClick={() => setShowFormModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 새 정책 추가(폼)
              </button>
              <button
                onClick={() => setShowModifyModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> 정책 수정(일괄)
              </button>
              <button
                onClick={() => setShowMoveDialog(true)}
                disabled={selectedPolicyIds.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors disabled:opacity-50"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" /> 선택 이동 ({selectedPolicyIds.length})
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedPolicyIds.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-ds-error bg-ds-error/5 rounded-lg border border-ds-error/15 hover:bg-ds-error/10 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" /> 선택 삭제 ({selectedPolicyIds.length})
              </button>
            </>
          )}
          <button
            onClick={() => setEditMode((v) => !v)}
            disabled={!editDeviceId}
            title={editDeviceId ? undefined : '편집모드는 장비를 1개만 선택했을 때 사용할 수 있습니다.'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg border transition-colors disabled:opacity-40 ${
              editMode ? 'text-ds-tertiary bg-ds-tertiary/10 border-ds-tertiary/20' : 'text-ds-on-surface-variant bg-ds-surface-container-low border-ds-outline-variant/10 hover:text-ds-on-surface'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" /> {editMode ? '편집모드 종료' : '편집모드'}
          </button>
          <DeviceSelector disabled={editMode} />
        </div>
      </div>
      {editMode && (
        <p className="text-[12px] text-amber-600 -mt-2 shrink-0">
          편집모드에서 만든 변경사항은 CLI 텍스트로만 생성되며 실제 장비나 DB에는 반영되지 않습니다. 검토 후 직접 실행하세요.
        </p>
      )}

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
                  onClick={() => {
                    const r = presetBtnRef.current?.getBoundingClientRect()
                    setPresetMenuPos(r ? { top: r.bottom + 4, right: window.innerWidth - r.right } : null)
                    setPresetDropdownOpen(o => !o)
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
                >
                  <Bookmark className="w-3 h-3" /> 프리셋
                </button>
                {presetDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setPresetDropdownOpen(false)} />
                    <div
                      className="fixed z-50 bg-white border border-ds-outline-variant/20 rounded-lg shadow-xl min-w-44 py-1"
                      style={{ top: presetMenuPos?.top ?? 0, right: presetMenuPos?.right ?? 0 }}
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
            {policies.length > 0 && (
              <button
                onClick={handleExportUsage}
                title="자동 사용이력 수집이 실패했을 때, Deletion Workflow의 사용이력 반영 태스크에 그대로 업로드할 수 있는 형식(Rule Name / Unused Days)으로 내보냅니다."
                className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
              >
                <Download className="w-3 h-3" /> 사용이력
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
        <AgGridWrapper<EditablePolicyRow>
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={editMode ? mergedPolicies : policies}
          getRowId={rowIdFromId}
          height="800px"
          loading={searchQuery.isFetching}
          loadingLabel="정책 검색 중…"
          noRowsText="장비를 선택하고 검색 버튼을 클릭하세요."
          defaultColDefOverride={GRID_DEFAULT_COL_DEF_OVERRIDE}
          fitColumns
          quickFilterText={quickFilterText}
          onRowClicked={handleRowClick}
          rowHeight={34}
          rowSelection={editMode ? { mode: 'multiRow', checkboxes: true, headerCheckbox: true } : undefined}
          onSelectionChanged={editMode ? (rows) => setSelectedPolicyIds(rows.map((r) => r.id)) : undefined}
          onCellValueChanged={editMode ? handleCellValueChanged : undefined}
          getRowStyle={editMode ? (p) => {
            const status = p.data?._pendingStatus
            if (status === 'new') return { backgroundColor: 'rgba(16,185,129,0.10)', textDecoration: 'none' }
            if (status === 'modified') return { backgroundColor: 'rgba(245,158,11,0.10)', textDecoration: 'none' }
            if (status === 'deleted') return { backgroundColor: 'rgba(239,68,68,0.10)', textDecoration: 'line-through' }
            if (status === 'moved') return { backgroundColor: 'rgba(59,130,246,0.10)', textDecoration: 'none' }
            return undefined
          } : undefined}
          skipAutoSizeOnDataChange={editMode}
        />
      </div>

      {editMode && editDeviceId && (
        <div className="card rounded-xl px-4 py-3 flex items-center gap-3 shrink-0 sticky bottom-4 shadow-lg">
          <span className="text-[13px] font-semibold text-ds-on-surface">
            대기중 변경사항: 생성 {pendingCounts.create} · 수정 {pendingCounts.modify} · 삭제 {pendingCounts.delete} · 이동 {pendingCounts.move}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {pendingChanges.length > 0 && (
              <button onClick={handleClearPending} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant hover:text-ds-error transition-colors">
                <RotateCcw className="w-3.5 h-3.5" /> 전체 취소
              </button>
            )}
            <button
              onClick={handleGenerateCli}
              disabled={pendingChanges.length === 0 || planLoading}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
            >
              <Terminal className="w-3.5 h-3.5" /> {planLoading ? 'CLI 생성 중…' : 'CLI 생성'}
            </button>
          </div>
        </div>
      )}

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
          editable={editMode}
          onFieldChange={(field, newValue) => {
            const oldValue = String((detailModal as unknown as Record<string, string>)[field] ?? '')
            applyFieldChange(detailModal.id, field, oldValue, newValue)
            setDetailModal((prev) => prev ? { ...prev, [field]: newValue } : prev)
          }}
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

      {showCreateModal && editDeviceId && (
        <CreatePolicyModal
          deviceId={editDeviceId}
          onClose={() => setShowCreateModal(false)}
          onCreated={refetchPendingChanges}
        />
      )}

      {showFormModal && editDeviceId && (
        <NewPolicyFormModal
          deviceId={editDeviceId}
          onClose={() => setShowFormModal(false)}
          onCreated={refetchPendingChanges}
        />
      )}

      {showModifyModal && editDeviceId && (
        <ModifyPolicyModal
          deviceId={editDeviceId}
          onClose={() => setShowModifyModal(false)}
          onApplied={refetchPendingChanges}
        />
      )}

      {showMoveDialog && editDeviceId && (
        <MoveExistingDialog
          deviceId={editDeviceId}
          policyIds={selectedPolicyIds}
          pendingChanges={pendingChanges}
          onClose={() => setShowMoveDialog(false)}
          onMoved={() => { refetchPendingChanges(); setSelectedPolicyIds([]) }}
        />
      )}

      {planResult && (
        <Dialog open onOpenChange={(open) => !open && setPlanResult(null)}>
          <DialogContent className="max-w-4xl bg-ds-surface-container-lowest max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-headline text-ds-on-surface">생성된 CLI</DialogTitle>
            </DialogHeader>
            <PlanResultPanel plan={planResult} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
// refresh
 
