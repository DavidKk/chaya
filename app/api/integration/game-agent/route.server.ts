import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { canUseDisk } from '@/lib/service-mode/mode'
import { listOllamaModels, pickDefaultModel } from '@/services/game-agent/ollama-client'
import { type GameAgentProfile, type GameAgentSettings, loadGameAgentSettings, normalizeGameAgentProfile, saveGameAgentSettings } from '@/services/game-agent/settings'
import { peekLaunchToken } from '@/services/runtime/launch-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function testProfile(value: Partial<GameAgentProfile>) {
  const profile = normalizeGameAgentProfile(value)
  const models = await listOllamaModels(profile.endpoint, fetch, AbortSignal.timeout(5_000))
  return { profileId: profile.id, models, defaultModel: profile.defaultModel || pickDefaultModel(models) }
}

function pluginOnly(request: Request) {
  return peekLaunchToken(request.headers.get('x-chaya-launch-token'))
}

export const GET = defineApiRoute('get:/api/integration/game-agent', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 接入配置仅在 Chaya App 或本机服务中可用')
  if (!pluginOnly(request)) return apiError(403, 'GAME_AGENT_PLUGIN_ONLY', 'Agent 配置仅允许游戏插件访问')
  return apiOk({ settings: loadGameAgentSettings() })
})

export const POST = defineApiRoute('post:/api/integration/game-agent', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 接入配置仅在 Chaya App 或本机服务中可用')
  if (!pluginOnly(request)) return apiError(403, 'GAME_AGENT_PLUGIN_ONLY', 'Agent 配置仅允许游戏插件访问')
  const body = (await request.json().catch(() => null)) as { action?: unknown; profile?: Partial<GameAgentProfile> } | null
  if (body?.action !== 'test' || !body.profile) return apiError(400, 'INVALID_AGENT_ACTION', '仅支持 test 操作')
  try {
    return apiOk(await testProfile(body.profile))
  } catch (error) {
    return apiError(400, 'AGENT_CONNECTION_FAILED', error instanceof Error ? error.message : String(error))
  }
})

export const PUT = defineApiRoute('put:/api/integration/game-agent', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 接入配置仅在 Chaya App 或本机服务中可用')
  if (!pluginOnly(request)) return apiError(403, 'GAME_AGENT_PLUGIN_ONLY', 'Agent 配置仅允许游戏插件访问')
  const body = (await request.json().catch(() => null)) as { settings?: Partial<GameAgentSettings> } | null
  if (!body?.settings) return apiError(400, 'INVALID_AGENT_SETTINGS', '缺少 Agent 配置')
  try {
    return apiOk({ settings: saveGameAgentSettings(body.settings) })
  } catch (error) {
    return apiError(400, 'INVALID_AGENT_SETTINGS', error instanceof Error ? error.message : String(error))
  }
})
