import { apiClient } from './client'
import { getAnalysisTaskDetail, type AnalysisTask } from './analysis'

export interface AnalysisProject {
  id: number
  module_type: string
  device_id: number
  device_name: string
  device_ip: string
  name: string
  status: string  // draft / running / completed
  memo: string | null
  reference_date: string | null
  created_at: string
  updated_at: string
}

export interface ProjectFileState {
  task_id: number
  slot: string
  filename: string
  created_at: string
}

export interface AnalysisProjectDetail extends AnalysisProject {
  device_vendor: string
  files: ProjectFileState[]
}

export interface ProjectPipelineTaskListItem {
  id: number
  pipeline_task_id: number | null
  task_status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  requested_by_username: string | null
}

export const listAnalysisProjects = async (
  moduleType: string,
  deviceId?: number,
): Promise<AnalysisProject[]> => {
  const params: Record<string, string | number> = { module_type: moduleType }
  if (deviceId !== undefined) params.device_id = deviceId
  const res = await apiClient.get<AnalysisProject[]>('/analysis/projects', { params })
  return res.data
}

export const createAnalysisProject = async (
  moduleType: string,
  deviceId: number,
  name: string,
  memo?: string,
  referenceDate?: string,
): Promise<AnalysisProject> => {
  const form = new URLSearchParams()
  form.set('module_type', moduleType)
  form.set('device_id', String(deviceId))
  form.set('name', name)
  if (memo) form.set('memo', memo)
  if (referenceDate) form.set('reference_date', referenceDate)
  const res = await apiClient.post<AnalysisProject>('/analysis/projects', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data
}

export const getAnalysisProject = async (id: number): Promise<AnalysisProjectDetail> => {
  const res = await apiClient.get<AnalysisProjectDetail>(`/analysis/projects/${id}`)
  return res.data
}

export const deleteAnalysisProject = async (id: number): Promise<void> => {
  await apiClient.delete(`/analysis/projects/${id}`)
}

export const updateAnalysisProject = async (
  id: number,
  patch: { memo?: string; reference_date?: string | null },
): Promise<{ id: number; memo: string | null; reference_date: string | null; updated_at: string }> => {
  const form = new URLSearchParams()
  if (patch.memo !== undefined) form.set('memo', patch.memo ?? '')
  if (patch.reference_date !== undefined) {
    if (patch.reference_date === null) {
      form.set('clear_reference_date', 'true')
    } else {
      form.set('reference_date', patch.reference_date)
    }
  }
  const res = await apiClient.patch(`/analysis/projects/${id}`, form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data
}

export const listProjectPipelineTasks = async (
  projectId: number,
): Promise<{ total: number; items: ProjectPipelineTaskListItem[] }> => {
  const res = await apiClient.get(`/analysis/projects/${projectId}/tasks`)
  return res.data
}

export interface ProjectPipelineTaskResult {
  task_id: number
  task_status: string
  error_message: string | null
  outputs: { slot: string; filename: string }[]
}

export const getProjectPipelineTaskResult = async (
  projectId: number,
  analysisTaskId: number,
): Promise<ProjectPipelineTaskResult> => {
  const res = await apiClient.get<ProjectPipelineTaskResult>(
    `/analysis/projects/${projectId}/tasks/${analysisTaskId}/result`
  )
  return res.data
}

const PIPELINE_TASK_POLL_INTERVAL_MS = 800

/** 파이프라인 태스크 실행이 끝날 때까지 대기한다. 프로젝트형 모듈 공통으로 쓰이는
 * 범용 폴링 함수 — 특정 모듈에 종속되지 않으므로 이 공용 파일에 둔다.
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
