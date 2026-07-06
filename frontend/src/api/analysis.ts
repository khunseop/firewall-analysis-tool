import { apiClient } from './client'

export interface AnalysisTask {
  id: number
  device_id: number
  task_type: string
  task_status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

export interface AnalysisResult {
  id: number
  device_id: number
  analysis_type: string
  result_data: unknown[]
  created_at: string
}

export interface AnalysisTaskListItem {
  id: number
  device_id: number
  device_name: string
  device_ip: string
  task_type: string
  task_status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

export interface AnalysisTaskListResponse {
  items: AnalysisTaskListItem[]
  total: number
}

export interface ListAnalysisTasksParams {
  deviceId?: number
  analysisType?: string
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface StartAnalysisParams {
  days?: number
  targetPolicyId?: number
  targetPolicyIds?: number[]
  referencePolicyId?: number
  moveDirection?: string
}

export const startAnalysis = async (
  deviceId: number,
  analysisType: string,
  params: StartAnalysisParams = {}
): Promise<{ msg: string }> => {
  const { days, targetPolicyId, targetPolicyIds, referencePolicyId, moveDirection } = params

  if (analysisType === 'redundancy') {
    const res = await apiClient.post(`/analysis/redundancy/${deviceId}`)
    return res.data
  }
  if (analysisType === 'unused') {
    const url = `/analysis/unused/${deviceId}${days ? `?days=${days}` : ''}`
    const res = await apiClient.post(url)
    return res.data
  }
  if (analysisType === 'impact') {
    const policyIds = targetPolicyIds || (targetPolicyId ? [targetPolicyId] : [])
    const policyIdsParam = policyIds.map((id) => `target_policy_id=${id}`).join('&')
    const url = `/analysis/impact/${deviceId}?${policyIdsParam}${referencePolicyId ? `&reference_policy_id=${referencePolicyId}` : ''}${moveDirection ? `&move_direction=${moveDirection}` : ''}`
    const res = await apiClient.post(url)
    return res.data
  }
  if (analysisType === 'unreferenced_objects') {
    const res = await apiClient.post(`/analysis/unreferenced-objects/${deviceId}`)
    return res.data
  }
  if (analysisType === 'risky_ports') {
    const policyIds = params.targetPolicyIds
    if (policyIds && policyIds.length > 0) {
      const param = policyIds.map((id) => `target_policy_id=${id}`).join('&')
      const res = await apiClient.post(`/analysis/risky-ports/${deviceId}?${param}`)
      return res.data
    }
    const res = await apiClient.post(`/analysis/risky-ports/${deviceId}`)
    return res.data
  }
  if (analysisType === 'over_permissive') {
    const policyIds = params.targetPolicyIds
    if (policyIds && policyIds.length > 0) {
      const param = policyIds.map((id) => `target_policy_id=${id}`).join('&')
      const res = await apiClient.post(`/analysis/over-permissive/${deviceId}?${param}`)
      return res.data
    }
    const res = await apiClient.post(`/analysis/over-permissive/${deviceId}`)
    return res.data
  }
  throw new Error(`Unknown analysis type: ${analysisType}`)
}

export const getAnalysisStatus = async (deviceId: number): Promise<AnalysisTask> => {
  const res = await apiClient.get<AnalysisTask>(`/analysis/${deviceId}/status`)
  return res.data
}

export const getAnalysisResults = async (taskId: number): Promise<unknown[]> => {
  const res = await apiClient.get(`/analysis/redundancy/${taskId}/results`)
  return res.data
}

export const getLatestAnalysisResult = async (deviceId: number, analysisType: string): Promise<AnalysisResult> => {
  const res = await apiClient.get<AnalysisResult>(`/analysis/${deviceId}/latest-result?analysis_type=${analysisType}`)
  return res.data
}

export const listAnalysisTasks = async (params: ListAnalysisTasksParams = {}): Promise<AnalysisTaskListResponse> => {
  const { deviceId, analysisType, status, search, page = 1, pageSize = 20 } = params
  const query = new URLSearchParams()
  if (deviceId) query.set('device_id', String(deviceId))
  if (analysisType) query.set('analysis_type', analysisType)
  if (status) query.set('status', status)
  if (search) query.set('search', search)
  query.set('page', String(page))
  query.set('page_size', String(pageSize))
  const res = await apiClient.get<AnalysisTaskListResponse>(`/analysis/tasks?${query.toString()}`)
  return res.data
}

export const getAnalysisTaskDetail = async (taskId: number): Promise<AnalysisTask> => {
  const res = await apiClient.get<AnalysisTask>(`/analysis/tasks/${taskId}`)
  return res.data
}

export const getAnalysisTaskResult = async (taskId: number): Promise<AnalysisResult> => {
  const res = await apiClient.get<AnalysisResult>(`/analysis/tasks/${taskId}/result`)
  return res.data
}
