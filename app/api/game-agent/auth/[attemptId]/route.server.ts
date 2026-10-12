import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { canUseDisk } from '@/lib/service-mode/mode'
import { cancelAuthAttempt, getAuthAttempt } from '@/services/game-agent/cli/auth/attempts.server'
import { toAgentCliError } from '@/services/game-agent/cli/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  const normalized = toAgentCliError(error)
  return apiError(normalized.status, normalized.code, normalized.message)
}

export const GET = defineApiRoute('get:/api/game-agent/auth/:attemptId', async ({ context, request }) => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', 'Agent 授权仅在 Chaya App 或本机服务中可用')
  const { attemptId } = await context.params
  const waitMs = Number(new URL(request.url).searchParams.get('waitMs') || 0)
  try {
    return apiOk(await getAuthAttempt(String(attemptId || ''), Number.isFinite(waitMs) ? waitMs : 0))
  } catch (error) {
    return fail(error)
  }
})

export const DELETE = defineApiRoute('delete:/api/game-agent/auth/:attemptId', async ({ context }) => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', 'Agent 授权仅在 Chaya App 或本机服务中可用')
  const { attemptId } = await context.params
  try {
    return apiOk(cancelAuthAttempt(String(attemptId || '')))
  } catch (error) {
    return fail(error)
  }
})
