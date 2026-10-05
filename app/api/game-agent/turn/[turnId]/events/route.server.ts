import { defineApiRoute } from '@/initializer/controller'
import { apiNotFound } from '@/initializer/response'
import { getTurn, subscribeTurn } from '@/services/game-agent/session-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineApiRoute('get:/api/game-agent/turn/:turnId/events', async ({ context, request }) => {
  const { turnId } = await context.params
  const turn = getTurn(String(turnId || ''))
  const gameId = new URL(request.url).searchParams.get('gameId')
  if (!turn || !gameId || turn.gameId !== gameId) return apiNotFound('Agent Turn 不存在', 'AGENT_TURN_NOT_FOUND')
  const after = Math.max(0, Number(new URL(request.url).searchParams.get('after')) || 0)
  let unsubscribe = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const send = (event: (typeof turn.events)[number]) => {
        if (closed || event.seq <= after) return
        try {
          controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
          if (event.type === 'turn.completed' || event.type === 'turn.stopped' || event.type === 'turn.failed') {
            closed = true
            unsubscribe()
            controller.close()
          }
        } catch {
          closed = true
          unsubscribe()
        }
      }
      unsubscribe = subscribeTurn(turn, send)
      const firstSeq = turn.events[0]?.seq
      if (after > 0 && firstSeq && after < firstSeq - 1) {
        const gap = { type: 'history.gap', seq: firstSeq - 1, fromSeq: firstSeq }
        controller.enqueue(encoder.encode(`id: ${gap.seq}\nevent: ${gap.type}\ndata: ${JSON.stringify(gap)}\n\n`))
      }
      for (const event of turn.events) send(event)
      if (!closed && ['completed', 'stopped', 'failed'].includes(turn.state)) {
        closed = true
        unsubscribe()
        controller.close()
      }
      request.signal.addEventListener(
        'abort',
        () => {
          closed = true
          unsubscribe()
        },
        { once: true }
      )
    },
    cancel() {
      unsubscribe()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } })
})
