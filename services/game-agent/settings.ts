import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR, GAME_AGENT_DIR } from '@/constants/paths'
import { type GameAgentProvider, isCliProvider, isGameAgentProvider, isOpenApiProvider, PROVIDER_META } from '@/lib/game-agent/providers'
import { type AgentProxyProtocols, normalizeAgentProxy, normalizeAgentProxyHeaders, normalizeAgentProxyProtocols } from '@/lib/game-agent/proxy'
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
import { type AgentTimeoutSettings, normalizeAgentTimeouts } from '@/lib/game-agent/timeouts'

import { DEFAULT_GAME_AGENT_MODEL, DEFAULT_OLLAMA_HOST } from './ollama-client'

export type { GameAgentProvider }

export type GameAgentProfile = AgentTimeoutSettings & {
  id: string
  label: string
  provider: GameAgentProvider
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
  /**
   * Default proxy (ZeroOmega-style). Empty = no per-agent proxy.
   * Fills http / https / socks5 / all / ftp unless a slot is overridden.
   */
  proxy: string
  /** Per-protocol overrides; empty slots inherit `proxy`. */
  proxyProtocols: AgentProxyProtocols
  /** Extra headers sent to the upstream proxy (all providers). */
  proxyHeaders: Record<string, string>
}

export type GameAgentSettings = {
  version: 1
  defaultProfileId: string
  profiles: GameAgentProfile[]
}

/** Canonical paths under `data/game-agent/` (legacy flat names at `data/` root are migrated once). */
export const GAME_AGENT_SETTINGS_PATH = path.join(GAME_AGENT_DIR, 'settings.json')
export const GAME_AGENT_SYNC_PATH = path.join(GAME_AGENT_DIR, 'settings.sync.json')
const LEGACY_GAME_AGENT_SETTINGS_PATH = path.join(DATA_DIR, 'game-agent-settings.json')
const LEGACY_GAME_AGENT_SYNC_PATH = path.join(DATA_DIR, 'game-agent-settings.sync.json')
export const GAME_AGENT_SERVICE_ACTOR = 'service:chaya'

function migrateLegacyAgentFile(from: string, to: string) {
  try {
    if (!fs.existsSync(from) || fs.existsSync(to)) return
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
  } catch {
    try {
      if (!fs.existsSync(from) || fs.existsSync(to)) return
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      fs.rmSync(from, { force: true })
    } catch {
      /* keep reading legacy path via resolve below if migrate fails */
    }
  }
}

function resolveAgentSettingsFile(preferred: string, legacy: string): string {
  migrateLegacyAgentFile(legacy, preferred)
  if (fs.existsSync(preferred)) return preferred
  if (fs.existsSync(legacy)) return legacy
  return preferred
}

function settingsFilePath(file = GAME_AGENT_SETTINGS_PATH) {
  return file === GAME_AGENT_SETTINGS_PATH ? resolveAgentSettingsFile(GAME_AGENT_SETTINGS_PATH, LEGACY_GAME_AGENT_SETTINGS_PATH) : file
}

function syncFilePath(file = GAME_AGENT_SYNC_PATH) {
  return file === GAME_AGENT_SYNC_PATH ? resolveAgentSettingsFile(GAME_AGENT_SYNC_PATH, LEGACY_GAME_AGENT_SYNC_PATH) : file
}

export function defaultGameAgentProfile(): GameAgentProfile {
  return {
    id: 'ollama-local',
    label: 'Local Ollama',
    provider: 'ollama',
    endpoint: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
    defaultModel: DEFAULT_GAME_AGENT_MODEL,
    temperature: 0.2,
    keepAlive: '10m',
    proxy: '',
    proxyProtocols: {},
    proxyHeaders: {},
    ...normalizeAgentTimeouts({}),
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
    throw new Error('Service endpoint must be a valid HTTP or HTTPS URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Service endpoint only supports HTTP or HTTPS')
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export function normalizeGameAgentProfile(value: Partial<GameAgentProfile>, fallbackId: string = randomUUID()): GameAgentProfile {
  if (value.provider !== undefined && !isGameAgentProvider(value.provider)) throw new Error(`Unsupported agent provider: ${String(value.provider)}`)
  const provider = value.provider || 'ollama'
  const proxy = normalizeAgentProxy(value.proxy)
  const proxyProtocols = normalizeAgentProxyProtocols(proxy, value.proxyProtocols)
  const proxyHeaders = normalizeAgentProxyHeaders(value.proxyHeaders)
  if (isCliProvider(provider)) {
    // HTTP-only fields keep fixed values so sync records stay comparable; CLI runs ignore them.
    return {
      id: text(value.id, fallbackId),
      label: text(value.label, PROVIDER_META[provider].label),
      provider,
      endpoint: '',
      defaultModel: typeof value.defaultModel === 'string' ? value.defaultModel.trim() : '',
      temperature: 0.2,
      keepAlive: '10m',
      proxy,
      proxyProtocols,
      proxyHeaders,
      ...normalizeAgentTimeouts(value),
    }
  }
  const temperature = Number(value.temperature ?? 0.2)
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('Temperature must be between 0 and 2')
  const keepAlive = text(value.keepAlive, '10m')
  if (!/^(?:-1|0|\d+(?:\.\d+)?(?:ms|s|m|h))$/.test(keepAlive)) throw new Error('Invalid Keep Alive format, e.g. 10m, 1h, 0, or -1')
  if (isOpenApiProvider(provider)) {
    return {
      id: text(value.id, fallbackId),
      label: text(value.label, PROVIDER_META[provider].label),
      provider,
      endpoint: normalizeGameAgentEndpoint(value.endpoint || PROVIDER_META[provider].defaultEndpoint || ''),
      defaultModel: typeof value.defaultModel === 'string' ? value.defaultModel.trim() : '',
      temperature,
      keepAlive,
      proxy,
      proxyProtocols,
      proxyHeaders,
      ...normalizeAgentTimeouts(value),
    }
  }
  return {
    id: text(value.id, fallbackId),
    label: text(value.label, 'Ollama'),
    provider: 'ollama',
    endpoint: normalizeGameAgentEndpoint(value.endpoint),
    defaultModel: typeof value.defaultModel === 'string' ? value.defaultModel.trim() : '',
    temperature,
    keepAlive,
    proxy,
    proxyProtocols,
    proxyHeaders,
    ...normalizeAgentTimeouts(value),
  }
}

export function normalizeGameAgentSettings(value: Partial<GameAgentSettings>): GameAgentSettings {
  const source = Array.isArray(value.profiles) && value.profiles.length ? value.profiles : [defaultGameAgentProfile()]
  const profiles = source.map((profile) => normalizeGameAgentProfile(profile))
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('Agent profile id must be unique')
  return { version: 1, defaultProfileId: profiles[0].id, profiles }
}

export function loadGameAgentSettings(file = GAME_AGENT_SETTINGS_PATH): GameAgentSettings {
  const resolved = settingsFilePath(file)
  try {
    if (!fs.existsSync(resolved)) return defaultGameAgentSettings()
    return normalizeGameAgentSettings(JSON.parse(fs.readFileSync(resolved, 'utf8')) as Partial<GameAgentSettings>)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Agent configuration file is not valid JSON')
    throw error
  }
}

export function saveGameAgentSettings(value: Partial<GameAgentSettings>, file = GAME_AGENT_SETTINGS_PATH): GameAgentSettings {
  const settings = normalizeGameAgentSettings(value)
  const resolved = file === GAME_AGENT_SETTINGS_PATH ? GAME_AGENT_SETTINGS_PATH : file
  migrateLegacyAgentFile(LEGACY_GAME_AGENT_SETTINGS_PATH, GAME_AGENT_SETTINGS_PATH)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const temp = `${resolved}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, resolved)
  if (resolved === GAME_AGENT_SETTINGS_PATH) fs.rmSync(LEGACY_GAME_AGENT_SETTINGS_PATH, { force: true })
  return settings
}

function writeJsonAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
}

export function loadGameAgentSyncDocument(syncFile = GAME_AGENT_SYNC_PATH, settingsFile = GAME_AGENT_SETTINGS_PATH): AgentSyncDocument {
  const resolvedSync = syncFilePath(syncFile)
  const resolvedSettings = settingsFilePath(settingsFile)
  if (fs.existsSync(resolvedSync)) {
    const parsed = parseAgentSyncDocument(JSON.parse(fs.readFileSync(resolvedSync, 'utf8')))
    if (!parsed) throw new Error('Agent sync file format is invalid')
    return withAgentSyncActor(parsed, GAME_AGENT_SERVICE_ACTOR)
  }
  if (!fs.existsSync(resolvedSettings)) return createEmptyAgentSyncDocument(GAME_AGENT_SERVICE_ACTOR)
  const modifiedAt = Math.max(1, Math.floor(fs.statSync(resolvedSettings).mtimeMs))
  return agentSyncDocumentFromSettings(loadGameAgentSettings(settingsFile), GAME_AGENT_SERVICE_ACTOR, modifiedAt)
}

export function saveGameAgentSyncDocument(document: AgentSyncDocument, syncFile = GAME_AGENT_SYNC_PATH, settingsFile = GAME_AGENT_SETTINGS_PATH) {
  const parsed = parseAgentSyncDocument(document)
  if (!parsed) throw new Error('Agent sync data format is invalid')
  let serviceDocument = withAgentSyncActor(parsed, GAME_AGENT_SERVICE_ACTOR)
  const settings = normalizeGameAgentSettings(agentSettingsFromSyncDocument(serviceDocument))
  serviceDocument = applySettingsToAgentSyncDocument(serviceDocument, settings)
  const resolvedSync = syncFile === GAME_AGENT_SYNC_PATH ? GAME_AGENT_SYNC_PATH : syncFile
  migrateLegacyAgentFile(LEGACY_GAME_AGENT_SYNC_PATH, GAME_AGENT_SYNC_PATH)
  writeJsonAtomic(resolvedSync, serviceDocument)
  if (resolvedSync === GAME_AGENT_SYNC_PATH) fs.rmSync(LEGACY_GAME_AGENT_SYNC_PATH, { force: true })
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
  if (!parsed) throw new Error('Agent sync data format is invalid')
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

export function ollamaProfiles(settings: GameAgentSettings) {
  return settings.profiles.filter((profile) => profile.provider === 'ollama')
}
