import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import type { RuntimeMessage, RuntimeTool } from '@/lib/game-agent/runtime'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import { readGameAgentToken } from '@/services/game-agent/secrets'
import { loadGameAgentSettings, profileById } from '@/services/game-agent/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineApiRoute('post:/api/game-agent/model', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as {
    profileId?: unknown
    model?: unknown
    messages?: unknown
    tools?: unknown
  } | null
  const profileId = typeof body?.profileId === 'string' ? body.profileId.trim() : ''
  const model = typeof body?.model === 'string' ? body.model.trim() : ''
  if (!profileId || !model || !Array.isArray(body?.messages) || !Array.isArray(body?.tools)) {
    return apiError(400, 'INVALID_AGENT_MODEL_REQUEST', 'profileId、model、messages 和 tools 不能为空')
  }
  const profile = profileById(loadGameAgentSettings(), profileId)
  if (!profile) return apiError(404, 'AGENT_PROFILE_NOT_FOUND', '接入实例不存在或已删除')
  const messages = body.messages.slice(-100) as RuntimeMessage[]
  const tools = body.tools.slice(0, 64) as RuntimeTool[]
  try {
    const message = await streamOllamaChat(
      {
        endpoint: profile.endpoint,
        model,
        messages: messages as import('@/services/game-agent/types').GameAgentMessage[],
        tools: tools.map((tool) => ({
          type: 'function' as const,
          function: { name: tool.name, description: tool.description || '', parameters: tool.inputSchema || { type: 'object', properties: {} } },
        })),
        temperature: profile.temperature,
        keepAlive: profile.keepAlive,
        token: readGameAgentToken(profile.id),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
      },
      () => undefined
    )
    return apiOk({ message })
  } catch (error) {
    return apiError(502, 'AGENT_MODEL_FAILED', error instanceof Error ? error.message : String(error))
  }
})
