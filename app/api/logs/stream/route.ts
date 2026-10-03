import { defineApiRoute } from '@/initializer/controller'
import { canUseDisk } from '@/lib/service-mode'
import { listLogs, type LogEntry, subscribeLogs } from '@/services/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
}

/** SSE：实时推送插件 / 运行时日志 */
export const GET = defineApiRoute('get:/api/logs/stream', async ({ request }) => {
  const u = new URL(request.url)
  const backlog = Math.min(500, Math.max(0, Number(u.searchParams.get('backlog') || 100)))

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      send('hello', { ok: true, ts: Date.now() })
      // 浏览器模式：日志经游戏连接直达页面，只保活不推条目（关流会让 EventSource 不停重连）
      const unsub = canUseDisk()
        ? (() => {
            for (const entry of listLogs({ limit: backlog })) send('log', entry)
            const off = subscribeLogs((entry: LogEntry) => {
              try {
                send('log', entry)
              } catch {
                off()
              }
            })
            return off
          })()
        : () => {}

      const ping = setInterval(() => {
        try {
          send('ping', { ts: Date.now() })
        } catch {
          clearInterval(ping)
          unsub()
        }
      }, 15000)

      const abort = () => {
        clearInterval(ping)
        unsub()
        try {
          controller.close()
        } catch {
          /* */
        }
      }

      request.signal.addEventListener('abort', abort)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
