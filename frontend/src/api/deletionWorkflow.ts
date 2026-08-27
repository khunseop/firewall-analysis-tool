import { apiClient } from './client'
import { useAuthStore } from '@/store/authStore'
import { getAnalysisTaskDetail, type AnalysisTask } from './analysis'

// ── 프로젝트 실행 관련 타입 ──────────────────────────────────────────────────

export interface ProjectTaskOutput {
  slot: string
  filename: string
}

/** POST .../extract, .../tasks/{id}/run 응답 — 실행은 백그라운드로 예약되고
 * 진행 상태는 analysis_task_id로 GET /analysis/tasks/{id}를 폴링해 확인한다. */
export interface ProjectTaskRunResponse {
  ok: boolean
  task_id: number
  analysis_task_id: number
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
    } catch { /* 응답 본문이 JSON이 아니면 기본 메시지 사용 */ }
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
    } catch { /* 응답 본문이 JSON이 아니면 기본 메시지 사용 */ }
    throw new Error(detail)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const filename = match ? match[1] : `redundancy_${deviceId}.xlsx`
  return { blob, filename }
}

// ── 프로젝트 태스크 실행 ────────────────────────────────────────────────────

export const runProjectExtract = async (projectId: number): Promise<ProjectTaskRunResponse> => {
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
): Promise<ProjectTaskRunResponse> => {
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

const PIPELINE_TASK_POLL_INTERVAL_MS = 800

/** 파이프라인 태스크 실행이 끝날 때까지 대기한다.
 * 파이프라인 단계는 대개 수 초 이내로 끝나므로, 먼저 즉시 1회 조회해 이미
 * 끝났으면 지연 없이 반환하고(빠른 경로), 아니면 800ms 간격으로 폴링한다. */
export const waitForPipelineTask = async (analysisTaskId: number): Promise<AnalysisTask> => {
  for (;;) {
    const task = await getAnalysisTaskDetail(analysisTaskId)
    if (task.task_status === 'success' || task.task_status === 'failure') {
      return task
    }
    await new Promise((resolve) => setTimeout(resolve, PIPELINE_TASK_POLL_INTERVAL_MS))
  }
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

export const completeProject = async (
  projectId: number,
): Promise<{ blob: Blob; filename: string }> => {
  const token = useAuthStore.getState().token
  const res = await fetch(`/api/v1/deletion-workflow/projects/${projectId}/complete`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '완료 처리 실패')
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/)
  const filename = match ? decodeURIComponent(match[1]) : `project_${projectId}_완료결과.zip`
  return { blob, filename }
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
    } catch { /* 응답 본문이 JSON이 아니면 기본 메시지 사용 */ }
    throw new Error(detail)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const filename = match ? match[1] : `task${taskId}_result.xlsx`

  return { blob, filename }
}
