import { defineApiRoute } from '@/initializer/controller'
import { apiError } from '@/initializer/response'
import { beginTurn, getOrCreateSession, stopTurn } from '@/services/game-agent/session-store'
import { loadGameAgentSettings, profileById } from '@/services/game-agent/settings'
import { runAskTurn } from '@/services/game-agent/turn-runner'
import type { GameAgentEvent, StartTurnInput } from '@/services/game-agent/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
}

export const POST = defineApiRoute('post:/api/game-agent/turn', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Partial<StartTurnInput> | null
  const gameId = String(body?.gameId || '').trim()
  const model = String(body?.model || '').trim()
  const profileId = String(body?.profileId || '').trim()
  const prompt = String(body?.prompt || '').trim()
  if (!gameId || !profileId || !model || !prompt) return apiError(400, 'INVALID_AGENT_TURN', 'gameId、profileId、model 和 prompt 不能为空')
  if (body?.mode && body.mode !== 'ask') return apiError(400, 'PLAY_MODE_NOT_READY', '游玩模式将在第二阶段开放')

  const input: StartTurnInput = {
    gameId,
    model,
    profileId,
    prompt,
    mode: 'ask',
    sessionId: body?.sessionId,
    newSession: body?.newSession === true,
    locale: String(body?.locale || ''),
  }
  const profile = profileById(loadGameAgentSettings(), profileId)
  if (!profile) return apiError(400, 'AGENT_PROFILE_NOT_FOUND', '接入实例不存在或已删除')
  const session = getOrCreateSession(gameId, profileId, model, input.sessionId, input.newSession)
  let turn
  try {
    turn = beginTurn(session)
  } catch (error) {
    if (error instanceof Error && error.message === 'AGENT_TURN_RUNNING') return apiError(409, 'AGENT_TURN_RUNNING', '当前游戏已有 Agent 任务在运行')
    throw error
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const emit = (event: GameAgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
          if (event.type === 'turn.completed' || event.type === 'turn.stopped' || event.type === 'turn.failed') {
            closed = true
            controller.close()
          }
        } catch {
          closed = true
          stopTurn(turn.id, gameId)
        }
      }
      emit({ type: 'turn.started', turnId: turn.id, sessionId: session.id })
      void runAskTurn(input, profile, session, turn, emit)
      const disconnect = () => {
        if (!closed) stopTurn(turn.id, gameId)
      }
      if (request.signal.aborted) disconnect()
      else request.signal.addEventListener('abort', disconnect, { once: true })
    },
    cancel() {
      stopTurn(turn.id, gameId)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
