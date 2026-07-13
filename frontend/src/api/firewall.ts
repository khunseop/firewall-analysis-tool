import { apiClient, downloadBlobPost } from './client'
import type {
  Policy,
  PolicySearchRequest,
  ChangeLogEntry,
  PolicyHistoryEntry,
  PolicySearchResponse,
} from '@/types/policy'
import type {
  NetworkObject,
  NetworkGroup,
  Service,
  ServiceGroup,
  ObjectSearchRequest,
  ObjectSearchResponse,
} from '@/types/object'

export type {
  Policy,
  FilterLeafNode,
  FilterGroupNode,
  FilterExprNode,
  PolicySearchRequest,
  ChangeLogEntry,
  PolicyHistoryEntry,
  PolicySearchResponse,
} from '@/types/policy'
export type {
  NetworkObject,
  NetworkGroup,
  Service,
  ServiceGroup,
  ObjectSearchRequest,
  ObjectSearchResponse,
} from '@/types/object'

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

export interface ObjectUsageCount { device_id: number; name: string; member_type: 'address' | 'service'; policy_count: number }

export const getObjectUsageCounts = async (deviceIds: number[]): Promise<ObjectUsageCount[]> => {
  const q = deviceIds.map(id => `device_ids=${id}`).join('&')
  const res = await apiClient.get<ObjectUsageCount[]>(`/firewall/objects/usage-counts?${q}`)
  return res.data
}

export interface ChangeStatEntry { week: string; action: string; count: number }

export type ChangeStatCategory = 'policies' | 'network_objects' | 'services'

export const getChangeStats = async (
  deviceIds: number[], weeks = 12, category: ChangeStatCategory = 'policies',
): Promise<ChangeStatEntry[]> => {
  const q = deviceIds.map(id => `device_ids=${id}`).join('&')
  const res = await apiClient.get<ChangeStatEntry[]>(`/firewall/change-stats?${q}&weeks=${weeks}&category=${category}`)
  return res.data
}

interface ExcelColumn { header: string; width: number }
interface ExcelRow { values: (string | number | null)[]; rowBg: string | null; cellFontColors: (string | null)[] }
export interface StyledExcelPayload { filename: string; columns: ExcelColumn[]; rows: ExcelRow[] }

export const exportStyledToExcel = async (payload: StyledExcelPayload): Promise<void> => {
  await downloadBlobPost('/api/v1/firewall/export/excel', payload, `${payload.filename}.xlsx`)
}

export const exportToExcel = async (data: Record<string, unknown>[], filename: string): Promise<void> => {
  await downloadBlobPost('/api/v1/firewall/export/excel', { data, filename }, `${filename}.xlsx`)
}
