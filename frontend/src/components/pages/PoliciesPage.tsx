import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useExportAction } from '@/hooks/useExportAction'
import { errorMessage } from '@/lib/errorMessage'
import { X, Search, Pencil, RotateCcw, PanelRightOpen } from 'lucide-react'
import type { CellValueChangedEvent, ColDef, RowClickedEvent } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { rowIdFromId } from '@/lib/utils'
import { listDevices } from '@/api/devices'
import {
  searchPolicies, exportToExcel,
  type Policy, type PolicySearchRequest,
} from '@/api/firewall'
import { daysSinceHit } from '@/lib/utils'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'
import { PolicyHistoryModal } from '@/components/shared/PolicyHistoryModal'
import { PolicyDetailModal } from '@/components/shared/PolicyDetailModal'
import {
  buildRequestFromFilterTree, conditionsToFilterTree, generateId,
  type FilterTree,
} from '@/components/shared/queryBuilderModel'
import { DeviceSelector } from '@/components/shared/DeviceSelector'
import { useDeviceStore } from '@/store/deviceStore'
import { usePolicySearchStore } from '@/store/policySearchStore'
import { queryKeys } from '@/api/queryKeys'
import { diffMultiValueField, isFieldDiffEmpty } from '@/lib/policyDiff'
import {
  listPendingChanges, addPendingChange, updatePendingChange, removePendingChange, clearPendingChanges, planBulkPolicy, getPreviewOrder,
  cleanupOrphanNewObjects, verifyAgainstDevice, revertPolicyPendingChanges,
  type BulkPolicyPlanResponse, type PreviewPolicyRow, type PolicyVerifyResult, type PendingPolicyChange,
} from '@/api/policyBuilder'
import { CreatePolicyModal } from '@/components/pages/policy-builder/CreatePolicyModal'
import { NewPolicyFormModal } from '@/components/pages/policy-builder/NewPolicyFormModal'
import { setPoliciesDisabled } from '@/components/pages/policy-builder/disableToggle'
import { usePendingUndo } from '@/components/pages/policy-builder/usePendingUndo'
import { ModifyPolicyModal } from '@/components/pages/policy-builder/ModifyPolicyModal'
import { MoveExistingDialog } from '@/components/pages/policy-builder/MoveExistingDialog'
import { PlanResultPanel, VerifyResultPanel } from '@/components/pages/policy-builder/PlanResultPanel'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { PolicySearchToolbar } from '@/components/pages/policies/PolicySearchToolbar'
import { PolicySummaryBar, type SummaryFilter } from '@/components/pages/policies/PolicySummaryBar'
import { EditChangesPanel } from '@/components/pages/policies/EditChangesPanel'
import { InlineTagCell, LastHitCell } from '@/components/pages/policies/policyCells'
import {
  ACTION_BADGE, PENDING_STATUS_META, parseCSVTokens, formatCSVField, type PendingStatus,
} from '@/components/pages/policies/policyCellUtils'

/** 편집모드에서 그리드 필드명 ↔ 백엔드(PendingPolicyChange payload) 필드명 매핑 (diff 대상 필드).
 *  from_zone/to_zone은 Palo Alto만 수집하는 필드라 다른 벤더 정책은 항상 빈 값으로 시작함. */
const EDITABLE_FIELD_MAP: Record<string, string> = {
  source: 'source', destination: 'destination', service: 'service',
  application: 'application', user: 'source_user',
  from_zone: 'from_zone', to_zone: 'to_zone',
}

interface EditablePolicyRow extends Policy {
  _pendingStatus?: PendingStatus
}

function matchesSummary(p: Policy, filter: SummaryFilter): boolean {
  const days = daysSinceHit(p.last_hit_date)
  switch (filter) {
    case 'allow': return p.action?.toLowerCase() === 'allow'
    case 'deny': return ['deny', 'drop', 'reject'].includes(p.action?.toLowerCase() ?? '')
    case 'disabled': return !p.enable
    case 'stale': return days !== null && days >= 90
    case 'noHit': return !p.last_hit_date
  }
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
      const policyRes = await searchPolicies(searchRequest!)
      return { policyRes }
    },
  })

  useEffect(() => {
    if (searchQuery.error) toast.error(errorMessage(searchQuery.error, '정책 검색에 실패했습니다. 조건을 확인하고 다시 검색하세요.'))
  }, [searchQuery.error])

  const policies = useMemo(() => searchQuery.data?.policyRes.policies ?? [], [searchQuery.data])
  const validObjectNames = useMemo(
    () => new Set(searchQuery.data?.policyRes.valid_object_names ?? []),
    [searchQuery.data]
  )

  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)
  const [historyModal, setHistoryModal] = useState<{ deviceId: number; ruleName: string } | null>(null)
  const [detailModal, setDetailModal] = useState<Policy | null>(null)
  const [quickFilterInput, setQuickFilterInput] = useState(quickFilterText)
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const { confirm, ConfirmDialogElement } = useConfirm()

  // 결과 내 검색은 입력 즉시(디바운스) 반영한다 — 별도 Enter/버튼 없이 타이핑만으로 그리드가 좁혀진다.
  useEffect(() => {
    const t = setTimeout(() => setQuickFilterText(quickFilterInput), 200)
    return () => clearTimeout(t)
  }, [quickFilterInput, setQuickFilterText])

  // 편집모드 — 단일 장비 선택 시에만 가능 (대기중 변경사항은 장비 1개 단위로 저장됨)
  const [editMode, setEditMode] = useState(false)
  const editDeviceId = deviceIds.length === 1 ? deviceIds[0] : null
  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })
  const editDevice = devices.find((d) => d.id === editDeviceId)
  const canEdit = !!editDeviceId && (editDevice?.vendor ?? '').toLowerCase() === 'paloalto'
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<number[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showFormModal, setShowFormModal] = useState(false)
  const [showModifyModal, setShowModifyModal] = useState(false)
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [planResult, setPlanResult] = useState<BulkPolicyPlanResponse | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [verifyResult, setVerifyResult] = useState<PolicyVerifyResult[] | null>(null)
  const [verifyLoading, setVerifyLoading] = useState(false)
  // 편집 내용(생성/수정/삭제/이동)을 대기중 변경사항에 반영하고 그리드가 최신 배치 순서를
  // 다시 조회하는 동안 표시할 로딩 상태 — 그리드는 마운트된 채 유지하고 스피너만 오버레이한다.
  const [applyingChanges, setApplyingChanges] = useState(false)

  // 편집모드 중 장비 선택이 1개가 아니게 바뀌면(예: 다른 화면에서 다시 진입) 상태가 꼬이지 않도록 자동 종료
  useEffect(() => {
    if (editMode && !editDeviceId) setEditMode(false)
  }, [editMode, editDeviceId])

  const pendingChangesQuery = useQuery({
    queryKey: queryKeys.policyBuilderPendingChanges(editDeviceId),
    queryFn: () => listPendingChanges(editDeviceId!),
    enabled: canEdit,
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

  // CLI 생성 전 사전 위험 요약 — 변경 계획이 바뀔 때마다 /plan을 읽기 전용으로 한 번 계산해 충돌·경고 건수만 쓴다.
  const planSignature = pendingChanges.map((c) => c.id).join(',')
  const planRiskQuery = useQuery({
    queryKey: queryKeys.policyBuilderPlanRisk(editDeviceId, planSignature),
    queryFn: async () => {
      const plan = await planBulkPolicy(editDeviceId!)
      return { conflicts: plan.conflicts.length, warnings: plan.warnings.length }
    },
    enabled: editMode && canEdit && pendingChanges.some((c) => c.change_type !== 'new_object'),
    staleTime: 60_000,
  })

  // invalidateQueries는 기본적으로 활성 쿼리를 즉시 다시 조회하고, 그 refetch가 끝나야 resolve되는
  // 프라미스를 반환한다 — 호출부에서 await하면 "그리드가 최신 상태로 바뀔 때까지" 기다릴 수 있다.
  const refetchPendingChanges = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.policyBuilderPendingChanges(editDeviceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.policyBuilderPreviewOrder(editDeviceId) }),
  ])

  // 편집 액션(셀 편집, 모달 제출 등) 공용 래퍼 — 액션 실행 중 + 그리드가 최신 배치 순서를
  // 다시 받아올 때까지 로딩 오버레이를 띄운다.
  const runEditAction = async (action: () => Promise<unknown>) => {
    setApplyingChanges(true)
    try {
      await action()
      await refetchPendingChanges()
    } catch (e) {
      toast.error(errorMessage(e, '변경 계획에 반영하지 못했습니다. 잠시 후 다시 시도하세요.'))
    } finally {
      setApplyingChanges(false)
    }
  }

  const { canUndo, undoLast } = usePendingUndo({
    active: editMode, deviceId: editDeviceId,
    ready: pendingChangesQuery.isSuccess && !pendingChangesQuery.isFetching,
    pendingChanges, runAction: runEditAction,
  })

  // 생성/수정/이동 모달은 자체적으로 pending change 추가를 이미 끝낸 뒤 이 콜백을 호출한다 —
  // 여기서는 그리드가 최신 배치 순서를 다시 받아올 때까지만 로딩 오버레이를 띄운다.
  const handleModalApplied = () => {
    setApplyingChanges(true)
    refetchPendingChanges().finally(() => setApplyingChanges(false))
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
      runEditAction(() => updatePendingChange(editDeviceId, change.id, { [backendField]: newValue }))
      return
    }
    const diff = diffMultiValueField(oldValue, newValue)
    if (isFieldDiffEmpty(diff)) return
    runEditAction(() => addPendingChange(editDeviceId, {
      change_type: 'modify', target_policy_id: rowId,
      client_key: `modify-${rowId}-${gridField}-${Date.now()}`,
      payload: { [backendField]: diff },
    }))
  }, [editDeviceId, pendingChangesQuery.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCellValueChanged = useCallback((event: CellValueChangedEvent<EditablePolicyRow>) => {
    if (!event.data || !event.colDef.field) return
    applyFieldChange(event.data.id, event.colDef.field, String(event.oldValue ?? ''), String(event.newValue ?? ''))
  }, [applyFieldChange])

  const handleDeleteSelected = async () => {
    if (!editDeviceId || selectedPolicyIds.length === 0) return
    // 이미 삭제 대기중인 행을 다시 선택해 삭제하면 delete pending change가 중복 생성되어
    // CLI에 동일한 delete 명령이 두 번 나온다 — 대상에서 제외한다.
    const targetIds = selectedPolicyIds.filter((id) => !deletedRowIds.has(id))
    const skipped = selectedPolicyIds.length - targetIds.length
    if (targetIds.length === 0) {
      toast.warning('선택한 정책이 모두 이미 삭제 예정입니다.')
      return
    }
    const ok = await confirm({
      title: `선택한 정책 ${targetIds.length}건을 삭제 대상으로 추가할까요?`,
      description: '장비에서 바로 삭제되지는 않으며, 변경 계획에 추가됩니다. 변경 목록에서 언제든 되돌릴 수 있습니다.',
      confirmLabel: '삭제 대상에 추가',
    })
    if (!ok) return
    const timestamp = Date.now()
    setApplyingChanges(true)
    try {
      const removedCreateChangeIds: number[] = []
      await Promise.all(targetIds.map(async (policyId) => {
        if (policyId < 0) {
          // 신규 생성행(음수 id) — 아직 실제 정책이 아니므로 delete가 아니라 create 변경사항 자체를 취소한다.
          const change = pendingChangesQuery.data?.find((c) => c.change_type === 'create' && -c.id === policyId)
          if (change) {
            await removePendingChange(editDeviceId, change.id)
            removedCreateChangeIds.push(change.id)
          }
          return
        }
        await addPendingChange(editDeviceId, {
          change_type: 'delete', target_policy_id: policyId, client_key: `delete-${policyId}-${timestamp}`, payload: {},
        })
      }))
      if (removedCreateChangeIds.length > 0) {
        const remainingChanges = (pendingChangesQuery.data ?? []).filter((c) => !removedCreateChangeIds.includes(c.id))
        await cleanupOrphanNewObjects(editDeviceId, remainingChanges)
      }
      toast.success(`정책 ${targetIds.length}건 삭제가 변경 계획에 추가되었습니다.${skipped > 0 ? ` (이미 삭제 예정 ${skipped}건 제외)` : ''}`)
      clearSelection()
      await refetchPendingChanges()
    } catch (e) {
      toast.error(errorMessage(e, '삭제 대상 추가에 실패했습니다. 변경 목록을 확인한 뒤 다시 시도하세요.'))
    } finally {
      setApplyingChanges(false)
    }
  }

  // 앱 상태와 그리드의 체크박스 선택을 함께 비운다 — 상태만 비우면 체크가 남아 선택 수와 어긋난다.
  const clearSelection = () => {
    setSelectedPolicyIds([])
    gridRef.current?.gridApi?.deselectAll()
  }

  // 선택 정책 중 하나라도 활성이면 활성 정책을 모두 비활성화, 전부 비활성이면 모두 활성화한다.
  const handleToggleDisable = async () => {
    if (!editDeviceId) return
    const rows = mergedPolicies.filter((r) => selectedPolicyIds.includes(r.id) && r.id > 0 && !deletedRowIds.has(r.id))
    if (rows.length === 0) {
      toast.warning('비활성화할 기존 정책을 선택하세요. (신규 생성행·삭제 예정 정책은 제외됩니다)')
      return
    }
    const disable = rows.some((r) => r.enable !== false)
    const ids = rows.filter((r) => (r.enable !== false) === disable).map((r) => r.id)
    const ok = await confirm({
      title: `정책 ${ids.length}건을 ${disable ? '비활성화' : '활성화'} 대상으로 추가할까요?`,
      description: '장비에서 바로 바뀌지는 않으며, 변경 계획에 추가됩니다. 변경 목록에서 언제든 되돌릴 수 있습니다.',
      confirmLabel: disable ? '비활성화 대상에 추가' : '활성화 대상에 추가',
    })
    if (!ok) return
    runEditAction(async () => {
      await setPoliciesDisabled(editDeviceId, ids, disable, pendingChanges)
      toast.success(`정책 ${ids.length}건 ${disable ? '비활성화' : '활성화'}가 변경 계획에 추가되었습니다.`)
      clearSelection()
    })
  }

  // 컬럼 정의(useMemo)에서 최신 핸들러를 부르기 위한 ref — 행 1건의 모든 대기중 변경사항을 취소한다.
  const revertRowRef = useRef<(policyId: number) => void>(() => {})
  useEffect(() => {
    revertRowRef.current = (policyId) => {
      if (!editDeviceId) return
      runEditAction(async () => {
        await revertPolicyPendingChanges(editDeviceId, policyId)
        await cleanupOrphanNewObjects(editDeviceId, pendingChanges.filter((c) => c.target_policy_id !== policyId))
      })
    }
  })

  const revertSingleChange = (change: PendingPolicyChange) => {
    if (!editDeviceId) return
    runEditAction(async () => {
      await removePendingChange(editDeviceId, change.id)
      await cleanupOrphanNewObjects(editDeviceId, pendingChanges.filter((c) => c.id !== change.id))
    })
  }

  const jumpToRow = (policyId: number) => {
    const api = gridRef.current?.gridApi
    const node = api?.getRowNode(String(policyId))
    if (!api || !node) { toast.info('현재 그리드에서 해당 정책 행을 찾을 수 없습니다.'); return }
    api.ensureNodeVisible(node, 'middle')
    api.flashCells({ rowNodes: [node] })
  }

  const toggleEditMode = () => {
    if (editMode) {
      const remaining = pendingChanges.filter((c) => c.change_type !== 'new_object').length
      if (remaining > 0) toast.info(`변경 계획 ${remaining}건이 저장되어 있습니다. 다시 편집모드에 들어오면 이어서 작업할 수 있습니다.`)
    } else {
      setPanelOpen(true)
      // 편집모드는 그리드 높이가 핵심이라 상세 검색 패널은 접는다(조건은 칩으로 계속 보인다).
      setFiltersOpen(false)
    }
    setEditMode((v) => !v)
  }

  const handleOpenMove = () => {
    // 이미 삭제 대기중인 행은 이동 대상에서 제외 — 삭제 예정 정책의 위치를 옮기는 move
    // pending change가 쌓이는 것을 막는다.
    const remaining = selectedPolicyIds.filter((id) => !deletedRowIds.has(id))
    if (remaining.length === 0) {
      toast.warning('선택한 정책이 모두 삭제 예정이라 이동할 수 없습니다.')
      return
    }
    if (remaining.length < selectedPolicyIds.length) {
      toast.info(`삭제 예정인 정책 ${selectedPolicyIds.length - remaining.length}건은 이동 대상에서 제외했습니다.`)
    }
    setSelectedPolicyIds(remaining)
    setShowMoveDialog(true)
  }

  const handleGenerateCli = async () => {
    if (!editDeviceId) return
    setPlanLoading(true)
    try {
      const result = await planBulkPolicy(editDeviceId)
      setPlanResult(result)
    } catch (e) {
      toast.error(errorMessage(e, 'CLI를 생성하지 못했습니다. 변경 목록을 확인하고 다시 시도하세요.'))
    } finally {
      setPlanLoading(false)
    }
  }

  const handleVerifyAgainstDevice = async () => {
    if (!editDeviceId) return
    setVerifyLoading(true)
    try {
      const result = await verifyAgainstDevice(editDeviceId)
      setVerifyResult(result)
    } catch (e) {
      toast.error(errorMessage(e, '장비와 비교하지 못했습니다. 장비 접속 상태를 확인하고 다시 시도하세요.'))
    } finally {
      setVerifyLoading(false)
    }
  }

  const handleClearPending = async () => {
    if (!editDeviceId) return
    const ok = await confirm({
      title: `변경 계획 ${pendingChanges.filter((c) => c.change_type !== 'new_object').length}건을 모두 취소할까요?`,
      description: '저장된 변경 계획이 삭제되며 되돌릴 수 없습니다. 장비에는 영향이 없습니다.',
      confirmLabel: '모두 취소', variant: 'destructive',
    })
    if (!ok) return
    setApplyingChanges(true)
    try {
      await clearPendingChanges(editDeviceId)
      toast.success('변경 계획을 모두 초기화했습니다.')
      await refetchPendingChanges()
    } catch (e) {
      toast.error(errorMessage(e, '변경 계획을 초기화하지 못했습니다. 다시 시도하세요.'))
    } finally {
      setApplyingChanges(false)
    }
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

  // 이미 삭제 대기중으로 표시된 행(기존 정책) — 삭제/이동 재선택 시 중복 pending change 방지에 사용.
  const deletedRowIds = useMemo(
    () => new Set(mergedPolicies.filter((r) => r._pendingStatus === 'deleted').map((r) => r.id)),
    [mergedPolicies]
  )

  const pendingCounts = useMemo(() => {
    const counts = { create: 0, modify: 0, delete: 0, move: 0, disable: 0 }
    for (const c of pendingChanges) {
      if (c.change_type === 'create') {
        counts.create++
        // 신규 생성행(음수 id)의 "선택 이동"은 별도 move 변경사항을 만들지 않고 create 변경사항의
        // 배치 위치(position/reference_policy_id)만 갱신한다 — 기본값(bottom/null)에서 바뀌었다면
        // 이동 예약이 걸린 것이므로 "이동" 카운트에도 반영한다.
        const { position, reference_policy_id } = c.payload as { position?: string; reference_policy_id?: number | null }
        if (position !== 'bottom' || reference_policy_id != null) counts.move++
      }
      else if (c.change_type === 'new_object') continue
      else if (c.change_type in counts) counts[c.change_type as keyof typeof counts]++
    }
    return counts
  }, [pendingChanges])

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
    setSummaryFilter(null)
    gridRef.current?.gridApi?.setFilterModel(null)
  }

  const exportAction = useExportAction()
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
      await exportAction.run(() => exportToExcel(exportData, '방화벽정책'))
    }
    catch (e: unknown) { toast.error(errorMessage(e, '엑셀 내보내기에 실패했습니다. 다시 시도하세요.')) }
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
      await exportAction.run(() => exportToExcel(exportData, '사용이력_반영용'))
    }
    catch (e: unknown) { toast.error(errorMessage(e, '사용이력 내보내기에 실패했습니다. 다시 시도하세요.')) }
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


  const displayedPolicies = useMemo(
    () => (summaryFilter ? policies.filter((p) => matchesSummary(p, summaryFilter)) : policies),
    [policies, summaryFilter],
  )

  // 편집모드 그리드 — 장비 전체 배치 순서(mergedPolicies) 중 "검색 결과에 포함된 정책"만 보여준다.
  // 신규 생성행과 변경이 걸린 행은 검색 조건과 무관하게 항상 표시해, 계획에 든 항목이 사라지지 않게 한다.
  const { editRows, editScopeCount, editScopeDisabledCount } = useMemo(() => {
    const searchIds = searched ? new Set(policies.map((p) => p.id)) : null
    const scoped = mergedPolicies.filter((r) => !(searchIds && r.id > 0 && !r._pendingStatus && !searchIds.has(r.id)))
    const rows = summaryFilter ? scoped.filter((r) => r._pendingStatus != null || matchesSummary(r, summaryFilter)) : scoped
    return { editRows: rows, editScopeCount: scoped.length, editScopeDisabledCount: scoped.filter((r) => r.id > 0 && r.enable === false).length }
  }, [mergedPolicies, policies, searched, summaryFilter])

  const policyNameById = useMemo(() => new Map(mergedPolicies.map((r) => [r.id, r.rule_name ?? ''])), [mergedPolicies])

  const handleRowClick = useCallback((event: RowClickedEvent<Policy>) => {
    if (editMode) return // 편집모드에서는 행 클릭이 상세 모달 대신 셀 편집/체크박스 선택에 쓰임
    if (event.data) setDetailModal(event.data)
  }, [editMode])

  // 편집모드면 기존 정책(양수 id)/신규 생성행(음수 id) 모두 그리드에서 직접 편집 가능.
  // 단, 비활성 기존 정책은 셀 수정을 막는다 — 삭제·활성화·이동만 허용(수정은 활성화한 뒤에).
  const isRowEditable = useCallback(
    (params: { data?: EditablePolicyRow }) => editMode && params.data?.id != null && (params.data.id < 0 || params.data.enable !== false),
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
        <span className="text-11 font-semibold text-ds-tertiary font-mono">{p.value}</span>
      ),
    },
    {
      field: 'seq', headerName: '#', width: 52, suppressSizeToFit: true,
      cellRenderer: (p: { value: number }) => (
        <span className="font-mono text-xs text-ds-on-surface-variant tabular-nums">{p.value}</span>
      ),
    },
    {
      field: 'rule_name', headerName: '정책명', width: 220, maxWidth: 260, suppressSizeToFit: true,
      cellRenderer: (p: { value: string; data: EditablePolicyRow }) => {
        return (
          <div className="group/row flex items-center gap-1.5 min-w-0">
            {editMode && p.data?._pendingStatus && (
              <span className={`shrink-0 px-1 rounded text-11 font-bold ${PENDING_STATUS_META[p.data._pendingStatus].badge}`}>
                {PENDING_STATUS_META[p.data._pendingStatus].label}
              </span>
            )}
            <span className={`font-mono text-xs font-semibold truncate ${p.data?._pendingStatus === 'deleted' ? 'text-ds-on-surface-variant line-through' : 'text-ds-on-surface'}`}>{p.value ?? '-'}</span>
            {editMode && (
              <button
                type="button"
                title="상세보기(필드 편집)"
                aria-label={`${p.value ?? '정책'} 상세보기·필드 편집`}
                onClick={(e) => { e.stopPropagation(); setDetailModal(p.data) }}
                className="shrink-0 p-1 -m-1 text-ds-on-surface-variant hover:text-ds-tertiary transition-all opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 [.ag-row-selected_&]:opacity-100"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {editMode && p.data?._pendingStatus && p.data.id > 0 && (
              <button
                type="button"
                title="이 정책의 변경 취소"
                aria-label={`${p.value ?? '정책'}의 변경 취소`}
                onClick={(e) => { e.stopPropagation(); revertRowRef.current(p.data.id) }}
                className="shrink-0 p-1 -m-1 text-ds-on-surface-variant hover:text-ds-error transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
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
        return <span className={`inline-flex items-center px-2 py-0.5 rounded text-11 font-bold uppercase ${cls}`}>{p.value}</span>
      },
    },
    {
      field: 'enable', headerName: '활성', width: 62, suppressSizeToFit: true,
      cellRenderer: (p: { value: boolean }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-11 font-bold ${p.value ? 'bg-green-100 text-green-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
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
        if (!p.value) return <span className="text-11 text-ds-on-surface-variant">-</span>
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
        p.value ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-11 font-semibold bg-purple-100 text-purple-700">{p.value}</span> : <span className="text-11 text-ds-on-surface-variant">-</span>,
    },
    {
      field: 'category', headerName: '카테고리', width: 100, suppressSizeToFit: true,
      cellRenderer: (p: { value: string | null }) =>
        p.value ? <span className="text-11 text-ds-on-surface-variant">{p.value}</span> : <span className="text-11 text-ds-on-surface-variant">-</span>,
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
        <span className="text-11 text-ds-on-surface-variant tabular-nums">{p.value ?? '-'}</span>
      ),
    },
    { field: 'vsys', headerName: 'VSYS', width: 72, hide: true },
  ], [deviceNameMap, editMode, isRowEditable])

  const editBlockedReason = deviceIds.length !== 1
    ? '편집모드는 장비를 1개만 선택했을 때 사용할 수 있습니다.'
    : !canEdit ? '편집모드는 Palo Alto 장비에서만 사용할 수 있습니다.' : null
  const pendingLoadError = pendingChangesQuery.error ? (pendingChangesQuery.error as Error).message : null
  const deviceName = editDeviceId ? (deviceNameMap.get(editDeviceId) ?? String(editDeviceId)) : ''
  const pendingTotal = pendingChanges.filter((c) => c.change_type !== 'new_object').length
  const showPanel = editMode && !!editDeviceId && panelOpen

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="정책"
        description={searched ? `장비 ${deviceIds.length}대 대상` : '장비를 선택하고 검색하세요'}
        actions={
          <>
            <button
              onClick={toggleEditMode}
              disabled={!canEdit && !editMode}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-60 ${
                editMode ? 'text-amber-900 bg-amber-100 border-amber-300' : 'text-ds-on-surface-variant bg-ds-surface-container-low border-ds-outline-variant/10 hover:text-ds-on-surface'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" /> {editMode ? '편집모드 종료' : '편집모드'}
            </button>
            {!editMode && canEdit && pendingTotal > 0 && (
              <button
                onClick={toggleEditMode}
                title="저장된 변경 계획이 있습니다. 편집모드에서 이어서 작업할 수 있습니다."
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-colors"
              >
                {`변경 계획 ${pendingTotal}건 대기 중`}
              </button>
            )}
            <span title={editMode ? '편집모드 중에는 장비를 바꿀 수 없습니다. 먼저 편집모드를 종료하세요.' : undefined}>
              <DeviceSelector disabled={editMode} />
            </span>
          </>
        }
      />
      {!editMode && editBlockedReason && deviceIds.length > 0 && (
        <p className="text-11 text-ds-on-surface-variant -mt-2 shrink-0">{editBlockedReason}</p>
      )}

      <PolicySearchToolbar
        filterTree={filterTree}
        onFilterTreeChange={setFilterTree}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        hasResults={policies.length > 0}
        onExport={handleExport}
        onExportUsage={handleExportUsage}
        exporting={exportAction.busy}
        onReset={handleReset}
        onSearch={handleSearch}
        searchDisabled={deviceIds.length === 0}
        searching={searchQuery.isFetching}
      />

      {summary && <PolicySummaryBar summary={summary} active={summaryFilter} onChange={setSummaryFilter} />}

      <div className="flex items-start gap-3">
        <div className={`card rounded-xl overflow-hidden min-w-0 flex-1 ${editMode ? 'border-amber-300/70' : ''}`}>
          {editMode && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-11 text-amber-900">
              <span className="font-bold">편집모드</span>
              <span className="font-mono">{deviceName}</span>
              <span className="tabular-nums">
                · {searched
                  ? `검색 결과 ${editScopeCount.toLocaleString()}건`
                  : `장비 전체 ${editScopeCount.toLocaleString()}건`}
              </span>
              {editScopeDisabledCount > 0 && (
                <span className="tabular-nums font-semibold">
                  · 비활성 {editScopeDisabledCount.toLocaleString()}건은 삭제·활성화·이동만 가능 (셀 수정 불가)
                </span>
              )}
              {!showPanel && (
                <button
                  type="button"
                  onClick={() => setPanelOpen(true)}
                  className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded font-semibold hover:bg-amber-100"
                >
                  <PanelRightOpen className="w-3.5 h-3.5" /> 변경 목록 열기 <span className="tabular-nums">({pendingTotal})</span>
                </button>
              )}
            </div>
          )}
          {searched && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-ds-outline-variant/10 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ds-on-surface-variant pointer-events-none" />
                <input
                  type="text"
                  value={quickFilterInput}
                  onChange={e => setQuickFilterInput(e.target.value)}
                  aria-label="결과 내 검색"
                  placeholder="결과 내 검색…"
                  className="w-full pl-8 pr-8 py-1.5 text-xs bg-ds-surface-container-low border border-ds-outline-variant/20 rounded-lg focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary placeholder:text-ds-on-surface-variant"
                />
                {quickFilterInput && (
                  <button
                    onClick={() => setQuickFilterInput('')}
                    aria-label="결과 내 검색어 지우기"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ds-on-surface-variant hover:text-ds-on-surface transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {summaryFilter && (
                <button onClick={() => setSummaryFilter(null)} className="shrink-0 flex items-center gap-1 text-11 font-semibold text-ds-tertiary px-2 py-1 rounded hover:bg-ds-tertiary/10">
                  요약 필터 해제 <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <AgGridWrapper<EditablePolicyRow>
            ref={gridRef}
            columnDefs={columnDefs}
            rowData={editMode ? editRows : displayedPolicies}
            getRowId={rowIdFromId}
            height={editMode ? 'calc(100vh - 330px)' : 'calc(100vh - 300px)'}
            loading={editMode ? applyingChanges : searchQuery.isFetching}
            loadingLabel={editMode ? '변경사항 적용 중…' : '정책 검색 중…'}
            noRowsText="장비를 선택하고 검색 버튼을 클릭하세요."
            defaultColDefOverride={GRID_DEFAULT_COL_DEF_OVERRIDE}
            fitColumns
            quickFilterText={quickFilterText}
            onRowClicked={handleRowClick}
            rowHeight={34}
            rowSelection={editMode ? { mode: 'multiRow', checkboxes: true, headerCheckbox: true } : undefined}
            onSelectionChanged={editMode ? (rows) => setSelectedPolicyIds(rows.map((r) => r.id)) : undefined}
            onCellValueChanged={editMode ? handleCellValueChanged : undefined}
            getRowStyle={editMode ? (p): Record<string, string> | undefined => {
              const status = p.data?._pendingStatus
              // 비활성 기존 정책은 수정할 수 없다는 신호로 옅은 회색 바탕을 준다(대기중 변경이 있으면 그 틴트가 우선).
              if (!status) return p.data && p.data.id > 0 && p.data.enable === false ? { backgroundColor: 'rgba(169, 180, 185, 0.14)' } : undefined
              return { backgroundColor: PENDING_STATUS_META[status].tint, textDecoration: status === 'deleted' ? 'line-through' : 'none' }
            } : undefined}
            skipAutoSizeOnDataChange={editMode}
          />
        </div>

        {showPanel && editDeviceId && (
          <EditChangesPanel
            deviceName={deviceName}
            changes={pendingChanges}
            nameById={policyNameById}
            counts={pendingCounts}
            selectedCount={selectedPolicyIds.length}
            canUndo={canUndo}
            onUndo={() => void undoLast()}
            onRevertChange={revertSingleChange}
            onJumpTo={jumpToRow}
            onClearAll={handleClearPending}
            onVerify={handleVerifyAgainstDevice}
            onGenerate={handleGenerateCli}
            verifyLoading={verifyLoading}
            planLoading={planLoading}
            loadError={pendingLoadError}
            risk={planRiskQuery.isError ? 'error' : planRiskQuery.isFetching ? 'loading' : planRiskQuery.data ?? null}
            onCollapse={() => setPanelOpen(false)}
            menuProps={{
              selectedCount: selectedPolicyIds.length,
              onCreateForm: () => setShowFormModal(true),
              onCreatePaste: () => setShowCreateModal(true),
              onModify: () => setShowModifyModal(true),
              onMove: handleOpenMove,
              onDelete: handleDeleteSelected,
              onToggleDisable: handleToggleDisable,
            }}
          />
        )}
      </div>

      {ConfirmDialogElement}

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
          editable={editMode && detailModal.enable !== false}
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
          onCreated={handleModalApplied}
        />
      )}

      {showFormModal && editDeviceId && (
        <NewPolicyFormModal
          deviceId={editDeviceId}
          onClose={() => setShowFormModal(false)}
          onCreated={handleModalApplied}
        />
      )}

      {showModifyModal && editDeviceId && (
        <ModifyPolicyModal
          deviceId={editDeviceId}
          onClose={() => setShowModifyModal(false)}
          onApplied={handleModalApplied}
        />
      )}

      {showMoveDialog && editDeviceId && (
        <MoveExistingDialog
          deviceId={editDeviceId}
          policyIds={selectedPolicyIds}
          pendingChanges={pendingChanges}
          onClose={() => setShowMoveDialog(false)}
          onMoved={() => { handleModalApplied(); clearSelection() }}
        />
      )}

      {(planResult || verifyResult) && (
        <Dialog open onOpenChange={(open) => { if (!open) { setPlanResult(null); setVerifyResult(null) } }}>
          {/* 삽입 충돌/명령어가 많아지면 금방 내용이 넘쳐 헤더까지 스크롤해야 하는 문제가 있었다 —
              높이를 뷰포트 기준으로 고정하고 헤더는 그대로 둔 채 본문만 스크롤되게 한다. */}
          <DialogContent className="max-w-6xl w-[92vw] h-[88vh] bg-ds-surface-container-lowest flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle className="font-headline text-ds-on-surface">{planResult ? '생성된 CLI' : '실제 장비 검증 결과'}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
              {planResult && <PlanResultPanel plan={planResult} />}
              {verifyResult && <VerifyResultPanel results={verifyResult} />}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
 
