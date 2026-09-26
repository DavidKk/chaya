export type NotificationType = 'success' | 'error' | 'warning' | 'info'

/** 与右上角 toast 保持一致 */
export const NOTIFICATION_DURATION_MS = {
  success: 2400,
  error: 3200,
  warning: 3600,
  info: 4800,
} as const

export interface NotificationItem {
  id: string
  type: NotificationType
  message: string
  duration: number
  createdAt: number
}
