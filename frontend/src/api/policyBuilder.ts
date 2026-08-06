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

export const removePendingChange = async (deviceId: number, changeId: number): Promise<void> => {
  await apiClient.delete(`/policy-builder/${deviceId}/pending-changes/${changeId}`)
}

export const clearPendingChanges = async (deviceId: number): Promise<void> => {
  await apiClient.delete(`/policy-builder/${deviceId}/pending-changes`)
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
