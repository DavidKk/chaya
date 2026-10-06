import { type CompanionCharacter, normalizeCompanionCharacter } from './companion'

export type ToolSettings = {
  companionEnabled: boolean
  miniMapEnabled: boolean
  companionCharacter: CompanionCharacter
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = { companionEnabled: true, miniMapEnabled: true, companionCharacter: 'rin' }
export const TOOL_SETTINGS_EVENT = 'chaya:tool-settings-changed'
const STORAGE_KEY = 'chaya.gameAgent.toolSettings.v1'

export function normalizeToolSettings(value: unknown): ToolSettings {
  const source = value && typeof value === 'object' ? (value as Partial<ToolSettings> & { companionPersona?: string }) : {}
  return {
    companionEnabled: typeof source.companionEnabled === 'boolean' ? source.companionEnabled : true,
    miniMapEnabled: typeof source.miniMapEnabled === 'boolean' ? source.miniMapEnabled : true,
    companionCharacter: normalizeCompanionCharacter(source.companionCharacter ?? source.companionPersona),
  }
}

export function readCachedToolSettings(): ToolSettings {
  try {
    return normalizeToolSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'))
  } catch {
    return DEFAULT_TOOL_SETTINGS
  }
}

export function cacheToolSettings(settings: ToolSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // The current page still receives the update when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(TOOL_SETTINGS_EVENT, { detail: settings }))
}
