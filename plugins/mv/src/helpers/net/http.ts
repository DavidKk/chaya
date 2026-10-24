/**
 * Plugin-side HTTP — MagickMonkey-style, via fetch; NW.js falls back to require('http').
 */

import { resolveApiBase, resolveApiBaseFallbacks } from '../env/env'

function toUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const base = resolveApiBase().replace(/\/$/, '')
  return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
}

export async function chayaFetch(pathOrUrl: string, init?: RequestInit): Promise<Response> {
  const url = toUrl(pathOrUrl)
  const token = typeof window !== 'undefined' ? window.CHAYA_LAUNCH_TOKEN : undefined
  if (token) {
    // Only configured API origins (including the explicit loopback fallback) receive credentials.
    const origin = new URL(url).origin
    if (resolveApiBaseFallbacks().some((base) => new URL(base).origin === origin)) {
      const headers = new Headers(init?.headers)
      headers.set('X-Chaya-Launch-Token', token)
      init = { ...init, headers }
    }
  }
  const reqFn = (globalThis as { require?: NodeRequire }).require
  const fileGame = typeof location !== 'undefined' && location.protocol === 'file:'
  if (typeof fetch === 'function' && !(fileGame && reqFn)) {
    return fetch(url, init)
  }

  // Desktop games run at file://. Use their Node context so a valid launch
  // token is not blocked by browser CORS before the local API can verify it.
  if (!reqFn) {
    throw new Error('chayaFetch: 无 fetch / require')
  }
  const http = reqFn('http') as typeof import('http')
  const https = reqFn('https') as typeof import('https')
  const { URL: NodeURL } = reqFn('url') as typeof import('url')
  const u = new NodeURL(url)
  const lib = u.protocol === 'https:' ? https : http
  const method = (init?.method || 'GET').toUpperCase()
  const body = init?.body == null ? undefined : typeof init.body === 'string' ? init.body : String(init.body)

  return new Promise((resolve, reject) => {
    if (init?.signal?.aborted) return reject(init.signal.reason)
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    let ended = false
    const fail = (error: Error) => {
      if (!ended) {
        ended = true
        if (stream) stream.error(error)
        else reject(error)
      }
    }
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
        },
      },
      (res) => {
        const headers = new Headers()
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1])
        const noBody = method === 'HEAD' || [204, 205, 304].includes(res.statusCode || 0)
        const source = noBody
          ? null
          : new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller
                res.on('data', (chunk: Buffer) => {
                  if (!ended) {
                    controller.enqueue(new Uint8Array(chunk))
                    if ((controller.desiredSize ?? 0) <= 0) res.pause()
                  }
                })
              },
              pull() {
                res.resume()
              },
              cancel(reason) {
                ended = true
                res.destroy(reason instanceof Error ? reason : undefined)
                req.destroy()
              },
            })
        res.on('error', fail)
        res.on('aborted', () => fail(new Error('chayaFetch: response interrupted')))
        res.on('end', () => {
          if (!ended) {
            ended = true
            stream?.close()
          }
        })
        res.once('close', cleanup)
        if (noBody) res.resume()
        resolve(new Response(source, { status: res.statusCode || 200, statusText: res.statusMessage || '', headers }))
      }
    )
    const abort = () => req.destroy(init?.signal?.reason instanceof Error ? init.signal.reason : new DOMException('已取消', 'AbortError'))
    const cleanup = () => init?.signal?.removeEventListener('abort', abort)
    init?.signal?.addEventListener('abort', abort, { once: true })
    req.on('error', (error) => {
      cleanup()
      fail(error)
    })
    if (body) req.write(body)
    req.end()
  })
}

export async function chayaPostJson(pathOrUrl: string, data: unknown): Promise<Response> {
  return chayaFetch(pathOrUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}
