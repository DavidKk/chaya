import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { canUseDisk } from '@/lib/service-mode/mode'
import { listExtTasks } from '@/services/game-agent/ext-task.server'
import { listOllamaModels, pickAvailableModel } from '@/services/game-agent/ollama-client'
import { readGameAgentToken } from '@/services/game-agent/secrets'
import { getSessionForGame, getTurn } from '@/services/game-agent/session-store'
import { loadGameAgentSettings } from '@/services/game-agent/settings'
import { listAgentGames } from '@/services/runtime/agent-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineApiRoute('get:/api/game-agent/status', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', '游戏内 Agent 需要 Chaya App 或本机服务')
  const gameId = new URL(request.url).searchParams.get('gameId')?.trim() || ''
  if (!gameId) return apiError(400, 'GAME_ID_REQUIRED', '缺少 gameId')

  const game = listAgentGames().find((item) => item.gameId === gameId)
  const extTasks = game ? await listExtTasks(gameId).catch(() => []) : []
  const latestExt = extTasks.at(-1)
  const activeExt = [...extTasks].reverse().find((task) => !['completed', 'stopped', 'failed', 'interrupted'].includes(task.state))
  const settings = loadGameAgentSettings()
  const session = getSessionForGame(gameId)
  const profiles = await Promise.all(
    settings.profiles.map(async (profile) => {
      try {
        const models = await listOllamaModels(profile.endpoint, fetch, AbortSignal.timeout(3_000), readGameAgentToken(profile.id))
        return {
          id: profile.id,
          label: profile.label,
          provider: profile.provider,
          online: true,
          models,
          defaultModel: pickAvailableModel(models, session?.profileId === profile.id ? session.model : profile.defaultModel),
          reason: models.length ? null : '没有已安装模型',
        }
      } catch (error) {
        return {
          id: profile.id,
          label: profile.label,
          provider: profile.provider,
          online: false,
          models: [],
          defaultModel: '',
          reason: error instanceof Error ? error.message : String(error),
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
