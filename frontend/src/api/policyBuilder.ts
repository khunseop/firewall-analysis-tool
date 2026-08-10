import { apiClient } from './client'

export interface NewObjectSpec {
  name: string
  object_kind: 'address' | 'service'
  address_type?: 'ip-mask' | 'ip-range' | 'fqdn'
  ip_address?: string
  protocol?: 'tcp' | 'udp'
  port?: string
  description?: string
}

export interface NewPolicyRow {
  row_index: number
  rule_name: string
  rule_action: string
  disabled: boolean
  from_zone: string
  source: string
  source_user: string
  to_zone: string
  destination: string
  service: string
  application: string
  description: string
  log_end: string
  log_setting: string
}

export interface MoveTarget {
  position: 'top' | 'bottom' | 'before' | 'after'
  reference_policy_id: number | null
}

export interface ObjectGapItem {
  name: string
  object_kind: 'address' | 'service'
  referenced_by_rule_names: string[]
}

export interface GeneratedCommand {
  row_index: number
  kind: 'object' | 'policy' | 'move'
  command: string | null
  error: string | null
  counts: Record<string, number> | null
}

export interface InsertionConflict {
  rule_name: string
  conflict_type: 'blocking' | 'shadowing'
  conflicting_policy_id: number
  conflicting_policy_name: string
  reason: string
}

export interface PreviewRow {
  id: number
  rule_name: string
  action: string
  seq: number | null
  is_new: boolean
}

export interface BulkPolicyPlanResponse {
  missing_objects: ObjectGapItem[]
  object_commands: GeneratedCommand[]
  policy_commands: GeneratedCommand[]
  move_commands: GeneratedCommand[]
  modify_commands: GeneratedCommand[]
  delete_commands: GeneratedCommand[]
  conflicts: InsertionConflict[]
  preview_before: PreviewRow[]
  preview_after: PreviewRow[]
  warnings: string[]
}

export interface PreviewPolicyRow {
  id: number
  device_id: number
  rule_name: string
  action: string
  seq: number | null
  source: string
  destination: string
  service: string
  application: string | null
  from_zone: string | null
  to_zone: string | null
  user: string | null
  description: string | null
  log_setting: string | null
  enable: boolean | null
  security_profile: string | null
  category: string | null
  last_hit_date: string | null
  hit_count: number | null
  is_active: boolean
  last_seen_at: string | null
  vsys: string | null
  pending_status: 'new' | 'modified' | 'deleted' | 'moved' | null
}

export type PendingChangeType = 'create' | 'new_object' | 'modify' | 'delete' | 'move'

export interface PendingPolicyChange {
  id: number
  device_id: number
  change_type: PendingChangeType
  target_policy_id: number | null
  client_key: string
  payload: Record<string, unknown>
  created_by_user_id: number | null
  created_at: string
}

export const listPendingChanges = async (deviceId: number): Promise<PendingPolicyChange[]> => {
  const res = await apiClient.get<PendingPolicyChange[]>(`/policy-builder/${deviceId}/pending-changes`)
  return res.data
}

export const addPendingChange = async (
  deviceId: number,
  payload: { change_type: PendingChangeType; target_policy_id?: number | null; client_key: string; payload: Record<string, unknown> },
): Promise<PendingPolicyChange> => {
  const res = await apiClient.post<PendingPolicyChange>(`/policy-builder/${deviceId}/pending-changes`, payload)
  return res.data
}

export const updatePendingChange = async (
  deviceId: number,
  changeId: number,
  payload: Record<string, unknown>,
): Promise<PendingPolicyChange> => {
  const res = await apiClient.patch<PendingPolicyChange>(`/policy-builder/${deviceId}/pending-changes/${changeId}`, { payload })
  return res.data
}

export const removePendingChange = async (deviceId: number, changeId: number): Promise<void> => {
  await apiClient.delete(`/policy-builder/${deviceId}/pending-changes/${changeId}`)
}

export const getPreviewOrder = async (deviceId: number): Promise<PreviewPolicyRow[]> => {
  const res = await apiClient.get<PreviewPolicyRow[]>(`/policy-builder/${deviceId}/preview-order`)
  return res.data
}

export const clearPendingChanges = async (deviceId: number): Promise<void> => {
  await apiClient.delete(`/policy-builder/${deviceId}/pending-changes`)
}

/**
 * 신규 정책 생성(create) 변경사항이 취소되면, 그 정책만 참조하던 신규 오브젝트(new_object)
 * 변경사항이 고아로 남을 수 있다 — 남은 create 변경사항 중 어느 것도 이름을 참조하지 않는
 * new_object만 골라 정리한다. `remainingChanges`는 삭제 대상을 제외한, 정리 시점의 전체 목록.
 */
export const cleanupOrphanNewObjects = async (deviceId: number, remainingChanges: PendingPolicyChange[]): Promise<void> => {
  const referencedNames = new Set<string>()
  for (const c of remainingChanges) {
    if (c.change_type !== 'create') continue
    for (const field of ['source', 'destination', 'service']) {
      const raw = String(c.payload[field] ?? '')
      for (const token of raw.split(',')) {
        const name = token.trim().replace(/^"|"$/g, '')
        if (name) referencedNames.add(name)
      }
    }
  }
  const orphaned = remainingChanges.filter(
    (c) => c.change_type === 'new_object' && !referencedNames.has(String(c.payload.name ?? ''))
  )
  await Promise.all(orphaned.map((c) => removePendingChange(deviceId, c.id)))
}

export const checkObjectGaps = async (deviceId: number, newPolicies: NewPolicyRow[]): Promise<ObjectGapItem[]> => {
  const res = await apiClient.post(`/policy-builder/${deviceId}/object-gaps`, { new_policies: newPolicies })
  return res.data.missing_objects
}

export const planBulkPolicy = async (
  deviceId: number,
  payload: { vsys?: string } = {},
): Promise<BulkPolicyPlanResponse> => {
  const res = await apiClient.post<BulkPolicyPlanResponse>(`/policy-builder/${deviceId}/plan`, payload)
  return res.data
}

export function newPolicyRowDefaults(rowIndex: number): NewPolicyRow {
  return {
    row_index: rowIndex,
    rule_name: '',
    rule_action: 'allow',
    disabled: false,
    from_zone: '',
    source: '',
    source_user: '',
    to_zone: '',
    destination: '',
    service: '',
    application: '',
    description: '',
    log_end: '',
    log_setting: '',
  }
}
