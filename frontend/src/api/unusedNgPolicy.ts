import { useAuthStore } from '@/store/authStore'

/** POST .../run 응답 — 실행은 백그라운드로 예약되고 진행 상태는 analysis_task_id로
 * GET /analysis/tasks/{id}를 폴링해 확인한다(waitForPipelineTask, `@/api/analysisProjects`). */
export interface ProjectTaskRunResponse {
  ok: boolean
  task_id: number
  analysis_task_id: number
}

export const runProject = async (projectId: number): Promise<ProjectTaskRunResponse> => {
  const token = useAuthStore.getState().token
  const res = await fetch(`/api/v1/unused-ng-policy/projects/${projectId}/run`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '실행 실패')
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
    `/api/v1/unused-ng-policy/projects/${projectId}/tasks/${taskId}/download?slot=${slot}`,
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
