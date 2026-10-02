import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { apiErrorBody, json } from '@/initializer/response'
import { appendLog, clearLogs, listLogs, logBusStats, type LogLevel } from '@/services/log'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Chaya-Launch-Token',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/** 最近日志 + 总线状态（本机持久化；Edge 使用有界内存缓冲） */
export const GET = defineApiRoute('get:/api/logs', async ({ request }) => {
  const u = new URL(request.url)
  const limit = Number(u.searchParams.get('limit') || 200)
  const source = u.searchParams.get('source') || undefined
  const level = (u.searchParams.get('level') as LogLevel | null) || undefined
  const since = u.searchParams.get('since') ? Number(u.searchParams.get('since')) : undefined
  const q = u.searchParams.get('q') || undefined
  return json(
    {
      ok: true,
      stats: logBusStats(),
      levels: ['ok', 'warn', 'fail', 'info'],
      entries: listLogs({ limit, source, level, since, q }),
    },
    { headers: CORS }
  )
})

/**
 * 插件 / 能力脚本上报日志（按服务模式选择存储）
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
    return json(apiErrorBody('BAD_REQUEST', '需要 source + message'), { status: 400, headers: CORS })
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
  clearLogs()
  return json({ ok: true }, { headers: CORS })
})
