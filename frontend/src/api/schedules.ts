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
  /** 'success' | 'partial'(일부 장비 실패) | 'failure' */
  last_run_status: string | null
  last_run_detail: ScheduleDeviceResult[] | null
  /** 스케줄러가 계산한 다음 실행 시각(Asia/Seoul, 시간대 표기 없음). 비활성이면 null */
  next_run_at: string | null
  is_running: boolean
}

export interface ScheduleDeviceResult {
  device_id: number | null
  device_name: string
  status: 'success' | 'failure'
  error: string | null
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

export const runScheduleNow = async (id: number): Promise<void> => {
  await apiClient.post(`/sync-schedules/${id}/run`)
}
