import { type CompanionCharacter, normalizeCompanionCharacter } from './companion'

export const MINI_PANEL_IDS = ['miniMap', 'companion', 'autoSaves', 'quickSaves'] as const
export type MiniPanelId = (typeof MINI_PANEL_IDS)[number]

/** 迷你面板管理里的按钮项；顺序即显示顺序 */
export const PANEL_DOCK_ITEMS = [...MINI_PANEL_IDS, 'closeAll'] as const
export type PanelDockItem = (typeof PANEL_DOCK_ITEMS)[number]
export type PanelDockOrientation = 'horizontal' | 'vertical'

export type ToolSettings = {
  companionEnabled: boolean
  miniMapEnabled: boolean
  /** 游戏内的自动存档 / 快速存档迷你面板 */
  autoSavePanelEnabled: boolean
  quickSavePanelEnabled: boolean
  companionCharacter: CompanionCharacter
  panelDockEnabled: boolean
  /** 存隐藏的项：以后新增的迷你面板默认显示 */
  panelDockHiddenItems: PanelDockItem[]
  panelDockOrientation: PanelDockOrientation
  /** 能力增强：点击移动用整图寻路，绕开会触发的事件格 */
  smartPathEnabled: boolean
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  companionEnabled: false,
  miniMapEnabled: false,
  autoSavePanelEnabled: false,
  quickSavePanelEnabled: false,
  companionCharacter: 'rin',
  panelDockEnabled: false,
  panelDockHiddenItems: [],
  panelDockOrientation: 'horizontal',
  smartPathEnabled: true,
}
export const TOOL_SETTINGS_EVENT = 'chaya:tool-settings-changed'
export const TOOL_SETTINGS_STORAGE_KEY = 'chaya.gameAgent.toolSettings.v1'

export function normalizeToolSettings(value: unknown): ToolSettings {
  const source = value && typeof value === 'object' ? (value as Partial<ToolSettings> & { companionPersona?: string }) : {}
  return {
    companionEnabled: typeof source.companionEnabled === 'boolean' ? source.companionEnabled : false,
    miniMapEnabled: typeof source.miniMapEnabled === 'boolean' ? source.miniMapEnabled : false,
    autoSavePanelEnabled: typeof source.autoSavePanelEnabled === 'boolean' ? source.autoSavePanelEnabled : false,
    quickSavePanelEnabled: typeof source.quickSavePanelEnabled === 'boolean' ? source.quickSavePanelEnabled : false,
    companionCharacter: normalizeCompanionCharacter(source.companionCharacter ?? source.companionPersona),
    panelDockEnabled: typeof source.panelDockEnabled === 'boolean' ? source.panelDockEnabled : false,
    panelDockHiddenItems: Array.isArray(source.panelDockHiddenItems) ? PANEL_DOCK_ITEMS.filter((item) => source.panelDockHiddenItems!.includes(item)) : [],
    panelDockOrientation: source.panelDockOrientation === 'vertical' ? 'vertical' : 'horizontal',
    smartPathEnabled: typeof source.smartPathEnabled === 'boolean' ? source.smartPathEnabled : true,
  }
}

export function readCachedToolSettings(): ToolSettings {
  try {
    return normalizeToolSettings(JSON.parse(localStorage.getItem(TOOL_SETTINGS_STORAGE_KEY) || 'null'))
  } catch {
    return DEFAULT_TOOL_SETTINGS
  }
}

export function cacheToolSettings(settings: ToolSettings) {
  try {
    localStorage.setItem(TOOL_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // The current page still receives the update when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(TOOL_SETTINGS_EVENT, { detail: settings }))
}
