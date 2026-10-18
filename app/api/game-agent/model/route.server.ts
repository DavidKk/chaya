import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import type { RuntimeMessage, RuntimeTool } from '@/lib/game-agent/runtime'
import { AgentCliError } from '@/services/game-agent/cli/errors'
import { completeAgentModel } from '@/services/game-agent/model-complete.server'
import { loadGameAgentSettings, profileById } from '@/services/game-agent/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineApiRoute('post:/api/game-agent/model', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as {
    profileId?: unknown
    model?: unknown
    messages?: unknown
    tools?: unknown
    think?: unknown
    format?: unknown
  } | null
  const profileId = typeof body?.profileId === 'string' ? body.profileId.trim() : ''
  const model = typeof body?.model === 'string' ? body.model.trim() : ''
  if (!profileId || !model || !Array.isArray(body?.messages) || !Array.isArray(body?.tools)) {
    return apiError(400, 'INVALID_AGENT_MODEL_REQUEST', 'profileId, model, messages, and tools are required')
  }
  const profile = profileById(loadGameAgentSettings(), profileId)
  if (!profile) return apiError(404, 'AGENT_PROFILE_NOT_FOUND', 'Agent profile not found or deleted')
  const messages = body.messages.slice(-100) as RuntimeMessage[]
  const tools = body.tools.slice(0, 64) as RuntimeTool[]
  try {
    const message = await completeAgentModel(profile, {
      model,
      messages,
      tools,
      think: body.think === true,
      ...(body.format && typeof body.format === 'object' && !Array.isArray(body.format) ? { format: body.format as Record<string, unknown> } : {}),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(profile.modelTimeoutMs)]),
    })
    return apiOk({ message })
  } catch (error) {
    // Keep AgentCliError status (401 auth, 429 quota, …). Mapping everything to 502 made the in-game
    // client treat login failures as a model outage and trip the 15s model gate.
    if (error instanceof AgentCliError) return apiError(error.status, error.code, error.message)
    return apiError(502, 'AGENT_MODEL_FAILED', error instanceof Error ? error.message : String(error))
  }
})
