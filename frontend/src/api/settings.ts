import { apiClient, downloadBlob } from './client'
import type { ExceptionItem } from '@/components/pages/settings/ExceptionTable'

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

export const getDeletionWorkflowConfigYaml = async (): Promise<string> => {
  const res = await apiClient.get<string>('/settings/deletion-workflow/config/yaml', {
    responseType: 'text',
  })
  return res.data
}

export const updateDeletionWorkflowConfigYaml = async (yamlText: string): Promise<void> => {
  await apiClient.put('/settings/deletion-workflow/config/yaml', yamlText, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export const parseYamlToJson = async (yamlText: string): Promise<unknown> => {
  const res = await apiClient.post<{ data: unknown }>('/settings/deletion-workflow/parse-yaml', yamlText, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
  return res.data.data
}

export type ExceptionCategory = 'request_ids' | 'static_list'

export const downloadExceptionExcelTemplate = async (category: ExceptionCategory): Promise<void> => {
  await downloadBlob(`/api/v1/settings/deletion-workflow/exceptions/${category}/excel-template`, `${category}_template.xlsx`)
}

export const importExceptionExcel = async (category: ExceptionCategory, file: File): Promise<ExceptionItem[]> => {
  const form = new FormData()
  form.append('file', file)
  const res = await apiClient.post<ExceptionItem[]>(`/settings/deletion-workflow/exceptions/${category}/excel-import`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}
