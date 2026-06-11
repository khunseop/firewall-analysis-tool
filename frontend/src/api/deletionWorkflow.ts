import { apiClient } from './client'
import { useAuthStore } from '@/store/authStore'

export interface DeletionTaskMeta {
  id: number
  name: string
  input_count: number
  description: string
}

export interface DeletionTaskListResponse {
  tasks: DeletionTaskMeta[]
  fpat_yaml: string
}

export const fetchDeletionTasks = async (): Promise<DeletionTaskListResponse> => {
  const res = await apiClient.get<DeletionTaskListResponse>('/deletion-workflow/tasks')
  return res.data
}

export const extractDeviceData = async (
  deviceId: number,
): Promise<{ blob: Blob; filename: string }> => {
  const token = useAuthStore.getState().token
  const formData = new FormData()
  formData.append('device_id', String(deviceId))

  const res = await fetch('/api/v1/deletion-workflow/extract', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })

  if (!res.ok) {
    let detail = '데이터 추출 실패'
    try {
      const data = await res.json()
      detail = data.detail || data.msg || detail
    } catch {}
    throw new Error(detail)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const filename = match ? match[1] : `policy_${deviceId}.xlsx`
  return { blob, filename }
}

export const exportRedundancyData = async (
  deviceId: number
): Promise<{ blob: Blob; filename: string }> => {
  const token = useAuthStore.getState().token
  const res = await fetch(`/api/v1/deletion-workflow/redundancy-export/${deviceId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!res.ok) {
    let detail = '중복 분석 내보내기 실패'
    try {
      const data = await res.json()
      detail = data.detail || data.msg || detail
    } catch {}
    throw new Error(detail)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const filename = match ? match[1] : `redundancy_${deviceId}.xlsx`
  return { blob, filename }
}

export const executeDeletionTask = async (
  taskId: number,
  files: File[],
  vendor?: string
): Promise<{ blob: Blob; filename: string }> => {
  const token = useAuthStore.getState().token
  const formData = new FormData()
  files.forEach((f) => formData.append('files', f))
  if (vendor) formData.append('vendor', vendor)

  const res = await fetch(`/api/v1/deletion-workflow/tasks/${taskId}/execute`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })

  if (!res.ok) {
    let detail = '태스크 실행 실패'
    try {
      const data = await res.json()
      detail = data.detail || data.msg || detail
    } catch {}
    throw new Error(detail)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const filename = match ? match[1] : `task${taskId}_result.xlsx`

  return { blob, filename }
}
