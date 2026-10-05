import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiNotFound, apiOk } from '@/initializer/response'
import { getTurn } from '@/services/game-agent/session-store'

export const runtime = 'nodejs'

export const POST = defineApiRoute('post:/api/game-agent/turn/:turnId/reply', async ({ context, request }) => {
  const { turnId } = await context.params
  const turn = getTurn(String(turnId || ''))
  const body = (await request.json().catch(() => null)) as { gameId?: string; reply?: string; replyId?: string } | null
  if (!turn || !body?.gameId || turn.gameId !== body.gameId) return apiNotFound('Agent Turn 不存在', 'AGENT_TURN_NOT_FOUND')
  if (!body.replyId || !body.reply?.trim()) return apiError(400, 'INVALID_AGENT_REPLY', 'reply 和 replyId 不能为空')
  if (turn.replyId === body.replyId) return apiOk({ turnId: turn.id, state: turn.state })
  if (turn.state !== 'waiting_user') return apiError(409, 'AGENT_NOT_WAITING', '当前任务未等待玩家回复')
  if (turn.reply !== undefined) return apiError(409, 'AGENT_REPLY_ALREADY_RECEIVED', '当前问题已收到回复')
  turn.reply = body.reply.trim().slice(0, 1000)
  turn.replyId = body.replyId
  turn.resume?.()
  turn.resume = undefined
  return apiOk({ turnId: turn.id, state: turn.state })
})
