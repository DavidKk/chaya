import { defineApiRoute } from '@/initializer/controller'
import { apiNotFound, apiOk } from '@/initializer/response'
import { getTurn, stopTurn } from '@/services/game-agent/session-store'

export const runtime = 'nodejs'

export const DELETE = defineApiRoute('delete:/api/game-agent/turn/:turnId', async ({ context, request }) => {
  const { turnId } = await context.params
  const gameId = new URL(request.url).searchParams.get('gameId') || ''
  const existing = getTurn(String(turnId || ''))
  const turn = existing && (!gameId || existing.gameId === gameId) ? stopTurn(String(turnId || ''), gameId || undefined) : null
  if (!turn) return apiNotFound('Agent Turn 不存在', 'AGENT_TURN_NOT_FOUND')
  return apiOk({ turnId: turn.id, state: turn.state })
})
