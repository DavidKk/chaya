import { aboutZh } from '@/lib/i18n/messages/parts/about'
import { commonZh } from '@/lib/i18n/messages/parts/common'
import { companionZh } from '@/lib/i18n/messages/parts/companion'
import { creditsZh } from '@/lib/i18n/messages/parts/credits'
import { dashboardZh } from '@/lib/i18n/messages/parts/dashboard'
import { dataZh } from '@/lib/i18n/messages/parts/data'
import { downloadsZh } from '@/lib/i18n/messages/parts/downloads'
import { editZh } from '@/lib/i18n/messages/parts/edit'
import { eventsZh } from '@/lib/i18n/messages/parts/events'
import { integrationZh } from '@/lib/i18n/messages/parts/integration'
import { legalZh } from '@/lib/i18n/messages/parts/legal'
import { marketingZh } from '@/lib/i18n/messages/parts/marketing'
import { mcpGatewayZh } from '@/lib/i18n/messages/parts/mcp-gateway'
import { panelsZh } from '@/lib/i18n/messages/parts/panels'
import { savesZh } from '@/lib/i18n/messages/parts/saves'
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
  ...aboutZh,
  ...creditsZh,
  ...legalZh,
  ...eventsZh,
  ...dataZh,
  ...savesZh,
  ...companionZh,
  ...panelsZh,
} as const satisfies MessageTree

export type { MessageTree } from '@/lib/i18n/messages/types'
