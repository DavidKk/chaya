import { randomUUID } from 'node:crypto'

import { agentSettingsFromSyncDocument } from '@/lib/game-agent/settings-sync'

import { deleteGameAgentToken, type GameAgentSecretFiles, hasGameAgentToken, saveGameAgentToken } from './secrets'
import {
  defaultGameAgentSettings,
  GAME_AGENT_SERVICE_ACTOR,
  GAME_AGENT_SETTINGS_PATH,
  GAME_AGENT_SYNC_PATH,
  type GameAgentProfile,
  type GameAgentSettings,
  loadGameAgentSyncDocument,
  normalizeGameAgentProfile,
  updateGameAgentSyncFromSettings,
} from './settings'

export type GameAgentProfileFiles = GameAgentSecretFiles & { settingsFile?: string; syncFile?: string }
export type GameAgentProfilePatch = Partial<Omit<GameAgentProfile, 'id' | 'provider'>> & { id?: string; token?: string; clearToken?: boolean }

function paths(input: GameAgentProfileFiles = {}) {
  return { settingsFile: input.settingsFile || GAME_AGENT_SETTINGS_PATH, syncFile: input.syncFile || GAME_AGENT_SYNC_PATH }
}

function current(input: GameAgentProfileFiles = {}): GameAgentSettings {
  const resolved = paths(input)
  const sync = loadGameAgentSyncDocument(resolved.syncFile, resolved.settingsFile)
  const settings = agentSettingsFromSyncDocument(sync)
  return settings.profiles.length ? settings : defaultGameAgentSettings()
}

function save(settings: GameAgentSettings, input: GameAgentProfileFiles = {}) {
  const resolved = paths(input)
  return updateGameAgentSyncFromSettings(settings, GAME_AGENT_SERVICE_ACTOR, undefined, resolved.syncFile, resolved.settingsFile).settings
}

function resolveProfile(settings: GameAgentSettings, target: string): GameAgentProfile {
  const exactId = settings.profiles.find((profile) => profile.id === target)
  if (exactId) return exactId
  const matches = settings.profiles.filter((profile) => profile.label.localeCompare(target, undefined, { sensitivity: 'accent' }) === 0)
  if (matches.length > 1) throw new Error(`名称 ${target} 对应多个 Agent，请使用 id`)
  if (!matches.length) throw new Error(`找不到 Agent：${target}`)
  return matches[0]
}

function view(profile: GameAgentProfile, input: GameAgentProfileFiles = {}) {
  return { ...profile, hasToken: hasGameAgentToken(profile.id, input) }
}

export function listGameAgentProfiles(input: GameAgentProfileFiles = {}) {
  const settings = current(input)
  return { defaultProfileId: settings.profiles[0]?.id || '', profiles: settings.profiles.map((profile) => view(profile, input)) }
}

export function createGameAgentProfile(patch: GameAgentProfilePatch, input: GameAgentProfileFiles = {}) {
  if (!patch.label?.trim()) throw new Error('创建 Agent 时必须提供名称')
  const settings = current(input)
  const profile = normalizeGameAgentProfile({ ...patch, id: patch.id || randomUUID(), provider: 'ollama' })
  if (settings.profiles.some((item) => item.id === profile.id)) throw new Error(`Agent id 已存在：${profile.id}`)
  const saved = save({ ...settings, profiles: [...settings.profiles, profile] }, input)
  if (patch.token !== undefined || patch.clearToken) saveGameAgentToken(profile.id, patch.clearToken ? null : patch.token || null, input)
  return view(
    saved.profiles.find((item) => item.id === profile.id)!,
    input
  )
}

export function updateGameAgentProfile(target: string, patch: GameAgentProfilePatch, input: GameAgentProfileFiles = {}) {
  const settings = current(input)
  const existing = resolveProfile(settings, target)
  const profile = normalizeGameAgentProfile({ ...existing, ...patch, id: existing.id, provider: existing.provider }, existing.id)
  const saved = save({ ...settings, profiles: settings.profiles.map((item) => (item.id === existing.id ? profile : item)) }, input)
  if (patch.token !== undefined || patch.clearToken) saveGameAgentToken(existing.id, patch.clearToken ? null : patch.token || null, input)
  return view(
    saved.profiles.find((item) => item.id === existing.id)!,
    input
  )
}

export function deleteGameAgentProfile(target: string, input: GameAgentProfileFiles = {}) {
  const settings = current(input)
  const existing = resolveProfile(settings, target)
  if (settings.profiles.length <= 1) throw new Error('至少需要保留一个 Agent')
  const saved = save({ ...settings, profiles: settings.profiles.filter((item) => item.id !== existing.id) }, input)
  deleteGameAgentToken(existing.id, input)
  return { deleted: { id: existing.id, label: existing.label }, defaultProfileId: saved.profiles[0]?.id || '', count: saved.profiles.length }
}
