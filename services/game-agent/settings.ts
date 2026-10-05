import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'

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

export function normalizeGameAgentProfile(value: Partial<GameAgentProfile>, fallbackId = randomUUID()): GameAgentProfile {
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
  const requestedDefault = text(value.defaultProfileId, profiles[0].id)
  return { version: 1, defaultProfileId: profiles.some((profile) => profile.id === requestedDefault) ? requestedDefault : profiles[0].id, profiles }
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

export function profileById(settings: GameAgentSettings, id: string) {
  return settings.profiles.find((profile) => profile.id === id) || null
}
