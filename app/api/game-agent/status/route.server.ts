import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { resolveAgentProfileModels } from '@/lib/game-agent/profile-models'
import { isCliProvider, isOpenApiProvider } from '@/lib/game-agent/providers'
import { canUseDisk } from '@/lib/service-mode/mode'
import { listAnthropicModels, usesAnthropicApi } from '@/services/game-agent/anthropic-client'
import { cliProfileStatus, cliUnavailableReason } from '@/services/game-agent/cli/status.server'
import { listExtTasks } from '@/services/game-agent/ext-task.server'
import { listGeminiModels, usesGeminiOpenAiCompat } from '@/services/game-agent/gemini-client'
import { loadAgentModelCache, saveAgentModelCache } from '@/services/game-agent/model-cache'
import { listOllamaModels } from '@/services/game-agent/ollama-client'
import { listOpenAiModels, openApiGatewayRequestHeaders } from '@/services/game-agent/openai-client'
import { ollamaFetch } from '@/services/game-agent/proxy/agent-proxy'
import { readGameAgentToken } from '@/services/game-agent/secrets'
import { getSessionForGame, getTurn } from '@/services/game-agent/session-store'
import { loadGameAgentSettings } from '@/services/game-agent/settings'
import { listAgentGames } from '@/services/runtime/agent-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineApiRoute('get:/api/game-agent/status', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'In-game agent requires Chaya App or local service')
  const gameId = new URL(request.url).searchParams.get('gameId')?.trim() || ''
  if (!gameId) return apiError(400, 'GAME_ID_REQUIRED', 'Missing gameId')

  const game = listAgentGames().find((item) => item.gameId === gameId)
  const extTasks = game ? await listExtTasks(gameId).catch(() => []) : []
  const latestExt = extTasks.at(-1)
  const activeExt = [...extTasks].reverse().find((task) => !['completed', 'stopped', 'failed', 'interrupted'].includes(task.state))
  const settings = loadGameAgentSettings()
  const session = getSessionForGame(gameId)
  const modelCache = loadAgentModelCache(settings.profiles)
  const profiles = await Promise.all(
    settings.profiles.map(async (profile) => {
      const preferred = session?.profileId === profile.id ? session.model : profile.defaultModel
      if (isCliProvider(profile.provider)) {
        const status = await cliProfileStatus({ id: profile.id, provider: profile.provider, proxy: profile.proxy })
        const choices = resolveAgentProfileModels({ ...profile, defaultModel: preferred || profile.defaultModel }, modelCache[profile.id] || [])
        return {
          id: profile.id,
          label: profile.label,
          provider: profile.provider,
          online: !cliUnavailableReason(status),
          ...choices,
          reason: cliUnavailableReason(status),
          ...status,
        }
      }
      if (isOpenApiProvider(profile.provider)) {
        try {
          const token = readGameAgentToken(profile.id) || (profile as any).apiKey
          const fetcher = ollamaFetch(profile)
          const signal = AbortSignal.timeout(5_000)
          const catalog =
            profile.provider === 'cc' && usesAnthropicApi(profile.endpoint)
              ? await listAnthropicModels(profile.endpoint, fetcher, signal, token)
              : profile.provider === 'gemini-api' && !usesGeminiOpenAiCompat(profile.endpoint)
                ? await listGeminiModels(profile.endpoint, fetcher, signal, token, profile.proxyHeaders)
                : await listOpenAiModels(
                    profile.endpoint,
                    fetcher,
                    signal,
                    token,
                    openApiGatewayRequestHeaders(profile.provider, profile.endpoint, profile.proxyHeaders),
                    profile.modelsEndpoint
                  )
          saveAgentModelCache(profile, catalog)
          const resolved = resolveAgentProfileModels({ ...profile, defaultModel: preferred || profile.defaultModel }, catalog)
          return {
            id: profile.id,
            label: profile.label,
            provider: profile.provider,
            online: resolved.models.length > 0,
            ...resolved,
            reason: resolved.models.length ? null : '没有已安装模型',
          }
        } catch (error) {
          const resolved = resolveAgentProfileModels({ ...profile, defaultModel: preferred || profile.defaultModel }, modelCache[profile.id] || [])
          return {
            id: profile.id,
            label: profile.label,
            provider: profile.provider,
            online: resolved.models.length > 0,
            ...resolved,
            reason: resolved.models.length ? null : error instanceof Error ? error.message : String(error),
          }
        }
      }
      try {
        const catalog = await listOllamaModels(profile.endpoint, ollamaFetch(profile), AbortSignal.timeout(3_000), readGameAgentToken(profile.id))
        saveAgentModelCache(profile, catalog)
        const resolved = resolveAgentProfileModels({ ...profile, defaultModel: preferred || profile.defaultModel }, catalog)
        return {
          id: profile.id,
          label: profile.label,
          provider: profile.provider,
          online: resolved.models.length > 0,
          ...resolved,
          reason: resolved.models.length ? null : '没有已安装模型',
        }
      } catch (error) {
        const resolved = resolveAgentProfileModels({ ...profile, defaultModel: preferred || profile.defaultModel }, modelCache[profile.id] || [])
        return {
          id: profile.id,
          label: profile.label,
          provider: profile.provider,
          online: resolved.models.length > 0,
          ...resolved,
          reason: resolved.models.length ? null : error instanceof Error ? error.message : String(error),
        }
      }
    })
  )
  const defaultProfile = profiles.find((profile) => profile.id === (session?.profileId || settings.defaultProfileId)) || profiles[0]
  const available = profiles.some((profile) => profile.online && profile.models.length > 0)
  return apiOk({
    available,
    gameOnline: !!game,
    profiles,
    defaultProfileId: defaultProfile?.id || '',
    session: activeExt
      ? {
          id: activeExt.conversationId,
          profileId: session?.profileId || '',
          activeTurnId: activeExt.id,
          recentTurnId: activeExt.id,
          activeTurn: { id: activeExt.id, state: activeExt.state, capability: activeExt.capability, goal: activeExt.goal, lastSeq: activeExt.lastSeq },
        }
      : latestExt
        ? { id: latestExt.conversationId, profileId: session?.profileId || '', activeTurnId: null, recentTurnId: latestExt.id, activeTurn: null }
        : session
          ? {
              id: session.id,
              profileId: session.profileId,
              activeTurnId: session.activeTurnId,
              recentTurnId: session.lastTurnId || null,
              activeTurn: session.activeTurnId
                ? (() => {
                    const turn = getTurn(session.activeTurnId!)
                    return turn ? { id: turn.id, state: turn.state, phase: turn.phase, goal: turn.goal, question: turn.question, lastSeq: turn.lastSeq } : null
                  })()
                : null,
            }
          : null,
    reason: available ? null : defaultProfile?.reason || '没有可用的 Agent',
  })
})
