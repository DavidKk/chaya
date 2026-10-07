import { LuBot, LuGamepad2, LuKeyboard, LuMap, LuMessageCircle } from 'react-icons/lu'

import type { MessageKey } from '@/lib/i18n'

/** Web `/assist/*` 与局内浮层「辅助」共用的分区；顺序即导航顺序 */
export const ASSIST_SECTIONS = [
  { id: 'hotkeys', labelKey: 'edit.hotkeys', icon: LuKeyboard },
  { id: 'key-mouse', labelKey: 'nav.keyMouse', icon: LuGamepad2 },
  { id: 'minimap', labelKey: 'nav.minimap', icon: LuMap },
  { id: 'agents', labelKey: 'integration.agentSettingsTab', icon: LuBot },
  { id: 'companion', labelKey: 'nav.companion', icon: LuMessageCircle },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; icon: typeof LuBot }>

export type AssistSection = (typeof ASSIST_SECTIONS)[number]['id']

export const DEFAULT_ASSIST_SECTION: AssistSection = 'hotkeys'

export function isAssistSection(value: unknown): value is AssistSection {
  return ASSIST_SECTIONS.some((section) => section.id === value)
}
