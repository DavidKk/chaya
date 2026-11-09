import { LuBot, LuHeartHandshake } from 'react-icons/lu'

import type { MessageKey } from '@/lib/i18n'

/** AI 一级导航下的二级分区：旅伴、Agent */
export const AI_SECTIONS = [
  { id: 'companion', labelKey: 'nav.companion', icon: LuHeartHandshake },
  { id: 'agents', labelKey: 'integration.agentSettingsTab', icon: LuBot },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; icon: typeof LuBot }>

export type AiSection = (typeof AI_SECTIONS)[number]['id']

export const DEFAULT_AI_SECTION: AiSection = 'companion'

export function isAiSection(value: unknown): value is AiSection {
  return AI_SECTIONS.some((section) => section.id === value)
}
