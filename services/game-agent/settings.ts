import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import {
  agentSettingsFromSyncDocument,
  type AgentSyncDocument,
  agentSyncDocumentFromSettings,
  applySettingsDiffToAgentSyncDocument,
  applySettingsToAgentSyncDocument,
  createEmptyAgentSyncDocument,
  mergeAgentSyncDocuments,
  parseAgentSyncDocument,
  withAgentSyncActor,
} from '@/lib/game-agent/settings-sync'

import { DEFAULT_GAME_AGENT_MODEL, DEFAULT_OLLAMA_HOST } from './ollama-client'

export type GameAgentProvider = 'ollama'

export type GameAgentProfile = {
  id: string
  label: string
  provider: GameAgentProvider
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
}

export type GameAgentSettings = {
  version: 1
  defaultProfileId: string
  profiles: GameAgentProfile[]
}

export const GAME_AGENT_SETTINGS_PATH = path.join(DATA_DIR, 'game-agent-settings.json')
export const GAME_AGENT_SYNC_PATH = path.join(DATA_DIR, 'game-agent-settings.sync.json')
export const GAME_AGENT_SERVICE_ACTOR = 'service:chaya'

export function defaultGameAgentProfile(): GameAgentProfile {
  return {
    id: 'ollama-local',
    label: 'Local Ollama',
    provider: 'ollama',
    endpoint: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
    defaultModel: DEFAULT_GAME_AGENT_MODEL,
    temperature: 0.2,
    keepAlive: '10m',
  }
}

export function defaultGameAgentSettings(): GameAgentSettings {
  const profile = defaultGameAgentProfile()
  return { version: 1, defaultProfileId: profile.id, profiles: [profile] }
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function normalizeGameAgentEndpoint(value: unknown): string {
  const raw = text(value, DEFAULT_OLLAMA_HOST)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('服务地址必须是完整的 HTTP 或 HTTPS URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('服务地址仅支持 HTTP 或 HTTPS')
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export function normalizeGameAgentProfile(value: Partial<GameAgentProfile>, fallbackId: string = randomUUID()): GameAgentProfile {
  if (value.provider && value.provider !== 'ollama') throw new Error(`暂不支持接入类型：${String(value.provider)}`)
  const temperature = Number(value.temperature ?? 0.2)
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('Temperature 必须在 0 到 2 之间')
  const keepAlive = text(value.keepAlive, '10m')
  if (!/^(?:-1|0|\d+(?:\.\d+)?(?:ms|s|m|h))$/.test(keepAlive)) throw new Error('Keep Alive 格式无效，例如 10m、1h、0 或 -1')
  return {
    id: text(value.id, fallbackId),
    label: text(value.label, 'Ollama'),
    provider: 'ollama',
    endpoint: normalizeGameAgentEndpoint(value.endpoint),
    defaultModel: typeof value.defaultModel === 'string' ? value.defaultModel.trim() : '',
    temperature,
    keepAlive,
  }
}

export function normalizeGameAgentSettings(value: Partial<GameAgentSettings>): GameAgentSettings {
  const source = Array.isArray(value.profiles) && value.profiles.length ? value.profiles : [defaultGameAgentProfile()]
  const profiles = source.map((profile) => normalizeGameAgentProfile(profile))
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('接入实例 id 不能重复')
  return { version: 1, defaultProfileId: profiles[0].id, profiles }
}

export function loadGameAgentSettings(file = GAME_AGENT_SETTINGS_PATH): GameAgentSettings {
  try {
    if (!fs.existsSync(file)) return defaultGameAgentSettings()
    return normalizeGameAgentSettings(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<GameAgentSettings>)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Agent 配置文件不是有效的 JSON')
    throw error
  }
}

export function saveGameAgentSettings(value: Partial<GameAgentSettings>, file = GAME_AGENT_SETTINGS_PATH): GameAgentSettings {
  const settings = normalizeGameAgentSettings(value)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
  return settings
}

function writeJsonAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
}

export function loadGameAgentSyncDocument(syncFile = GAME_AGENT_SYNC_PATH, settingsFile = GAME_AGENT_SETTINGS_PATH): AgentSyncDocument {
  if (fs.existsSync(syncFile)) {
    const parsed = parseAgentSyncDocument(JSON.parse(fs.readFileSync(syncFile, 'utf8')))
    if (!parsed) throw new Error('Agent 同步文件格式无效')
    return withAgentSyncActor(parsed, GAME_AGENT_SERVICE_ACTOR)
  }
  if (!fs.existsSync(settingsFile)) return createEmptyAgentSyncDocument(GAME_AGENT_SERVICE_ACTOR)
  const modifiedAt = Math.max(1, Math.floor(fs.statSync(settingsFile).mtimeMs))
  return agentSyncDocumentFromSettings(loadGameAgentSettings(settingsFile), GAME_AGENT_SERVICE_ACTOR, modifiedAt)
}

export function saveGameAgentSyncDocument(document: AgentSyncDocument, syncFile = GAME_AGENT_SYNC_PATH, settingsFile = GAME_AGENT_SETTINGS_PATH) {
  const parsed = parseAgentSyncDocument(document)
  if (!parsed) throw new Error('Agent 同步数据格式无效')
  let serviceDocument = withAgentSyncActor(parsed, GAME_AGENT_SERVICE_ACTOR)
  const settings = normalizeGameAgentSettings(agentSettingsFromSyncDocument(serviceDocument))
  serviceDocument = applySettingsToAgentSyncDocument(serviceDocument, settings)
  writeJsonAtomic(syncFile, serviceDocument)
  saveGameAgentSettings(settings, settingsFile)
  return { sync: serviceDocument, settings }
}

export function updateGameAgentSyncFromSettings(
  value: Partial<GameAgentSettings>,
  actorId = GAME_AGENT_SERVICE_ACTOR,
  baseline?: AgentSyncDocument,
  syncFile = GAME_AGENT_SYNC_PATH,
  settingsFile = GAME_AGENT_SETTINGS_PATH
) {
  const current = withAgentSyncActor(loadGameAgentSyncDocument(syncFile, settingsFile), actorId)
  const parsedBaseline = baseline ? parseAgentSyncDocument(baseline) : null
  const baseSettings = parsedBaseline ? agentSettingsFromSyncDocument(parsedBaseline) : agentSettingsFromSyncDocument(current)
  const next = applySettingsDiffToAgentSyncDocument(current, baseSettings, normalizeGameAgentSettings(value))
  return saveGameAgentSyncDocument(next, syncFile, settingsFile)
}

export function mergeGameAgentSyncDocument(incoming: AgentSyncDocument, syncFile = GAME_AGENT_SYNC_PATH, settingsFile = GAME_AGENT_SETTINGS_PATH) {
  const parsed = parseAgentSyncDocument(incoming)
  if (!parsed) throw new Error('Agent 同步数据格式无效')
  const current = loadGameAgentSyncDocument(syncFile, settingsFile)
  let merged = mergeAgentSyncDocuments(current, parsed)
  if (agentSettingsFromSyncDocument(merged).profiles.length === 0) {
    merged = applySettingsToAgentSyncDocument(merged, defaultGameAgentSettings())
  }
  if (JSON.stringify(merged) === JSON.stringify(current)) {
    return { sync: current, settings: normalizeGameAgentSettings(agentSettingsFromSyncDocument(current)) }
  }
  return saveGameAgentSyncDocument(merged, syncFile, settingsFile)
}

export function profileById(settings: GameAgentSettings, id: string) {
  return settings.profiles.find((profile) => profile.id === id) || null
}
