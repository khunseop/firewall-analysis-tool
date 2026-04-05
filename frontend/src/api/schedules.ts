import { apiClient } from './client'

export interface SyncSchedule {
  id: number
  name: string
  enabled: boolean
  days_of_week: number[]
  time: string
  device_ids: number[]
  description: string | null
  created_at: string
  updated_at: string | null
  last_run_at: string | null
  last_run_status: string | null
}

export interface SyncScheduleCreate {
  name: string
  enabled: boolean
  days_of_week: number[]
  time: string
  device_ids: number[]
  description?: string
}

export interface SyncScheduleUpdate {
  name?: string
  enabled?: boolean
  days_of_week?: number[]
  time?: string
  device_ids?: number[]
  description?: string
}

export const listSchedules = async (): Promise<SyncSchedule[]> => {
  const res = await apiClient.get<SyncSchedule[]>('/sync-schedules')
  return res.data
}

export const getSchedule = async (id: number): Promise<SyncSchedule> => {
  const res = await apiClient.get<SyncSchedule>(`/sync-schedules/${id}`)
  return res.data
}

export const createSchedule = async (payload: SyncScheduleCreate): Promise<SyncSchedule> => {
  const res = await apiClient.post<SyncSchedule>('/sync-schedules', payload)
  return res.data
}

export const updateSchedule = async (id: number, payload: SyncScheduleUpdate): Promise<SyncSchedule> => {
  const res = await apiClient.put<SyncSchedule>(`/sync-schedules/${id}`, payload)
  return res.data
}

export const deleteSchedule = async (id: number): Promise<SyncSchedule> => {
  const res = await apiClient.delete<SyncSchedule>(`/sync-schedules/${id}`)
  return res.data
}
