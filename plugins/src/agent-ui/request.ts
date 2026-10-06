import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import {
  agentSettingsFromSyncDocument,
  type AgentSyncDocument,
  agentSyncDocumentFromSettings,
  type AgentSyncSettings,
  applySettingsDiffToAgentSyncDocument,
  createEmptyAgentSyncDocument,
  parseAgentSyncDocument,
  withAgentSyncActor,
} from '@/lib/game-agent/settings-sync'
import { cacheToolSettings, normalizeToolSettings, readCachedToolSettings } from '@/lib/game-agent/tool-settings'

import { chayaFetch } from '../helpers'

const SYNC_KEY = 'chaya.gameAgent.pluginSync.v1'
const ACTOR_KEY = 'chaya.gameAgent.pluginActor.v1'
const LEGACY_SETTINGS_KEY = 'chaya.gameAgent.settings'
const AUTO_SYNC_MS = 5_000
const SYNC_EVENT = 'chaya:agent-settings-synced'

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

function readLocalSync(actor: string): AgentSyncDocument | null {
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

function writeLocalSync(document: AgentSyncDocument) {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(document))
  } catch {
    /* A successful server write remains authoritative when plugin storage is unavailable. */
  }
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
  let inFlight: Promise<AgentSyncDocument> | null = null

  const sync = async () => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const previous = local ? JSON.stringify(local) : ''
      const candidate = local || createEmptyAgentSyncDocument(actor)
      const response = await remote('/api/integration/game-agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync: candidate }),
      })
      const body = (await response.json().catch(() => null)) as { sync?: AgentSyncDocument }
      if (!response.ok || !body.sync) throw new Error(apiError(body, `HTTP ${response.status}`))
      const parsed = parseAgentSyncDocument(body.sync)
      if (!parsed) throw new Error('服务返回了无效的 Agent 同步数据')
      local = withAgentSyncActor(parsed, actor)
      writeLocalSync(local)
      if (previous && previous !== JSON.stringify(local)) window.dispatchEvent(new CustomEvent(SYNC_EVENT))
      return local
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return async (path, init) => {
    const url = new URL(path, location.origin)
    const method = (init?.method || 'GET').toUpperCase()
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
      local = applySettingsDiffToAgentSyncDocument(local!, agentSettingsFromSyncDocument(baseline), body.settings)
      writeLocalSync(local)
      try {
        const document = await sync()
        return jsonResponse({ ok: true, settings: agentSettingsFromSyncDocument(document), sync: document })
      } catch {
        return jsonResponse({ ok: true, settings: agentSettingsFromSyncDocument(local), sync: local, pendingSync: true })
      }
    }

    if (url.pathname === '/api/game-agent/status') {
      await sync().catch(() => null)
    }
    return remote(path, init)
  }
}

export const pluginGameAgentRequest = createPluginGameAgentRequest()

/** Keeps an open game converged with service-side edits without touching either side before the first merge. */
export function startPluginGameAgentSync() {
  let stopped = false
  const run = () => {
    if (stopped) return
    void pluginGameAgentRequest('/api/integration/game-agent', { cache: 'no-store' })
    void pluginGameAgentRequest('/api/integration/game-agent/tools', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok || stopped) return
        const body = (await response.json()) as { settings?: unknown }
        const next = normalizeToolSettings(body.settings)
        if (JSON.stringify(next) !== JSON.stringify(readCachedToolSettings())) cacheToolSettings(next)
      })
      .catch(() => {})
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
