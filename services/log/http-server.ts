import { channel } from 'node:diagnostics_channel'
import type { IncomingMessage, OutgoingHttpHeader, OutgoingHttpHeaders, ServerResponse } from 'node:http'

import { canUseDisk } from '@/lib/service-mode/mode'

import { operationId, startOperation } from './operation'
import { watchSlowHttpRequest } from './slow-http'

type RequestStart = { request: IncomingMessage; response: ServerResponse }
const REGISTERED = Symbol.for('chaya.http-request-tracing')
const host = globalThis as typeof globalThis & { [REGISTERED]?: boolean }

/** Observe the native HTTP lifecycle, including dev compilation and streamed rendering. */
export function observeHttpRequest({ request, response }: RequestStart) {
  if (!canUseDisk()) return
  const path = (request.url || '/').split('?')[0]!
  if (request.headers.upgrade) return
  const logTransport = path === '/api/logs' || path.startsWith('/api/logs/')
  const incoming = request.headers['x-chaya-request-id']
  const id = operationId(typeof incoming === 'string' ? incoming : undefined)
  const timing = startOperation('http', 'http.server', { method: request.method, path }, { operationId: id, start: !logTransport })
  request.headers['x-chaya-request-id'] = id
  request.headers['x-chaya-request-started-at'] = String(timing.startedAt)
  response.setHeader('X-Chaya-Request-Id', id)
  const finishSlow = watchSlowHttpRequest({ requestId: id, method: request.method || 'GET', path, startedAt: timing.startedAt }, timing.elapsedMs)

  let finished = false
  const finish = (aborted: boolean, phase = aborted ? 'connection-closed' : 'response-finished') => {
    if (finished) return
    finished = true
    const elapsedMs = timing.elapsedMs()
    const outcome = aborted ? 'cancelled' : response.statusCode >= 500 ? 'failed' : 'completed'
    finishSlow(outcome, response.statusCode, phase)
    // Do not feed the log transport's own SSE stream.
    if (!logTransport)
      timing.end(outcome, {
        status: response.statusCode,
        phase,
      })
    if (elapsedMs >= 1000 || response.statusCode >= 500) {
      // eslint-disable-next-line no-console -- correlate native Next timing lines with persisted request records
      console.warn(`[Chaya HTTP] ${request.method} ${path} ${response.statusCode} ${elapsedMs}ms requestId=${id}${aborted ? ' aborted' : ''}`)
    }
  }
  const writeHead = response.writeHead
  response.writeHead = function (
    ...args: [statusCode: number, statusMessageOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[], explicitHeaders?: OutgoingHttpHeaders | OutgoingHttpHeader[]]
  ) {
    const result = Reflect.apply(writeHead, this, args) as ServerResponse
    const headers = args[2] ?? (typeof args[1] === 'string' ? undefined : args[1])
    let contentType = String(this.getHeader('content-type') || '')
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() === 'content-type') contentType = String(headers[i + 1])
    } else if (headers) {
      for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === 'content-type') contentType = String(value)
    }
    // SSE lifetime is intentional; only its connection setup can be slow.
    if (contentType.toLowerCase().includes('text/event-stream')) finish(false, 'stream-open')
    return result
  }
  response.once('finish', () => finish(false))
  response.once('close', () => finish(!response.writableFinished))
}

export function registerHttpRequestTracing() {
  if (host[REGISTERED]) return
  host[REGISTERED] = true
  channel('http.server.request.start').subscribe((event) => {
    try {
      observeHttpRequest(event as RequestStart)
    } catch {
      // Observability must never interrupt native request dispatch.
    }
  })
}
