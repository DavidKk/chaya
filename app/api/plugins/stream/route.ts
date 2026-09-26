import { defineApiRoute } from '@/initializer/controller'
import { type PluginHotChange, pluginHotSnapshot, subscribePluginHot } from '@/services/game/plugin-hot-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Access-Control-Expose-Headers': 'X-Chaya-Plugin-Dev',
}

export const HEAD = defineApiRoute(
  'head:/api/plugins/stream',
  async () => new Response(null, { status: 204, headers: { ...SSE_HEADERS, 'X-Chaya-Plugin-Dev': process.env.NODE_ENV === 'development' ? '1' : '0' } })
)

/** SSE：开发态插件 dist 变更时推送，供 ChayaLoader 热替换（替代轮询） */
export const GET = defineApiRoute('get:/api/plugins/stream', async ({ request }) => {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 204, headers: SSE_HEADERS })
  let cleanup = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const unsub = subscribePluginHot((change: PluginHotChange) => {
        try {
          send('change', change)
        } catch {
          cleanup()
        }
      })

      send('hello', { ok: true, ts: Date.now(), plugins: pluginHotSnapshot() })

      const ping = setInterval(() => {
        try {
          send('ping', { ts: Date.now() })
        } catch {
          cleanup()
        }
      }, 15_000)

      const abort = () => {
        clearInterval(ping)
        unsub()
        request.signal.removeEventListener('abort', abort)
        try {
          controller.close()
        } catch {
          /* */
        }
      }
      cleanup = abort
      request.signal.addEventListener('abort', abort)
      if (request.signal.aborted) abort()
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
