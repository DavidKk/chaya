import type { GameAgentRequest } from './GameAgentWorkspace'

type Profile = {
  id: string
  label: string
  provider: 'ollama'
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
}

type Settings = { version: 1; defaultProfileId: string; profiles: Profile[] }
type Model = { name: string }

const SETTINGS_KEY = 'chaya.gameAgent.settings'
const MODELS_KEY = 'chaya.gameAgent.models'

function defaultSettings(): Settings {
  const profile: Profile = {
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

async function testOllama(profile: Profile): Promise<Model[]> {
  const endpoint = profile.endpoint.replace(/\/+$/, '')
  const result = await fetch(`${endpoint}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
  if (!result.ok) throw new Error(`Ollama HTTP ${result.status}`)
  const body = (await result.json()) as { models?: Array<{ name?: unknown }> }
  return (body.models || []).flatMap((item) => (typeof item.name === 'string' && item.name ? [{ name: item.name }] : []))
}

/** Edge 没有本机 Node API；同一套 Agent UI 通过浏览器存储维护接入配置。 */
export function createBrowserGameAgentRequest(input: { connected: boolean }): GameAgentRequest {
  return async (path, init) => {
    const url = new URL(path, location.origin)
    const method = (init?.method || 'GET').toUpperCase()

    if (url.pathname === '/api/integration/game-agent') {
      if (method === 'GET') return response({ ok: true, settings: settings() })
      const body = JSON.parse(String(init?.body || '{}')) as { action?: string; profile?: Profile; settings?: Settings }
      if (method === 'PUT' && body.settings?.profiles?.length) {
        const next = { ...body.settings, version: 1 as const, defaultProfileId: body.settings.profiles[0].id }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
        return response({ ok: true, settings: next })
      }
      if (method === 'POST' && body.action === 'test' && body.profile) {
        try {
          const models = await testOllama(body.profile)
          const cached = readJson<Record<string, Model[]>>(MODELS_KEY, {})
          cached[body.profile.id] = models
          localStorage.setItem(MODELS_KEY, JSON.stringify(cached))
          return response({ ok: true, profileId: body.profile.id, models, defaultModel: body.profile.defaultModel || models[0]?.name || '' })
        } catch (error) {
          return response({ error: { code: 'AGENT_CONNECTION_FAILED', message: error instanceof Error ? error.message : String(error) } }, 400)
        }
      }
      return response({ error: { code: 'INVALID_AGENT_ACTION', message: '不支持的 Agent 配置操作' } }, 400)
    }

    if (url.pathname === '/api/game-agent/status') {
      const current = settings()
      const models = readJson<Record<string, Model[]>>(MODELS_KEY, {})
      return response({
        ok: true,
        available: false,
        gameOnline: input.connected,
        profiles: current.profiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          provider: profile.provider,
          online: Boolean(models[profile.id]?.length),
          models: models[profile.id] || [],
          defaultModel: profile.defaultModel || models[profile.id]?.[0]?.name || '',
          reason: models[profile.id]?.length ? null : '请先在配置 > Agent 中测试并读取模型',
        })),
        defaultProfileId: current.profiles[0]?.id || '',
        session: null,
        reason: input.connected ? 'Edge Agent 执行能力正在接入，当前可以先完成平台与模型配置。' : '请先连接游戏；当前可以先完成平台与模型配置。',
      })
    }

    return response({ error: { code: 'GAME_AGENT_EDGE_NOT_READY', message: 'Edge Agent 执行能力正在接入' } }, 501)
  }
}
