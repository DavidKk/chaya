import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { CLI_PROVIDERS_FEATURE } from '@/lib/game-agent/providers'
import {
  agentSettingsFromSyncDocument,
  type AgentSyncDocument,
  agentSyncDocumentFromSettings,
  type AgentSyncSettings,
  applySettingsDiffToAgentSyncDocument,
  createEmptyAgentSyncDocument,
  mergeAgentSyncDocuments,
  parseAgentSyncDocument,
  withAgentSyncActor,
} from '@/lib/game-agent/settings-sync'

import { readSharedAgentSync, writeSharedAgentSync } from '../agent/shared-settings'
import { chayaFetch } from '../helpers'
import { createDirectGameAgentRequest } from './direct-request'

const SYNC_KEY = 'chaya.gameAgent.pluginSync.v1'
const ACTOR_KEY = 'chaya.gameAgent.pluginActor.v1'
const LEGACY_SETTINGS_KEY = 'chaya.gameAgent.settings'
const AUTO_SYNC_MS = 5_000
const SYNC_EVENT = 'chaya:agent-settings-synced'
const RUNTIME_CONFIG_KEY = 'chaya.agent.runtimeConfig.v1'
const RUNTIME_MODELS_KEY = 'chaya.agent.runtimeModels.v1'
type AgentModels = Record<string, Array<{ name: string; label?: string }>>

function readRuntimeConfig(): AgentSyncSettings | null {
  try {
    const value = JSON.parse(localStorage.getItem(RUNTIME_CONFIG_KEY) || 'null') as AgentSyncSettings | null
    return value?.version === 1 && Array.isArray(value.profiles) && value.profiles.length ? value : null
  } catch {
    return null
  }
}

function readRuntimeModels(): AgentModels {
  try {
    const value = JSON.parse(localStorage.getItem(RUNTIME_MODELS_KEY) || '{}') as AgentModels
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function writeRuntimeModels(models: AgentModels) {
  try {
    localStorage.setItem(RUNTIME_MODELS_KEY, JSON.stringify(models))
  } catch {
    /* The current synchronized list remains available in memory. */
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function actorId() {
  try {
    const stored = localStorage.getItem(ACTOR_KEY)
    if (stored?.startsWith('plugin:')) return stored
    const id = `plugin:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
    localStorage.setItem(ACTOR_KEY, id)
    return id
  } catch {
    return 'plugin:volatile'
  }
}

function readGameSync(actor: string): AgentSyncDocument | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY)
    const parsed = raw ? parseAgentSyncDocument(JSON.parse(raw)) : null
    if (parsed) return withAgentSyncActor(parsed, actor)
    const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (!legacyRaw) return null
    const legacy = JSON.parse(legacyRaw) as AgentSyncSettings
    if (!Array.isArray(legacy.profiles) || legacy.profiles.length === 0) return null
    return agentSyncDocumentFromSettings({ ...legacy, version: 1, defaultProfileId: legacy.profiles[0].id }, actor)
  } catch {
    return null
  }
}

/** The shared per-user file plus this game's own copy (older plugin versions only wrote the latter). */
function readLocalSync(actor: string, current: AgentSyncDocument | null = readGameSync(actor)): AgentSyncDocument | null {
  const shared = readSharedAgentSync()
  if (!shared) return current
  return current ? mergeAgentSyncDocuments(current, shared) : withAgentSyncActor(shared, actor)
}

/** Writes the shared file first; returns the document merged with edits other games saved meanwhile. */
function writeLocalSync(document: AgentSyncDocument): AgentSyncDocument {
  const merged = writeSharedAgentSync(document)
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(merged))
    localStorage.setItem(RUNTIME_CONFIG_KEY, JSON.stringify(agentSettingsFromSyncDocument(merged)))
  } catch {
    /* A successful server write remains authoritative when plugin storage is unavailable. */
  }
  return merged
}

function apiError(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

/**
 * Bidirectional plugin/service adapter. It never writes during construction:
 * the first request reads local state, asks the service to merge, then stores the result.
 */
export function createPluginGameAgentRequest(remote: GameAgentRequest = chayaFetch): GameAgentRequest {
  const actor = actorId()
  let local = readLocalSync(actor)
  let models = readRuntimeModels()
  let inFlight: Promise<AgentSyncDocument> | null = null
  const direct = createDirectGameAgentRequest(
    () => readRuntimeConfig() || (local ? agentSettingsFromSyncDocument(local) : null),
    () => models
  )

  const sync = async () => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      let previous = local ? JSON.stringify(local) : ''
      const absorbed = readLocalSync(actor, local)
      if (absorbed && JSON.stringify(absorbed) !== previous) {
        // Another game edited the shared file; show it here even if the service is offline.
        local = writeLocalSync(absorbed)
        if (previous) window.dispatchEvent(new CustomEvent(SYNC_EVENT))
        previous = JSON.stringify(local)
      }
      const candidate = local || createEmptyAgentSyncDocument(actor)
      const response = await remote('/api/integration/game-agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync: candidate, features: [CLI_PROVIDERS_FEATURE] }),
        signal: AbortSignal.timeout(3_000),
      })
      const body = (await response.json().catch(() => null)) as { sync?: AgentSyncDocument; models?: AgentModels }
      if (!response.ok || !body.sync) throw new Error(apiError(body, `HTTP ${response.status}`))
      const parsed = parseAgentSyncDocument(body.sync)
      if (!parsed) throw new Error('服务返回了无效的 Agent 同步数据')
      local = writeLocalSync(withAgentSyncActor(parsed, actor))
      if (body.models) {
        models = body.models
        writeRuntimeModels(models)
      }
      if (previous && previous !== JSON.stringify(local)) window.dispatchEvent(new CustomEvent(SYNC_EVENT))
      return local
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  const initialSync = async () => {
    if (readRuntimeConfig() || local) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        sync(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Agent 配置同步超时')), 3_000)
        }),
      ])
    } catch {
      /* The in-game task host remains usable with any config already delivered over GameLink. */
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return async (path, init) => {
    const url = new URL(path, location.origin)
    const method = (init?.method || 'GET').toUpperCase()
    if (url.pathname === '/api/game-agent/status' || url.pathname === '/api/game-agent/turn' || url.pathname.startsWith('/api/game-agent/turn/')) {
      await initialSync()
      if (url.pathname === '/api/game-agent/status' && Object.keys(models).length === 0) await sync().catch(() => undefined)
      return direct(path, init)
    }
    if (url.pathname === '/api/integration/game-agent' && method === 'GET') {
      try {
        const document = await sync()
        return jsonResponse({ ok: true, settings: agentSettingsFromSyncDocument(document), sync: document })
      } catch (error) {
        if (local) return jsonResponse({ ok: true, settings: agentSettingsFromSyncDocument(local), sync: local, pendingSync: true })
        return jsonResponse({ error: { code: 'AGENT_SYNC_FAILED', message: error instanceof Error ? error.message : String(error) } }, 503)
      }
    }

    if (url.pathname === '/api/integration/game-agent' && method === 'PUT') {
      const body = JSON.parse(String(init?.body || '{}')) as { settings?: AgentSyncSettings; baseSync?: AgentSyncDocument }
      if (!body.settings?.profiles?.length) return jsonResponse({ error: { code: 'INVALID_AGENT_SETTINGS', message: 'Agent 配置不能为空' } }, 400)
      try {
        await sync()
      } catch {
        if (!local) return jsonResponse({ error: { code: 'AGENT_SYNC_FAILED', message: '尚未取得插件或服务端 Agent 配置' } }, 503)
      }
      const parsedBaseline = body.baseSync ? parseAgentSyncDocument(body.baseSync) : null
      const baseline = parsedBaseline || local!
      local = writeLocalSync(applySettingsDiffToAgentSyncDocument(local!, agentSettingsFromSyncDocument(baseline), body.settings))
      try {
        const document = await sync()
        return jsonResponse({ ok: true, settings: agentSettingsFromSyncDocument(document), sync: document })
      } catch {
        return jsonResponse({ ok: true, settings: agentSettingsFromSyncDocument(local), sync: local, pendingSync: true })
      }
    }

    return remote(path, init)
  }
}

export const pluginGameAgentRequest = createPluginGameAgentRequest()

/**
 * Keeps an open game converged with service-side edits without touching either side before the first merge.
 * Tool settings are not polled here: the always-mounted GameEdit root polls them through `useToolSettings`,
 * which drops reads that race a save.
 */
export function startPluginGameAgentSync() {
  let stopped = false
  const run = () => {
    if (stopped) return
    void pluginGameAgentRequest('/api/integration/game-agent', { cache: 'no-store' })
  }
  const interval = window.setInterval(run, AUTO_SYNC_MS)
  window.addEventListener('focus', run)
  run()
  return () => {
    stopped = true
    window.clearInterval(interval)
    window.removeEventListener('focus', run)
  }
}
