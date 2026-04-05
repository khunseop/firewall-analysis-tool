import { apiClient, downloadBlob } from './client'

export interface Device {
  id: number
  name: string
  ip_address: string
  vendor: string
  username: string
  description: string | null
  ha_peer_ip: string | null
  use_ssh_for_last_hit_date: boolean
  collect_last_hit_date: boolean
  model: string | null
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_step: string | null
}

export interface DeviceCreate {
  name: string
  ip_address: string
  vendor: string
  username: string
  password: string
  password_confirm: string
  ha_peer_ip?: string
  description?: string
  use_ssh_for_last_hit_date?: boolean
}

export interface DeviceUpdate {
  name?: string
  ip_address?: string
  vendor?: string
  username?: string
  password?: string
  password_confirm?: string
  ha_peer_ip?: string
  description?: string
  use_ssh_for_last_hit_date?: boolean
  collect_last_hit_date?: boolean
  model?: string
}

export interface DeviceStats {
  id: number
  name: string
  vendor: string
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_step: string | null
  total_policies: number
  active_policies: number
  disabled_policies: number
  total_network_objects: number
  total_services: number
}

export interface DashboardStats {
  total_devices: number
  active_devices: number
  total_policies: number
  total_active_policies: number
  total_disabled_policies: number
  total_network_objects: number
  total_services: number
  device_stats: DeviceStats[]
}

export interface BulkImportResult {
  success: boolean
  total: number
  success_count: number
  failed_count: number
  message: string
  failed_devices: string[]
}

export const listDevices = async (): Promise<Device[]> => {
  const res = await apiClient.get<Device[]>('/devices')
  return res.data
}

export const getDashboardStats = async (): Promise<DashboardStats> => {
  const res = await apiClient.get<DashboardStats>('/devices/dashboard/stats')
  return res.data
}

export const createDevice = async (payload: DeviceCreate): Promise<Device> => {
  const res = await apiClient.post<Device>('/devices', payload)
  return res.data
}

export const updateDevice = async (id: number, payload: DeviceUpdate): Promise<Device> => {
  const res = await apiClient.put<Device>(`/devices/${id}`, payload)
  return res.data
}

export const deleteDevice = async (id: number): Promise<Device> => {
  const res = await apiClient.delete<Device>(`/devices/${id}`)
  return res.data
}

export const testConnection = async (id: number): Promise<{ status: string; message: string }> => {
  const res = await apiClient.post(`/devices/${id}/test-connection`)
  return res.data
}

export const syncAll = async (id: number): Promise<{ msg: string }> => {
  const res = await apiClient.post(`/firewall/sync-all/${id}`)
  return res.data
}

export const getSyncStatus = async (id: number): Promise<{ last_sync_at: string | null; last_sync_status: string | null; last_sync_step: string | null }> => {
  const res = await apiClient.get(`/firewall/sync/${id}/status`)
  return res.data
}

export const downloadDeviceTemplate = async (): Promise<void> => {
  await downloadBlob('/api/v1/devices/excel-template', 'device_template.xlsx')
}

export const bulkImportDevices = async (file: File): Promise<BulkImportResult> => {
  const formData = new FormData()
  formData.append('file', file)
  const res = await apiClient.post<BulkImportResult>('/devices/bulk-import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}
