import type { DefaultRouteContext, ExistingRouteHandler } from '@/initializer/controller'
import { readApiErrorMessage } from '@/lib/api-error'

/** Plugin credentials that must never reach an agent */
const SECRET_KEYS = new Set(['launchToken', 'token', 'env'])

export type InvokeInput = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
}

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as T
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue
    out[key] = redactSecrets(v)
  }
  return out as T
}

/**
 * Call an API route handler in-process with the server's management token, so MCP tools reuse the
 * route's validation and error codes. Returns the `apiOk` payload (without `ok`, secrets removed);
 * throws with the route's error message otherwise.
 */
export async function invokeRoute(handler: ExistingRouteHandler<DefaultRouteContext>, input: InvokeInput): Promise<Record<string, unknown>> {
  const url = new URL(input.path, 'http://127.0.0.1')
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  const headers = new Headers({ Authorization: `Bearer ${process.env.CHAYA_AUTH_TOKEN || ''}` })
  if (input.body !== undefined) headers.set('Content-Type', 'application/json')
  const request = new Request(url, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: input.signal,
  })
  const res = await handler(request, { params: Promise.resolve({}) })
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !data || data.ok === false) {
    throw new Error(readApiErrorMessage(data, `${input.method} ${input.path} 失败（HTTP ${res.status}）`))
  }
  const { ok: _ok, ...rest } = data
  return redactSecrets(rest)
}
