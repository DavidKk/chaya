import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { apiErrorBody, json } from '@/initializer/response'
import { LOG_LEVELS } from '@/lib/log'
import { canUseDisk } from '@/lib/service-mode'
import { appendLog, clearLogs, listLogs, logBusStats, type LogLevel } from '@/services/log'
import { clearSlowHttpRequests, listSlowHttpRequests } from '@/services/log/slow-http'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Chaya-Launch-Token',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/** Browser-mode logs travel directly from the game to its page without server persistence. */
const BROWSER_MODE_NOTE = 'Browser logs are sent directly from the game to the page and are not stored on the server'

/** Recent local logs, or a compact slow-request summary. */
export const GET = defineApiRoute('get:/api/logs', async ({ request }) => {
  if (!canUseDisk()) return json({ ok: true, levels: LOG_LEVELS, entries: [], note: BROWSER_MODE_NOTE }, { headers: CORS })
  const u = new URL(request.url)
  const limit = Number(u.searchParams.get('limit') || 200)
  if (u.searchParams.get('view') === 'slow') {
    return json(
      {
        ok: true,
        ...listSlowHttpRequests({
          limit: u.searchParams.has('limit') ? limit : undefined,
          since: u.searchParams.has('since') ? Number(u.searchParams.get('since')) : undefined,
          minMs: u.searchParams.has('minMs') ? Number(u.searchParams.get('minMs')) : undefined,
          requestId: u.searchParams.get('requestId') || undefined,
        }),
      },
      { headers: { ...CORS, 'Cache-Control': 'no-store' } }
    )
  }
  const source = u.searchParams.get('source') || undefined
  const level = (u.searchParams.get('level') as LogLevel | null) || undefined
  const since = u.searchParams.get('since') ? Number(u.searchParams.get('since')) : undefined
  const q = u.searchParams.get('q') || undefined
  return json(
    {
      ok: true,
      stats: logBusStats(),
      levels: LOG_LEVELS,
      entries: listLogs({ limit, source, level, since, q }),
    },
    { headers: CORS }
  )
})

/**
 * Accept plugin and capability-script logs according to the service mode.
 * body: { level?, source, message, meta? } | { entries: [...] }
 */
export const POST = defineApiRoute('post:/api/logs', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as
    | {
        level?: LogLevel
        source?: string
        message?: string
        meta?: unknown
        ts?: number
        entries?: Array<{
          level?: LogLevel
          source?: string
          message?: string
          meta?: unknown
          ts?: number
        }>
      }
    | null

  if (!body) return json(apiErrorBody('BAD_REQUEST', 'invalid json'), { status: 400, headers: CORS })
  // Older plugins still report logs; discard them silently in browser mode.
  if (!canUseDisk()) return json({ ok: true, count: 0, note: BROWSER_MODE_NOTE }, { headers: CORS })

  if (Array.isArray(body.entries)) {
    const saved = body.entries
      .filter((e) => e && e.source && e.message != null)
      .map((e) =>
        appendLog({
          level: e.level,
          source: String(e.source),
          message: String(e.message),
          meta: e.meta,
          ts: e.ts,
        })
      )
    return json({ ok: true, count: saved.length }, { headers: CORS })
  }

  if (!body.source || body.message == null) {
    return json(apiErrorBody('BAD_REQUEST', 'source and message are required'), { status: 400, headers: CORS })
  }

  const entry = appendLog({
    level: body.level,
    source: body.source,
    message: String(body.message),
    meta: body.meta,
    ts: body.ts,
  })
  return json({ ok: true, entry }, { headers: CORS })
})

export const DELETE = defineApiRoute('delete:/api/logs', async () => {
  if (canUseDisk()) {
    clearLogs()
    clearSlowHttpRequests()
  }
  return json({ ok: true }, { headers: CORS })
})
