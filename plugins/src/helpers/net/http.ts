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
  if (typeof fetch === 'function') {
    return fetch(url, init)
  }

  // NW.js Node context (when fetch is missing)
  const reqFn = (globalThis as { require?: NodeRequire }).require
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
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve(
            new Response(text, {
              status: res.statusCode || 0,
              statusText: res.statusMessage || '',
            })
          )
        })
      }
    )
    req.on('error', reject)
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
