import { defineApiRoute } from '@/initializer/controller'
import { apiError } from '@/initializer/response'
import { normalizeCompanionCharacter } from '@/lib/game-agent/companion'
import { classifyGameIntent, runManagedTurn } from '@/services/game-agent/managed-turn.server'
import { beginTurn, emitTurnEvent, finishTurn, getOrCreateSession, subscribeTurn } from '@/services/game-agent/session-store'
import { loadGameAgentSettings, profileById } from '@/services/game-agent/settings'
import { runAskTurn } from '@/services/game-agent/turn-runner.server'
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

  const input: StartTurnInput = {
    gameId,
    model,
    profileId,
    prompt,
    mode: 'ask',
    sessionId: body?.sessionId,
    newSession: body?.newSession === true,
    locale: String(body?.locale || ''),
    surface: body?.surface === 'companion' ? 'companion' : undefined,
    companionCharacter: body?.surface === 'companion' ? normalizeCompanionCharacter(body.companionCharacter) : undefined,
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

  let unsubscribe = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const send = (event: GameAgentEvent & { seq: number }) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
          if (event.type === 'turn.completed' || event.type === 'turn.stopped' || event.type === 'turn.failed') {
            closed = true
            unsubscribe()
            controller.close()
          }
        } catch {
          closed = true
          unsubscribe()
        }
      }
      unsubscribe = subscribeTurn(turn, send)
      const emit = (event: GameAgentEvent) => emitTurnEvent(turn, event)
      emit({ type: 'turn.started', turnId: turn.id, sessionId: session.id })
      void (async () => {
        try {
          const intent = await classifyGameIntent(input, profile, turn.abort.signal)
          if (intent.managed) await runManagedTurn(input, profile, turn)
          else await runAskTurn(input, profile, session, turn, emit, !intent.edit)
        } catch (error) {
          if (turn.abort.signal.aborted) {
            finishTurn(turn, 'stopped')
            emit({ type: 'turn.stopped' })
          } else {
            finishTurn(turn, 'failed')
            emit({ type: 'turn.failed', code: 'AGENT_TURN_FAILED', message: error instanceof Error ? error.message : String(error) })
          }
        }
      })()
      request.signal.addEventListener(
        'abort',
        () => {
          if (!closed) {
            closed = true
            unsubscribe()
            try {
              controller.close()
            } catch {
              /* already closed */
            }
          }
        },
        { once: true }
      )
    },
    cancel() {
      unsubscribe()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
