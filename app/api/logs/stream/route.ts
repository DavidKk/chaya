import { defineApiRoute } from '@/initializer/controller'
import { canUseDisk } from '@/lib/service-mode'
import { listLogs, logBusStats, type LogEntry, subscribeLogs } from '@/services/log'
import { MAX_LOG_SUBSCRIBERS } from '@/services/log/bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
}

const MAX_STREAM_BYTES = 64 * 1024

/** Stream local diagnostics with bounded buffering and cancellation cleanup. */
export const GET = defineApiRoute('get:/api/logs/stream', async ({ request }) => {
  const u = new URL(request.url)
  const requested = Number(u.searchParams.get('backlog') ?? 100)
  const backlog = Number.isFinite(requested) ? Math.min(500, Math.max(0, requested)) : 100
  const local = canUseDisk()
  if (local && logBusStats().listeners >= MAX_LOG_SUBSCRIBERS) {
    return Response.json(
      { ok: false, error: { code: 'LOG_SUBSCRIBER_LIMIT', message: 'Log subscriber limit reached' } },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*', 'Retry-After': '5' } }
    )
  }
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let stopped = false
        let unsub = () => {}
        const enc = new TextEncoder()
        const abort = () => {
          if (stopped) return
          stopped = true
          clearInterval(ping)
          unsub()
          request.signal.removeEventListener('abort', abort)
          try {
            controller.close()
          } catch {
            // Cancellation may already have closed the stream.
          }
        }
        cleanup = abort
        const send = (event: string, data: unknown) => {
          if (stopped) return
          const chunk = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          // Drop new events while a slow reader fills its bounded queue.
          if ((controller.desiredSize ?? 0) < chunk.byteLength) return
          controller.enqueue(chunk)
        }

        send('hello', { ok: true, ts: Date.now() })
        // Browser-mode logs use the game link; keep this stream alive without server records.
        if (local) {
          if (backlog > 0) for (const entry of listLogs({ limit: backlog })) send('log', entry)
          unsub = subscribeLogs((entry: LogEntry) => {
            try {
              send('log', entry)
            } catch {
              abort()
            }
          })
        }
        const ping = setInterval(() => {
          try {
            send('ping', { ts: Date.now() })
          } catch {
            abort()
          }
        }, 15000)
        request.signal.addEventListener('abort', abort)
        if (request.signal.aborted) abort()
      },
      cancel() {
        cleanup()
      },
    },
    { highWaterMark: MAX_STREAM_BYTES, size: (chunk) => chunk.byteLength }
  )

  return new Response(stream, { headers: SSE_HEADERS })
})
