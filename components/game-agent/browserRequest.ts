import { pickAvailableModel } from '@/services/game-agent/ollama-client'

import { createBrowserAgentRuntime } from './browserTurn'
import type { GameAgentRequest } from './GameAgentWorkspace'

export type BrowserAgentProfile = {
  id: string
  label: string
  provider: 'ollama'
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
}

type Settings = { version: 1; defaultProfileId: string; profiles: BrowserAgentProfile[] }
type Model = { name: string }
type ModelCacheEntry = { endpoint: string; models: Model[] }

const SETTINGS_KEY = 'chaya.gameAgent.settings'
const MODELS_KEY = 'chaya.gameAgent.models'

function defaultSettings(): Settings {
  const profile: BrowserAgentProfile = {
    id: 'ollama-local',
    label: 'Local Ollama',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    defaultModel: '',
    temperature: 0.2,
    keepAlive: '10m',
  }
  return { version: 1, defaultProfileId: profile.id, profiles: [profile] }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function settings() {
  const value = readJson<Settings>(SETTINGS_KEY, defaultSettings())
  if (!Array.isArray(value.profiles) || value.profiles.length === 0) return defaultSettings()
  return { ...value, version: 1 as const, defaultProfileId: value.profiles[0].id }
}

function modelCache() {
  return readJson<Record<string, ModelCacheEntry>>(MODELS_KEY, {})
}

function cachedModels(profiles: BrowserAgentProfile[]): Record<string, Model[]> {
  const cache = modelCache()
  return Object.fromEntries(profiles.flatMap((profile) => (cache[profile.id]?.endpoint === profile.endpoint ? [[profile.id, cache[profile.id].models]] : [])))
}

async function testOllama(profile: BrowserAgentProfile): Promise<Model[]> {
  const endpoint = profile.endpoint.replace(/\/+$/, '')
  const result = await fetch(`${endpoint}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
  if (!result.ok) throw new Error(`Ollama HTTP ${result.status}`)
  const body = (await result.json()) as { models?: Array<{ name?: unknown }> }
  return (body.models || []).flatMap((item) => (typeof item.name === 'string' && item.name ? [{ name: item.name }] : []))
}

/** Edge 没有本机 Node API；同一套 Agent UI 通过浏览器存储维护接入配置。 */
export function createBrowserGameAgentRequest(input: { connected: boolean }, runtime = createBrowserAgentRuntime()): GameAgentRequest {
  return async (path, init) => {
    const url = new URL(path, location.origin)
    const method = (init?.method || 'GET').toUpperCase()

    if (url.pathname === '/api/integration/game-agent') {
      if (method === 'GET') {
        const current = settings()
        return response({ ok: true, settings: current, models: cachedModels(current.profiles) })
      }
      const body = JSON.parse(String(init?.body || '{}')) as { action?: string; profile?: BrowserAgentProfile; settings?: Settings }
      if (method === 'PUT' && body.settings?.profiles?.length) {
        const next = { ...body.settings, version: 1 as const, defaultProfileId: body.settings.profiles[0].id }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
        return response({ ok: true, settings: next })
      }
      if (method === 'POST' && (body.action === 'test' || body.action === 'models') && body.profile) {
        try {
          const models = await testOllama(body.profile)
          const cached = modelCache()
          cached[body.profile.id] = { endpoint: body.profile.endpoint, models }
          localStorage.setItem(MODELS_KEY, JSON.stringify(cached))
          const defaultModel = models.some((model) => model.name === body.profile!.defaultModel) ? body.profile.defaultModel : models[0]?.name || ''
          return response({ ok: true, profileId: body.profile.id, models, defaultModel })
        } catch (error) {
          return response({ error: { code: 'AGENT_CONNECTION_FAILED', message: error instanceof Error ? error.message : String(error) } }, 400)
        }
      }
      return response({ error: { code: 'INVALID_AGENT_ACTION', message: '不支持的 Agent 配置操作' } }, 400)
    }

    if (url.pathname === '/api/game-agent/status') {
      const current = settings()
      const models = cachedModels(current.profiles)
      return response({
        ok: true,
        available: Object.values(models).some((items) => items.length > 0),
        gameOnline: input.connected,
        profiles: current.profiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          provider: profile.provider,
          online: Boolean(models[profile.id]?.length),
          models: models[profile.id] || [],
          defaultModel: pickAvailableModel(models[profile.id] || [], profile.defaultModel),
          reason: models[profile.id]?.length ? null : '未读取到可用模型，请检查服务地址',
        })),
        defaultProfileId: current.profiles[0]?.id || '',
        session: runtime.latestSession() ? { id: runtime.latestSession()!.id, profileId: '', activeTurnId: null } : null,
        reason: Object.values(models).some((items) => items.length > 0) ? null : '未读取到可用模型，请检查服务地址',
      })
    }

    if (url.pathname === '/api/game-agent/turn' && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}')) as {
        profileId?: string
        model?: string
        prompt?: string
        locale?: string
        sessionId?: string
        newSession?: boolean
      }
      const profile = settings().profiles.find((item) => item.id === body.profileId)
      if (!profile || !body.model?.trim() || !body.prompt?.trim()) {
        return response({ error: { code: 'INVALID_AGENT_TURN', message: '平台、模型和消息不能为空' } }, 400)
      }
      return runtime.start({
        profile,
        model: body.model.trim(),
        prompt: body.prompt.trim(),
        locale: body.locale || 'zh-CN',
        sessionId: body.sessionId,
        newSession: body.newSession,
        signal: init?.signal,
      })
    }

    const stopMatch = url.pathname.match(/^\/api\/game-agent\/turn\/([^/]+)$/)
    if (stopMatch && method === 'DELETE') return response({ ok: runtime.stop(decodeURIComponent(stopMatch[1])) })

    return response({ error: { code: 'NOT_FOUND', message: '不支持的 Agent 请求' } }, 404)
  }
}
