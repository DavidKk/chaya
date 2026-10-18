import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiNotFound, apiOk } from '@/initializer/response'
import { callExtTask, getExtTask } from '@/services/game-agent/ext-task.server'
import { getTurn } from '@/services/game-agent/session-store'

export const runtime = 'nodejs'

export const POST = defineApiRoute('post:/api/game-agent/turn/:turnId/reply', async ({ context, request }) => {
  const { turnId } = await context.params
  const turn = getTurn(String(turnId || ''))
  const body = (await request.json().catch(() => null)) as { gameId?: string; reply?: string; replyId?: string } | null
  if (!body?.gameId) return apiNotFound('Agent turn not found', 'AGENT_TURN_NOT_FOUND')
  if (!body.replyId || !body.reply?.trim()) return apiError(400, 'INVALID_AGENT_REPLY', 'reply and replyId are required')
  const ext = await getExtTask(body.gameId, String(turnId || ''))
  if (ext) {
    const task = await callExtTask(body.gameId, {
      type: 'agent.task.reply',
      requestId: body.replyId,
      taskId: ext.id,
      text: body.reply.trim().slice(0, 1000),
    })
    return apiOk({ turnId: ext.id, state: (task as { state?: string }).state })
  }
  if (!turn || turn.gameId !== body.gameId) return apiNotFound('Agent turn not found', 'AGENT_TURN_NOT_FOUND')
  if (turn.replyId === body.replyId) return apiOk({ turnId: turn.id, state: turn.state })
  if (turn.state !== 'waiting_user') return apiError(409, 'AGENT_NOT_WAITING', 'Current task is not waiting for player reply')
  if (turn.reply !== undefined) return apiError(409, 'AGENT_REPLY_ALREADY_RECEIVED', 'Reply has already been received for this question')
  turn.reply = body.reply.trim().slice(0, 1000)
  turn.replyId = body.replyId
  turn.resume?.()
  turn.resume = undefined
  return apiOk({ turnId: turn.id, state: turn.state })
})
