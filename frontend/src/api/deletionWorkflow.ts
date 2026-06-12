import { apiClient } from './client'
import { useAuthStore } from '@/store/authStore'

// ── 프로젝트 타입 ───────────────────────────────────────────────────────────

export interface DeletionWorkflowProject {
  id: number
  device_id: number
  device_name: string
  device_ip: string
  name: string
  status: string  // draft / running / completed
  memo: string | null
  created_at: string
  updated_at: string
}

export interface ProjectFileState {
  task_id: number
  slot: string
  filename: string
  created_at: string
}

export interface DeletionWorkflowProjectDetail extends DeletionWorkflowProject {
  device_vendor: string
  files: ProjectFileState[]
}

export interface ProjectTaskOutput {
  slot: string
  filename: string
}

export interface ProjectTaskResult {
  ok: boolean
  task_id: number
  outputs: ProjectTaskOutput[]
}

// ── 태스크 메타 타입 ────────────────────────────────────────────────────────

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

// ── 프로젝트 CRUD ───────────────────────────────────────────────────────────

export const listProjects = async (deviceId?: number): Promise<DeletionWorkflowProject[]> => {
  const params = deviceId !== undefined ? { device_id: deviceId } : {}
  const res = await apiClient.get<DeletionWorkflowProject[]>('/deletion-workflow/projects', { params })
  return res.data
}

export const createProject = async (
  deviceId: number,
  name: string,
  memo?: string,
): Promise<DeletionWorkflowProject> => {
  const token = useAuthStore.getState().token
  const form = new FormData()
  form.append('device_id', String(deviceId))
  form.append('name', name)
  if (memo) form.append('memo', memo)
  const res = await fetch('/api/v1/deletion-workflow/projects', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '프로젝트 생성 실패')
  }
  return res.json()
}

export const getProject = async (id: number): Promise<DeletionWorkflowProjectDetail> => {
  const res = await apiClient.get<DeletionWorkflowProjectDetail>(`/deletion-workflow/projects/${id}`)
  return res.data
}

export const deleteProject = async (id: number): Promise<void> => {
  await apiClient.delete(`/deletion-workflow/projects/${id}`)
}

// ── 프로젝트 태스크 실행 ────────────────────────────────────────────────────

export const runProjectExtract = async (projectId: number): Promise<{ ok: boolean; filename: string }> => {
  const token = useAuthStore.getState().token
  const res = await fetch(`/api/v1/deletion-workflow/projects/${projectId}/extract`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '데이터 추출 실패')
  }
  return res.json()
}

export const runProjectTask = async (
  projectId: number,
  taskId: number,
): Promise<ProjectTaskResult> => {
  const token = useAuthStore.getState().token
  const res = await fetch(`/api/v1/deletion-workflow/projects/${projectId}/tasks/${taskId}/run`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `태스크 ${taskId} 실행 실패`)
  }
  return res.json()
}

export const uploadExternalFile = async (
  projectId: number,
  taskId: number,
  slot: string,
  file: File,
): Promise<{ ok: boolean }> => {
  const token = useAuthStore.getState().token
  const form = new FormData()
  form.append('slot', slot)
  form.append('file', file)
  const res = await fetch(
    `/api/v1/deletion-workflow/projects/${projectId}/tasks/${taskId}/upload`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '파일 업로드 실패')
  }
  return res.json()
}

export const downloadTaskFile = async (
  projectId: number,
  taskId: number,
  slot = 'output_0',
): Promise<{ blob: Blob; filename: string }> => {
  const token = useAuthStore.getState().token
  const res = await fetch(
    `/api/v1/deletion-workflow/projects/${projectId}/tasks/${taskId}/download?slot=${slot}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '다운로드 실패')
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const filename = match ? match[1] : `task${taskId}_${slot}.xlsx`
  return { blob, filename }
}

// ── 초기화 API ──────────────────────────────────────────────────────────────

export const resetProjectOutputs = async (projectId: number): Promise<{ ok: boolean; deleted: number }> => {
  const token = useAuthStore.getState().token
  const res = await fetch(`/api/v1/deletion-workflow/projects/${projectId}/reset-outputs`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '초기화 실패')
  }
  return res.json()
}

export const resetAllProjectFiles = async (projectId: number): Promise<{ ok: boolean; deleted: number }> => {
  const token = useAuthStore.getState().token
  const res = await fetch(`/api/v1/deletion-workflow/projects/${projectId}/reset-all`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '초기화 실패')
  }
  return res.json()
}

export const clearProjectOutputs = async (
  projectId: number,
  taskIds: number[],
): Promise<{ ok: boolean; deleted: number }> => {
  const token = useAuthStore.getState().token
  const res = await fetch(`/api/v1/deletion-workflow/projects/${projectId}/clear-outputs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ task_ids: taskIds }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '초기화 실패')
  }
  return res.json()
}

// ── 기존 레거시 API ─────────────────────────────────────────────────────────

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
