import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { agentSettingsFromSyncDocument, type AgentSyncDocument } from '@/lib/game-agent/settings-sync'
import { canUseDisk } from '@/lib/service-mode/mode'
import { loadAgentModelCache, saveAgentModelCache } from '@/services/game-agent/model-cache'
import { listOllamaModels, pickDefaultModel } from '@/services/game-agent/ollama-client'
import { readGameAgentToken } from '@/services/game-agent/secrets'
import {
  type GameAgentProfile,
  type GameAgentSettings,
  loadGameAgentSyncDocument,
  mergeGameAgentSyncDocument,
  normalizeGameAgentProfile,
  updateGameAgentSyncFromSettings,
} from '@/services/game-agent/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function testProfile(value: Partial<GameAgentProfile>) {
  const profile = normalizeGameAgentProfile(value)
  const models = await listOllamaModels(profile.endpoint, fetch, AbortSignal.timeout(5_000), readGameAgentToken(profile.id))
  saveAgentModelCache(profile, models)
  const defaultModel = models.some((model) => model.name === profile.defaultModel) ? profile.defaultModel : pickDefaultModel(models)
  return { profileId: profile.id, models, defaultModel }
}

export const GET = defineApiRoute('get:/api/integration/game-agent', async () => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 配置仅在 Chaya App 或本机服务中可用')
  let sync = loadGameAgentSyncDocument()
  if (agentSettingsFromSyncDocument(sync).profiles.length === 0) sync = updateGameAgentSyncFromSettings({ profiles: [] }).sync
  const settings = agentSettingsFromSyncDocument(sync)
  return apiOk({ settings, sync, models: loadAgentModelCache(settings.profiles) })
})

export const POST = defineApiRoute('post:/api/integration/game-agent', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 配置仅在 Chaya App 或本机服务中可用')
  const body = (await request.json().catch(() => null)) as { action?: unknown; profile?: Partial<GameAgentProfile> } | null
  if ((body?.action !== 'test' && body?.action !== 'models') || !body.profile) return apiError(400, 'INVALID_AGENT_ACTION', '仅支持 test 或 models 操作')
  try {
    return apiOk(await testProfile(body.profile))
  } catch (error) {
    return apiError(400, 'AGENT_CONNECTION_FAILED', error instanceof Error ? error.message : String(error))
  }
})

export const PUT = defineApiRoute('put:/api/integration/game-agent', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 配置仅在 Chaya App 或本机服务中可用')
  const body = (await request.json().catch(() => null)) as { settings?: Partial<GameAgentSettings>; sync?: AgentSyncDocument; baseSync?: AgentSyncDocument } | null
  if (!body?.settings && !body?.sync) return apiError(400, 'INVALID_AGENT_SETTINGS', '缺少 Agent 配置')
  try {
    if (body.sync) return apiOk(mergeGameAgentSyncDocument(body.sync))
    const requestedActor = request.headers.has('x-chaya-launch-token') ? request.headers.get('x-chaya-agent-sync-actor') : null
    const actorId = requestedActor && /^plugin:[a-zA-Z0-9._:-]{1,120}$/.test(requestedActor) ? requestedActor : undefined
    return apiOk(updateGameAgentSyncFromSettings(body.settings!, actorId, body.baseSync))
  } catch (error) {
    return apiError(400, 'INVALID_AGENT_SETTINGS', error instanceof Error ? error.message : String(error))
  }
})
