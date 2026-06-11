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

export const exportDeletionWorkflowConfig = async (): Promise<{ blob: Blob; filename: string }> => {
  const res = await apiClient.get('/settings/deletion-workflow/config/export', { responseType: 'blob' })
  const disposition = res.headers['content-disposition'] ?? ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match?.[1] ?? 'deletion_workflow_config.json'
  return { blob: res.data as Blob, filename }
}

export const importDeletionWorkflowConfig = async (file: File): Promise<void> => {
  const form = new FormData()
  form.append('file', file)
  await apiClient.post('/settings/deletion-workflow/config/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
