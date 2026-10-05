import { defineApiRoute } from '@/initializer/controller'
import { apiNotFound, apiOk } from '@/initializer/response'
import { stopTurn } from '@/services/game-agent/session-store'

export const runtime = 'nodejs'

export const DELETE = defineApiRoute('delete:/api/game-agent/turn/:turnId', async ({ context }) => {
  const { turnId } = await context.params
  const turn = stopTurn(String(turnId || ''))
  if (!turn) return apiNotFound('Agent Turn 不存在', 'AGENT_TURN_NOT_FOUND')
  return apiOk({ turnId: turn.id, state: turn.state })
})
