import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { CLI_PROVIDERS_FEATURE, isCliProvider } from '@/lib/game-agent/providers'
import { agentSettingsFromSyncDocument, type AgentSyncDocument, agentSyncDocumentForReader } from '@/lib/game-agent/settings-sync'
import { canUseDisk } from '@/lib/service-mode/mode'
import { releaseRemovedAuthorizations } from '@/services/game-agent/cli/auth/attempts.server'
import { toAgentCliError } from '@/services/game-agent/cli/errors'
import { probeCliProfile } from '@/services/game-agent/cli/probe.server'
import { loadAgentModelCache, saveAgentModelCache } from '@/services/game-agent/model-cache'
import { listOllamaModels, pickDefaultModel } from '@/services/game-agent/ollama-client'
import { ollamaFetch } from '@/services/game-agent/proxy/agent-proxy'
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
  const models = await listOllamaModels(profile.endpoint, ollamaFetch(profile), AbortSignal.timeout(5_000), readGameAgentToken(profile.id))
  saveAgentModelCache(profile, models)
  const defaultModel = models.some((model) => model.name === profile.defaultModel) ? profile.defaultModel : pickDefaultModel(models)
  return { profileId: profile.id, models, defaultModel }
}

async function testCliProfile(value: Partial<GameAgentProfile>, prompt: boolean, signal: AbortSignal) {
  const profile = normalizeGameAgentProfile(value)
  if (!isCliProvider(profile.provider)) return apiError(400, 'INVALID_AGENT_ACTION', '未知的 Agent 类型')
  try {
    const result = await probeCliProfile({ id: profile.id, provider: profile.provider, defaultModel: profile.defaultModel, proxy: profile.proxy }, { prompt, signal })
    saveAgentModelCache(profile, result.models)
    return apiOk({ profileId: profile.id, ...result })
  } catch (error) {
    const cliError = toAgentCliError(error, 'AGENT_CLI_CRASHED')
    return apiError(cliError.status, cliError.code, cliError.message)
  }
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
  if (isCliProvider(body.profile.provider)) return testCliProfile(body.profile, body.action === 'test', request.signal)
  try {
    return apiOk(await testProfile(body.profile))
  } catch (error) {
    return apiError(400, 'AGENT_CONNECTION_FAILED', error instanceof Error ? error.message : String(error))
  }
})

type SyncResult = { sync: AgentSyncDocument; settings: GameAgentSettings }

function forReader(result: SyncResult, features: string[]): SyncResult {
  const sync = agentSyncDocumentForReader(result.sync, features)
  return sync === result.sync ? result : { sync, settings: { ...result.settings, ...agentSettingsFromSyncDocument(sync) } as GameAgentSettings }
}

/** A reader that cannot see CLI agents must not delete them by omission. */
function keepHiddenProfiles(settings: Partial<GameAgentSettings>, features: string[]): Partial<GameAgentSettings> {
  if (features.includes(CLI_PROVIDERS_FEATURE) || !Array.isArray(settings.profiles)) return settings
  const hidden = agentSettingsFromSyncDocument(loadGameAgentSyncDocument()).profiles.filter((profile) => isCliProvider(profile.provider))
  const ids = new Set(settings.profiles.map((profile) => profile.id))
  return { ...settings, profiles: [...settings.profiles, ...hidden.filter((profile) => !ids.has(profile.id))] }
}

export const PUT = defineApiRoute('put:/api/integration/game-agent', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 配置仅在 Chaya App 或本机服务中可用')
  const body = (await request.json().catch(() => null)) as {
    settings?: Partial<GameAgentSettings>
    sync?: AgentSyncDocument
    baseSync?: AgentSyncDocument
    features?: unknown
  } | null
  if (!body?.settings && !body?.sync) return apiError(400, 'INVALID_AGENT_SETTINGS', '缺少 Agent 配置')
  const features = Array.isArray(body.features) ? body.features.filter((item): item is string => typeof item === 'string') : []
  try {
    const before = agentSettingsFromSyncDocument(loadGameAgentSyncDocument()).profiles
    let result: SyncResult
    if (body.sync) result = mergeGameAgentSyncDocument(body.sync)
    else {
      const requestedActor = request.headers.has('x-chaya-launch-token') ? request.headers.get('x-chaya-agent-sync-actor') : null
      const actorId = requestedActor && /^plugin:[a-zA-Z0-9._:-]{1,120}$/.test(requestedActor) ? requestedActor : undefined
      result = updateGameAgentSyncFromSettings(keepHiddenProfiles(body.settings!, features), actorId, body.baseSync)
    }
    releaseRemovedAuthorizations(before, result.settings.profiles)
    const visible = forReader(result, features)
    return apiOk({ ...visible, models: loadAgentModelCache(visible.settings.profiles) })
  } catch (error) {
    return apiError(400, 'INVALID_AGENT_SETTINGS', error instanceof Error ? error.message : String(error))
  }
})
