import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { apiErrorBody, json } from '@/initializer/response'
import { canUseDisk } from '@/lib/service-mode'
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

/** 浏览器模式日志只经游戏连接到页面；服务器不收、不存、不返回，避免不同访问者互相可见 */
const BROWSER_MODE_NOTE = '网页版日志经游戏连接直达页面，服务器不保存'

/** 最近日志 + 总线状态（本机持久化） */
export const GET = defineApiRoute('get:/api/logs', async ({ request }) => {
  if (!canUseDisk()) return json({ ok: true, levels: ['ok', 'warn', 'fail', 'info'], entries: [], note: BROWSER_MODE_NOTE }, { headers: CORS })
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
  // 旧版插件仍会上报：静默丢弃，不报错
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
  if (canUseDisk()) clearLogs()
  return json({ ok: true }, { headers: CORS })
})
