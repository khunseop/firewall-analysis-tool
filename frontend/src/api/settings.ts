import { apiClient } from './client'

export interface Setting {
  key: string
  value: string
  description: string | null
}

export const getSettings = async (): Promise<Setting[]> => {
  const res = await apiClient.get<Setting[]>('/settings')
  return res.data
}

export const getSetting = async (key: string): Promise<Setting> => {
  const res = await apiClient.get<Setting>(`/settings/${key}`)
  return res.data
}

export const updateSetting = async (key: string, value: string, description?: string): Promise<Setting> => {
  const res = await apiClient.put<Setting>(`/settings/${key}`, { value, description })
  return res.data
}

export const getDeletionWorkflowConfig = async (): Promise<Record<string, unknown>> => {
  const res = await apiClient.get('/settings/deletion-workflow/config')
  return res.data
}

export const updateDeletionWorkflowConfig = async (config: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const res = await apiClient.put('/settings/deletion-workflow/config', { config })
  return res.data
}
