import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { canUseDisk } from '@/lib/service-mode/mode'
import { submitAuthCode } from '@/services/game-agent/cli/auth/attempts.server'
import { toAgentCliError } from '@/services/game-agent/cli/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineApiRoute('post:/api/game-agent/auth/:attemptId/code', async ({ context, request }) => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', 'Agent authorization is only available in Chaya App or local service')
  const { attemptId } = await context.params
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  if (typeof body?.code !== 'string') return apiError(400, 'INVALID_AGENT_AUTH', 'Missing authorization code')
  try {
    return apiOk(await submitAuthCode(String(attemptId || ''), body.code))
  } catch (error) {
    const normalized = toAgentCliError(error)
    return apiError(normalized.status, normalized.code, normalized.message)
  }
})
