import { apiClient, downloadBlob, downloadBlobPost } from './client'

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
  group: string | null
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_step: string | null
  serial_number: string | null
  os_name: string | null
  os_version: string | null
  install_date: string | null
  location_region: string | null
  location_building: string | null
  location_floor: string | null
  location_room: string | null
  location_x: string | null
  location_y: string | null
  location_z: string | null
  policy_threshold: number | null
  network_object_threshold: number | null
  service_threshold: number | null
  cached_policies: number | null
  cached_active_policies: number | null
  cached_disabled_policies: number | null
  cached_network_objects: number | null
  cached_network_groups: number | null
  cached_services: number | null
  cached_service_groups: number | null
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
  collect_last_hit_date?: boolean
  model?: string
  group?: string
  serial_number?: string
  os_name?: string
  os_version?: string
  install_date?: string
  location_region?: string
  location_building?: string
  location_floor?: string
  location_room?: string
  location_x?: string
  location_y?: string
  location_z?: string
  policy_threshold?: number
  network_object_threshold?: number
  service_threshold?: number
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
  group?: string
  serial_number?: string
  os_name?: string
  os_version?: string
  install_date?: string
  location_region?: string
  location_building?: string
  location_floor?: string
  location_room?: string
  location_x?: string
  location_y?: string
  location_z?: string
  policy_threshold?: number
  network_object_threshold?: number
  service_threshold?: number
}

export interface DeviceStats {
  id: number
  name: string
  vendor: string
  ip_address?: string
  sync_time: string | null
  sync_status: string | null
  sync_step: string | null
  policies: number
  active_policies: number
  disabled_policies: number
  network_objects: number
  network_groups: number
  services: number
  service_groups: number
  policy_threshold: number | null
  network_object_threshold: number | null
  service_threshold: number | null
}

export interface DashboardStats {
  total_devices: number
  active_devices: number
  total_policies: number
  total_active_policies: number
  total_disabled_policies: number
  total_network_objects: number
  total_network_groups: number
  total_services: number
  total_service_groups: number
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

export const getDevice = async (id: number): Promise<Device> => {
  const res = await apiClient.get<Device>(`/devices/${id}`)
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

export type DirectExportType = 'policies' | 'objects' | 'hit_dates'

export const directExport = async (
  device: Device,
  exportType: DirectExportType,
  options?: { use_ssh?: boolean; timeout_seconds?: number },
): Promise<void> => {
  const timeout = options?.timeout_seconds ?? 600
  const labelMap: Record<DirectExportType, string> = { policies: '정책', objects: '객체', hit_dates: '사용이력' }
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `${device.name}_${labelMap[exportType]}_${today}.xlsx`
  await downloadBlobPost(
    `/api/v1/devices/${device.id}/direct-export`,
    { export_type: exportType, use_ssh: options?.use_ssh ?? false, timeout_seconds: timeout },
    filename,
    (timeout + 60) * 1000,
  )
}

export const bulkExportDevices = async (
  devices: Device[],
  exportType: DirectExportType,
  options?: { source?: 'live' | 'db'; merge?: boolean; use_ssh?: boolean; timeout_seconds?: number },
): Promise<void> => {
  const timeout = options?.timeout_seconds ?? 600
  const labelMap: Record<DirectExportType, string> = { policies: '정책', objects: '객체', hit_dates: '사용이력' }
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const merge = options?.merge ?? false
  const filename = merge && devices.length > 1
    ? `통합_${labelMap[exportType]}_${today}.xlsx`
    : `${devices[0].name}_${labelMap[exportType]}_${today}.xlsx`
  await downloadBlobPost(
    '/api/v1/devices/export',
    {
      device_ids: devices.map((d) => d.id),
      export_type: exportType,
      source: options?.source ?? 'live',
      merge,
      use_ssh: options?.use_ssh ?? false,
      timeout_seconds: timeout,
    },
    filename,
    (timeout + 60) * 1000,
  )
}
