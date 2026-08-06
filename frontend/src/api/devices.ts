import { apiClient, downloadBlob } from './client'
import type { Device, DeviceCreate, DeviceUpdate, DashboardStats } from '@/types/device'

export type { Device, DeviceCreate, DeviceUpdate, DeviceStats, DashboardStats } from '@/types/device'

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

export type ExportTaskStatus = 'pending' | 'in_progress' | 'success' | 'failure'

export interface ExportTask {
  id: number
  device_ids: number[]
  export_type: DirectExportType
  source: 'live' | 'db'
  merge: boolean
  use_ssh: boolean
  timeout_seconds: number
  status: ExportTaskStatus
  step: string | null
  progress_current: number
  progress_total: number
  error_message: string | null
  result_file_path: string | null
  result_filename: string | null
  requested_by_user_id: number | null
  requested_by_username: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export const directExport = async (
  device: Device,
  exportType: DirectExportType,
  options?: { use_ssh?: boolean; timeout_seconds?: number },
): Promise<{ task_id: number }> => {
  const res = await apiClient.post(`/devices/${device.id}/direct-export`, {
    export_type: exportType,
    use_ssh: options?.use_ssh ?? false,
    timeout_seconds: options?.timeout_seconds ?? 600,
  })
  return res.data
}

export const bulkExportDevices = async (
  devices: Device[],
  exportType: DirectExportType,
  options?: { source?: 'live' | 'db'; merge?: boolean; use_ssh?: boolean; timeout_seconds?: number },
): Promise<{ task_id: number }> => {
  const res = await apiClient.post('/devices/export', {
    device_ids: devices.map((d) => d.id),
    export_type: exportType,
    source: options?.source ?? 'live',
    merge: options?.merge ?? false,
    use_ssh: options?.use_ssh ?? false,
    timeout_seconds: options?.timeout_seconds ?? 600,
  })
  return res.data
}

export const getActiveExportTasks = async (): Promise<ExportTask[]> => {
  const res = await apiClient.get<ExportTask[]>('/devices/export-tasks/active')
  return res.data
}

export const getExportTaskStatus = async (taskId: number): Promise<ExportTask> => {
  const res = await apiClient.get<ExportTask>(`/devices/export-tasks/${taskId}`)
  return res.data
}

export const downloadExportResult = async (taskId: number, filename: string): Promise<void> => {
  await downloadBlob(`/api/v1/devices/export-tasks/${taskId}/download`, filename)
}
