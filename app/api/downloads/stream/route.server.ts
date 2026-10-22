import { defineApiRoute } from '@/initializer/controller'
import { requireDisk } from '@/services/disk-ops'
import { type JobEvent, subscribeDownloadJobs } from '@/services/downloads/jobs'
import { downloadSnapshot } from '@/services/downloads/snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
}

/** SSE：服务端下载任务快照 + 增量（只给同源页面用） */
export const GET = defineApiRoute('get:/api/downloads/stream', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      let unsub = () => {}
      let refresh: ReturnType<typeof setInterval> | undefined
      const ping = setInterval(() => send('ping', { ts: Date.now() }), 15000)
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          close()
        }
      }

      let previous = ''
      const snapshot = () => {
        const jobs = downloadSnapshot()
        const next = JSON.stringify(jobs)
        if (next !== previous) {
          previous = next
          send('snapshot', { jobs })
        }
      }
      snapshot()
      // Durable snapshots also cover installers running in another server worker.
      if (!closed) refresh = setInterval(snapshot, 1000)
      if (!closed) {
        unsub = subscribeDownloadJobs((e: JobEvent) => {
          if (e.type === 'job') send('job', e.job)
          else send('removed', { id: e.id })
        })
      }

      function close() {
        if (closed) return
        closed = true
        clearInterval(ping)
        clearInterval(refresh)
        unsub()
        try {
          controller.close()
        } catch {
          /* */
        }
      }

      if (request.signal.aborted) close()
      else request.signal.addEventListener('abort', close)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
