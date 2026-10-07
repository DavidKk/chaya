import type { IconType } from 'react-icons'
import { LuHistory, LuMap, LuMessageCircle, LuPanelTopClose, LuSave } from 'react-icons/lu'

import type { PanelDockItem } from '@/lib/game-agent/tool-settings'
import type { MessageKey } from '@/lib/i18n'

/** 迷你面板管理的按钮项：管理面板与设置页共用图标和文案 */
export const PANEL_DOCK_ITEM_META: Record<PanelDockItem, { icon: IconType; labelKey: MessageKey; descKey: MessageKey }> = {
  miniMap: { icon: LuMap, labelKey: 'panels.item.miniMap', descKey: 'panels.item.miniMapDesc' },
  companion: { icon: LuMessageCircle, labelKey: 'panels.item.companion', descKey: 'panels.item.companionDesc' },
  autoSaves: { icon: LuHistory, labelKey: 'panels.item.autoSaves', descKey: 'panels.item.autoSavesDesc' },
  quickSaves: { icon: LuSave, labelKey: 'panels.item.quickSaves', descKey: 'panels.item.quickSavesDesc' },
  closeAll: { icon: LuPanelTopClose, labelKey: 'panels.item.closeAll', descKey: 'panels.item.closeAllDesc' },
}
