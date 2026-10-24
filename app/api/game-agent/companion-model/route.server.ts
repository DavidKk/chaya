import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiNotFound } from '@/initializer/response'
import { completeCompanionModel } from '@/services/game-agent/companion-api.server'
import { CompanionModelFailure, type CompanionModelPurpose } from '@/services/game-agent/companion-types.server'
import { loadGameAgentSettings, profileById } from '@/services/game-agent/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineApiRoute('post:/api/game-agent/companion-model', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as {
    requestId?: unknown
    profileId?: unknown
    model?: unknown
    purpose?: unknown
    conversationKey?: unknown
    messages?: unknown
    format?: unknown
  } | null
  const purposes = ['companion-chat', 'companion-route', 'companion-prepare']
  if (
    !body ||
    typeof body.requestId !== 'string' ||
    !body.requestId ||
    body.requestId.length > 160 ||
    typeof body.profileId !== 'string' ||
    typeof body.model !== 'string' ||
    !body.model ||
    body.model.length > 300 ||
    !purposes.includes(String(body.purpose)) ||
    !Array.isArray(body.messages) ||
    body.messages.length > 24 ||
    JSON.stringify(body).length > 48 * 1024
  )
    return apiBadRequest('Invalid companion model request', 'INVALID_COMPANION_MODEL_REQUEST')
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  for (const entry of body.messages) {
    const item = entry as { role?: unknown; content?: unknown } | null
    if (!item || !['system', 'user', 'assistant'].includes(String(item.role)) || typeof item.content !== 'string') {
      return apiBadRequest('Companion messages must be tool-free text', 'INVALID_COMPANION_MODEL_REQUEST')
    }
    messages.push({ role: item.role as 'system' | 'user' | 'assistant', content: item.content })
  }
  const profile = profileById(loadGameAgentSettings(), body.profileId)
  if (!profile) return apiNotFound('Agent profile not found', 'AGENT_PROFILE_NOT_FOUND')
  const cancel = new AbortController()
  const encoder = new TextEncoder()
  const purpose = body.purpose as CompanionModelPurpose
  const requestId = body.requestId
  const model = body.model
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (packet: unknown) => {
        if (!closed && !cancel.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(packet)}\n`))
      }
      void completeCompanionModel(profile, {
        requestId,
        model,
        purpose,
        messages,
        think: false,
        conversationKey: typeof body.conversationKey === 'string' ? body.conversationKey.slice(0, 500) : requestId,
        ...(body.format && typeof body.format === 'object' && !Array.isArray(body.format) ? { format: body.format as Record<string, unknown> } : {}),
        signal: AbortSignal.any([request.signal, cancel.signal]),
        onEvent(event) {
          if (event.type === 'accepted' || event.type === 'queued' || event.type === 'started' || event.type === 'delta') send(event)
        },
      })
        .then(
          (message) => send({ type: 'completed', message: { role: 'assistant', content: message.content, usage: message.usage, timing: message.timing } }),
          (error) =>
            send({
              type: 'failed',
              error:
                error instanceof CompanionModelFailure
                  ? error.error
                  : { code: 'MODEL_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true },
            })
        )
        .finally(() => {
          closed = true
          if (!cancel.signal.aborted) controller.close()
        })
    },
    cancel(reason) {
      cancel.abort(reason || new DOMException('Companion model stream closed', 'AbortError'))
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } })
})
