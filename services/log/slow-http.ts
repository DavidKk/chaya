import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { canUseDisk } from '@/lib/service-mode/mode'

import { appendLogToFile, clearLogFiles, loadLogsFromFiles, resolvePluginLogDir } from './file-store'

export const SLOW_HTTP_MS = 1000
const MAX_EVENTS = 2000
const MAX_ACTIVE = 256
const STATE = Symbol.for('chaya.slow-http')
type SlowRequest = {
  id: string
  requestId: string
  method: string
  path: string
  startedAt: number
  elapsedMs: number
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'unfinished'
  status?: number
  phase?: string
}
const host = globalThis as typeof globalThis & { [STATE]?: Map<string, SlowRequest> }
const active = (host[STATE] ??= new Map())
const logDir = () => path.join(resolvePluginLogDir(), 'slow-http')

function save(record: SlowRequest) {
  if (!canUseDisk()) return
  appendLogToFile({ id: record.id, ts: Date.now(), level: 'warn', source: 'http.slow', message: `Slow HTTP request: ${record.state}`, meta: record }, logDir(), { force: true })
}

/** Keep slow requests separate from the high-volume plugin log buffer. */
export function watchSlowHttpRequest(request: Pick<SlowRequest, 'requestId' | 'method' | 'path' | 'startedAt'>, elapsedMs: () => number) {
  request = { ...request, requestId: request.requestId.slice(0, 100), method: request.method.slice(0, 16), path: request.path.slice(0, 128) }
  const id = randomUUID()
  let marked = false
  let finished = false
  const mark = () => {
    const record: SlowRequest = { ...request, id, elapsedMs: elapsedMs(), state: 'running' }
    marked = true
    if (active.size >= MAX_ACTIVE) active.delete(active.keys().next().value!)
    active.set(id, record)
    save(record)
    // eslint-disable-next-line no-console -- report stalled requests before they finish
    console.warn(`[Chaya HTTP SLOW] ${request.method} ${request.path} running ${record.elapsedMs}ms requestId=${request.requestId}`)
  }
  const timer = setTimeout(mark, SLOW_HTTP_MS)
  timer.unref?.()
  return (state: 'completed' | 'failed' | 'cancelled', status: number, phase: string) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    active.delete(id)
    const duration = elapsedMs()
    // Completion must also detect blocked event loops that delayed the timer.
    if (!marked && duration < SLOW_HTTP_MS) return
    save({ ...request, id, elapsedMs: duration, state, status, phase })
  }
}

export function listSlowHttpRequests(options: { limit?: number; since?: number; requestId?: string; minMs?: number } = {}) {
  const events = loadLogsFromFiles({ logDir: logDir(), limit: MAX_EVENTS })
  const records = new Map<string, SlowRequest>()
  for (const event of events) {
    const record = event.meta as SlowRequest | undefined
    if (record?.id && record.requestId && typeof record.elapsedMs === 'number') records.set(record.id, record)
  }
  // Active records remain visible even if a burst of completed requests fills the journal window.
  for (const [id, record] of active) records.set(id, record)
  const minMs = Number.isFinite(options.minMs) ? Math.max(SLOW_HTTP_MS, options.minMs!) : SLOW_HTTP_MS
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.floor(options.limit!))) : 20
  const requests = Array.from(records.values(), (record) =>
    record.state === 'running'
      ? {
          ...record,
          state: active.has(record.id) ? ('running' as const) : ('unfinished' as const),
          elapsedMs: active.has(record.id) ? Math.max(record.elapsedMs, Date.now() - record.startedAt) : record.elapsedMs,
        }
      : record
  )
    .filter((record) => record.elapsedMs >= minMs && (!options.since || record.startedAt >= options.since) && (!options.requestId || record.requestId === options.requestId))
    .sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || b.startedAt - a.startedAt)
  const routes = new Map<string, { method: string; path: string; count: number; maxMs: number }>()
  for (const record of requests) {
    const key = `${record.method} ${record.path}`
    const route = routes.get(key) ?? { method: record.method, path: record.path, count: 0, maxMs: 0 }
    route.count += 1
    route.maxMs = Math.max(route.maxMs, record.elapsedMs)
    routes.set(key, route)
  }
  return {
    thresholdMs: SLOW_HTTP_MS,
    activeCapacity: MAX_ACTIVE,
    scope: 'Latest 2000 journal events within 14 days; up to 256 active slow requests included',
    journalEvents: events.length,
    matched: requests.length,
    running: requests.filter((record) => record.state === 'running').length,
    unfinished: requests.filter((record) => record.state === 'unfinished').length,
    returned: Math.min(limit, requests.length),
    routes: Array.from(routes.values())
      .sort((a, b) => b.maxMs - a.maxMs)
      .slice(0, 10),
    requests: requests.slice(0, limit).map(({ id: _id, ...record }) => record),
  }
}

export function clearSlowHttpRequests() {
  clearLogFiles(logDir())
  // Preserve requests that are still running when logs are cleared.
  for (const record of active.values()) save(record)
}
