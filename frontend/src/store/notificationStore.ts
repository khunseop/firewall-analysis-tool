import { toast } from 'sonner'
import { createNotification, type NotificationLogCreate } from '@/api/notifications'

export function notify(
  title: string,
  message: string,
  type: 'info' | 'success' | 'warning' | 'error',
  options?: Partial<Omit<NotificationLogCreate, 'title' | 'message' | 'type'>>
): void {
  const fullMessage = `${title}: ${message}`
  if (type === 'success') toast.success(fullMessage)
  else if (type === 'error') toast.error(fullMessage)
  else if (type === 'warning') toast.warning(fullMessage)
  else toast.info(fullMessage)

  createNotification({ title, message, type, ...options }).catch(console.error)
}
