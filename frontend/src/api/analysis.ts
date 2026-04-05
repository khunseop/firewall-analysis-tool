import { apiClient } from './client'

export interface AnalysisTask {
  id: number
  device_id: number
  task_type: string
  task_status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface AnalysisResult {
  id: number
  device_id: number
  analysis_type: string
  result_data: unknown[]
  created_at: string
}

export interface StartAnalysisParams {
  days?: number
  targetPolicyId?: number
  targetPolicyIds?: number[]
  newPosition?: number
  moveDirection?: string
}

export const startAnalysis = async (
  deviceId: number,
  analysisType: string,
  params: StartAnalysisParams = {}
): Promise<{ msg: string }> => {
  const { days, targetPolicyId, targetPolicyIds, newPosition, moveDirection } = params

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
    const url = `/analysis/impact/${deviceId}?${policyIdsParam}&new_position=${newPosition}${moveDirection ? `&move_direction=${moveDirection}` : ''}`
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
