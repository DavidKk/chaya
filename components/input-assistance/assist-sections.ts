import { LuBot, LuCircleDot, LuGamepad2, LuKeyboard, LuLayoutGrid, LuMap, LuSave, LuSparkles } from 'react-icons/lu'

import type { MessageKey } from '@/lib/i18n'

/** Web `/assist/*` 与局内浮层「辅助」共用的分区；顺序即导航顺序 */
export const ASSIST_SECTIONS = [
  { id: 'hotkeys', labelKey: 'edit.hotkeys', icon: LuKeyboard },
  { id: 'key-mouse', labelKey: 'nav.keyMouse', icon: LuGamepad2 },
  { id: 'saves', labelKey: 'nav.gameSaves', icon: LuSave },
  { id: 'minimap', labelKey: 'nav.minimap', icon: LuMap },
  { id: 'floating-ball', labelKey: 'floatingBall.title', icon: LuCircleDot },
  { id: 'enhance', labelKey: 'nav.enhance', icon: LuSparkles },
  { id: 'panels', labelKey: 'nav.miniPanels', icon: LuLayoutGrid },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; icon: typeof LuBot }>

export type AssistSection = (typeof ASSIST_SECTIONS)[number]['id']

export const DEFAULT_ASSIST_SECTION: AssistSection = 'hotkeys'

export function isAssistSection(value: unknown): value is AssistSection {
  return ASSIST_SECTIONS.some((section) => section.id === value)
}
