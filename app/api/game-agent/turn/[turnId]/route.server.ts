import { defineApiRoute } from '@/initializer/controller'
import { apiNotFound, apiOk } from '@/initializer/response'
import { callExtTask, getExtTask } from '@/services/game-agent/ext-task.server'
import { getTurn, stopTurn } from '@/services/game-agent/session-store'

export const runtime = 'nodejs'

export const DELETE = defineApiRoute('delete:/api/game-agent/turn/:turnId', async ({ context, request }) => {
  const { turnId } = await context.params
  const gameId = new URL(request.url).searchParams.get('gameId') || ''
  const existing = getTurn(String(turnId || ''))
  const ext = gameId ? await getExtTask(gameId, String(turnId || '')) : null
  if (ext) {
    const task = await callExtTask(gameId, { type: 'agent.task.stop', requestId: crypto.randomUUID(), taskId: ext.id })
    if (existing) stopTurn(existing.id, gameId)
    return apiOk({ turnId: ext.id, state: (task as { state?: string }).state || 'stopped' })
  }
  const turn = existing && (!gameId || existing.gameId === gameId) ? stopTurn(String(turnId || ''), gameId || undefined) : null
  if (!turn) return apiNotFound('Agent turn not found', 'AGENT_TURN_NOT_FOUND')
  return apiOk({ turnId: turn.id, state: turn.state })
})
