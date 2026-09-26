import { commonZh } from '@/lib/i18n/messages/parts/common'
import { dashboardZh } from '@/lib/i18n/messages/parts/dashboard'
import { editZh } from '@/lib/i18n/messages/parts/edit'
import { marketingZh } from '@/lib/i18n/messages/parts/marketing'
import { translateZh } from '@/lib/i18n/messages/parts/translate'
import type { MessageTree } from '@/lib/i18n/messages/types'

/** 简体中文（结构真源） */
export const zh = {
  ...commonZh,
  ...marketingZh,
  ...dashboardZh,
  ...translateZh,
  ...editZh,
} as const satisfies MessageTree

export type { MessageTree } from '@/lib/i18n/messages/types'
