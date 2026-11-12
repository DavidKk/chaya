import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { COMPANION_ROUTE_CALL_TIMEOUT_MS } from '@/lib/game-agent/companion/model-diagnostics'
import type { CompanionHostRequest } from '@/lib/runtime/companion-protocol'
import { isCompanionHostRequest } from '@/lib/runtime/companion-validation'
import { callExtTask } from '@/services/game-agent/ext-task.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The connected game remains authoritative for memory, chat and control authorization. */
export const POST = defineApiRoute('post:/api/game-agent/companion', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { gameId?: unknown; message?: unknown } | null
  const gameId = typeof body?.gameId === 'string' ? body.gameId.trim() : ''
  const message = body?.message as CompanionHostRequest | undefined
  if (!gameId || gameId.length > 500 || !isCompanionHostRequest(message)) {
    return apiBadRequest('Invalid companion request', 'INVALID_COMPANION_REQUEST')
  }
  if (JSON.stringify(message).length > 48 * 1024) return apiBadRequest('Companion request is too large', 'INVALID_COMPANION_REQUEST')
  try {
    const result = await callExtTask(gameId, message, message.type === 'agent.companion.route' ? COMPANION_ROUTE_CALL_TIMEOUT_MS : 15_000)
    return apiOk({ result })
  } catch (error) {
    const failure = error as Error & { code?: string; retryable?: boolean }
    // The game process is unchanged. A missing bridge is an offline read, not a gateway failure.
    if (failure.code === 'GAME_OFFLINE' || failure.code === 'GAME_AMBIGUOUS') {
      if (message.type === 'agent.companion.status') return apiOk({ result: null, offline: true })
      if (message.type === 'agent.companion.events') {
        return apiOk({ result: { events: [], lastSeq: message.afterSeq, gap: false, status: null }, offline: true })
      }
      return apiError(409, failure.code, failure.message || String(error))
    }
    return apiError(
      failure.code === 'CONTROL_BUSY' || failure.code === 'REQUEST_CONFLICT' ? 409 : 502,
      failure.code || 'COMPANION_REQUEST_FAILED',
      failure.message || String(error)
    )
  }
})
