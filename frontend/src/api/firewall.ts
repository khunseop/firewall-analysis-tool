import { apiClient } from './client'
import { useAuthStore } from '@/store/authStore'

export interface Policy {
  id: number
  device_id: number
  rule_name: string
  source: string
  destination: string
  service: string
  action: string
  vsys: string | null
  seq: number | null
  enable: boolean
  user: string | null
  application: string | null
  security_profile: string | null
  category: string | null
  description: string | null
  last_hit_date: string | null
  is_active: boolean
  last_seen_at: string | null
}

export interface NetworkObject {
  id: number
  device_id: number
  name: string
  ip_address: string
  type: string
  description: string | null
  ip_version: string | null
  ip_start: string | null
  ip_end: string | null
  is_active: boolean
  last_seen_at: string | null
}

export interface NetworkGroup {
  id: number
  device_id: number
  name: string
  members: string
  description: string | null
  is_active: boolean
  last_seen_at: string | null
}

export interface Service {
  id: number
  device_id: number
  name: string
  protocol: string
  port: string
  description: string | null
  port_start: number | null
  port_end: number | null
  is_active: boolean
  last_seen_at: string | null
}

export interface ServiceGroup {
  id: number
  device_id: number
  name: string
  members: string
  description: string | null
  is_active: boolean
  last_seen_at: string | null
}

export interface FilterLeafNode {
  type: 'LEAF'
  field: string
  operator: 'contains' | 'equals' | 'not_equals' | 'not_contains' | 'gte' | 'lte' | 'only_within'
  value: string
}
export interface FilterGroupNode {
  type: 'AND' | 'OR'
  children: FilterExprNode[]
}
export type FilterExprNode = FilterLeafNode | FilterGroupNode

export interface PolicySearchRequest {
  device_ids: number[]
  vsys?: string
  vsys_negate?: boolean
  rule_name?: string
  rule_name_negate?: boolean
  action?: string
  action_negate?: boolean
  enable?: boolean
  user?: string
  user_negate?: boolean
  application?: string
  application_negate?: boolean
  security_profile?: string
  category?: string
  description?: string
  description_negate?: boolean
  last_hit_date_from?: string
  last_hit_date_to?: string
  src_ip?: string
  dst_ip?: string
  protocol?: string
  port?: string
  src_ips?: string[]
  dst_ips?: string[]
  src_ips_exact?: string[]
  dst_ips_exact?: string[]
  services?: string[]
  src_names?: string[]
  dst_names?: string[]
  service_names?: string[]
  src_ips_exclude?: string[]
  dst_ips_exclude?: string[]
  src_ips_exact_exclude?: string[]
  dst_ips_exact_exclude?: string[]
  services_exclude?: string[]
  src_names_exclude?: string[]
  dst_names_exclude?: string[]
  service_names_exclude?: string[]
  skip?: number
  limit?: number
  filter_expression?: FilterExprNode
}

export interface ChangeLogEntry {
  id: number
  device_id: number
  object_name: string
  action: 'created' | 'updated' | 'deleted' | 'hit_date_updated'
  timestamp: string | null
}

export interface PolicyHistoryEntry extends ChangeLogEntry {
  details: Record<string, unknown> | string | null
}

export interface PolicySearchResponse {
  policies: Policy[]
  valid_object_names: string[]
}

export interface ObjectSearchRequest {
  device_ids: number[]
  object_type: string
  name?: string
  description?: string
  ip_address?: string
  type?: string
  members?: string
  protocol?: string
  port?: string
  names?: string[]
  ip_addresses?: string[]
  protocols?: string[]
  ports?: string[]
  skip?: number
  limit?: number
}

export interface ObjectSearchResponse {
  network_objects: NetworkObject[]
  network_groups: NetworkGroup[]
  services: Service[]
  service_groups: ServiceGroup[]
}

export const searchPolicies = async (payload: PolicySearchRequest): Promise<PolicySearchResponse> => {
  const res = await apiClient.post<PolicySearchResponse>('/firewall/policies/search', payload)
  return res.data
}

export const getPolicyCount = async (deviceId: number): Promise<{ total: number; disabled: number }> => {
  const res = await apiClient.get(`/firewall/${deviceId}/policies/count`)
  return res.data
}

export const getObjectCount = async (deviceId: number): Promise<{ network_objects: number; services: number }> => {
  const res = await apiClient.get(`/firewall/${deviceId}/objects/count`)
  return res.data
}

export const getPolicies = async (deviceId: number): Promise<Policy[]> => {
  const res = await apiClient.get<Policy[]>(`/firewall/${deviceId}/policies`)
  return res.data
}

export const getNetworkObjects = async (deviceId: number): Promise<NetworkObject[]> => {
  const res = await apiClient.get<NetworkObject[]>(`/firewall/${deviceId}/network-objects`)
  return res.data
}

export const getNetworkGroups = async (deviceId: number): Promise<NetworkGroup[]> => {
  const res = await apiClient.get<NetworkGroup[]>(`/firewall/${deviceId}/network-groups`)
  return res.data
}

export const getServices = async (deviceId: number): Promise<Service[]> => {
  const res = await apiClient.get<Service[]>(`/firewall/${deviceId}/services`)
  return res.data
}

export const getServiceGroups = async (deviceId: number): Promise<ServiceGroup[]> => {
  const res = await apiClient.get<ServiceGroup[]>(`/firewall/${deviceId}/service-groups`)
  return res.data
}

export const searchObjects = async (payload: ObjectSearchRequest): Promise<ObjectSearchResponse> => {
  const res = await apiClient.post<ObjectSearchResponse>('/firewall/objects/search', payload)
  return res.data
}

export const getObjectDetails = async (deviceId: number, name: string): Promise<NetworkObject | NetworkGroup | Service | ServiceGroup | null> => {
  const res = await apiClient.get(`/firewall/object/details?device_id=${deviceId}&name=${encodeURIComponent(name)}`)
  return res.data
}

export const getChangeLogs = async (deviceIds: number[]): Promise<ChangeLogEntry[]> => {
  const q = deviceIds.map(id => `device_ids=${id}`).join('&')
  const res = await apiClient.get<ChangeLogEntry[]>(`/firewall/change-logs?${q}`)
  return res.data
}

export const getPolicyHistory = async (deviceId: number, ruleName: string): Promise<PolicyHistoryEntry[]> => {
  const res = await apiClient.get<PolicyHistoryEntry[]>(
    `/firewall/policy-history?device_id=${deviceId}&rule_name=${encodeURIComponent(ruleName)}`
  )
  return res.data
}

interface ExcelColumn { header: string; width: number }
interface ExcelRow { values: (string | number | null)[]; rowBg: string | null; cellFontColors: (string | null)[] }
export interface StyledExcelPayload { filename: string; columns: ExcelColumn[]; rows: ExcelRow[] }

export const exportStyledToExcel = async (payload: StyledExcelPayload): Promise<void> => {
  const token = useAuthStore.getState().token
  const res = await fetch('/api/v1/firewall/export/excel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let detail = 'Export failed'
    try { const d = await res.json(); detail = d.detail || d.msg || detail } catch {}
    throw new Error(detail)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${payload.filename}.xlsx`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const exportToExcel = async (data: Record<string, unknown>[], filename: string): Promise<void> => {
  const token = useAuthStore.getState().token
  const res = await fetch('/api/v1/firewall/export/excel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data, filename }),
  })
  if (!res.ok) {
    let detail = 'Export failed'
    try {
      const d = await res.json()
      detail = d.detail || d.msg || detail
    } catch {}
    throw new Error(detail)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
