import { apiClient } from './client'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'
export type NotificationCategory = 'sync' | 'analysis' | 'system'

export interface NotificationLog {
  id: number
  title: string
  message: string
  type: NotificationType
  category: NotificationCategory | null
  device_id: number | null
  device_name: string | null
  timestamp: string
}

export interface NotificationLogCreate {
  title: string
  message: string
  type: NotificationType
  category?: NotificationCategory
  device_id?: number
  device_name?: string
}

export interface NotificationListResponse {
  items: NotificationLog[]
  total: number
}

export const createNotification = async (payload: NotificationLogCreate): Promise<NotificationLog> => {
  const res = await apiClient.post<NotificationLog>('/notifications', payload)
  return res.data
}

export const getNotifications = async (params: {
  skip?: number
  limit?: number
  category?: NotificationCategory
  type?: NotificationType
} = {}): Promise<NotificationListResponse> => {
  const query = new URLSearchParams()
  if (params.skip !== undefined) query.append('skip', String(params.skip))
  if (params.limit !== undefined) query.append('limit', String(params.limit))
  if (params.category) query.append('category', params.category)
  if (params.type) query.append('type', params.type)
  const res = await apiClient.get<NotificationListResponse>(`/notifications${query.toString() ? `?${query}` : ''}`)
  return res.data
}
