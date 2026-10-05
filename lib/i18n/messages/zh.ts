import { commonZh } from '@/lib/i18n/messages/parts/common'
import { dashboardZh } from '@/lib/i18n/messages/parts/dashboard'
import { downloadsZh } from '@/lib/i18n/messages/parts/downloads'
import { editZh } from '@/lib/i18n/messages/parts/edit'
import { eventsZh } from '@/lib/i18n/messages/parts/events'
import { integrationZh } from '@/lib/i18n/messages/parts/integration'
import { marketingZh } from '@/lib/i18n/messages/parts/marketing'
import { mcpGatewayZh } from '@/lib/i18n/messages/parts/mcp-gateway'
import { translateZh } from '@/lib/i18n/messages/parts/translate'
import type { MessageTree } from '@/lib/i18n/messages/types'

/** 简体中文（结构真源） */
export const zh = {
  ...commonZh,
  ...marketingZh,
  ...dashboardZh,
  ...translateZh,
  ...editZh,
  ...integrationZh,
  ...mcpGatewayZh,
  ...downloadsZh,
  ...eventsZh,
} as const satisfies MessageTree

export type { MessageTree } from '@/lib/i18n/messages/types'
