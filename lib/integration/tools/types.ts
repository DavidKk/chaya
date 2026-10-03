/** Shared MCP tool plumbing: implementations get their I/O injected so the server and Edge pages reuse them. */

export type ToolContext = { signal: AbortSignal }
export type ToolRun = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
export type ToolImpls = Record<string, ToolRun>

export type InvokeInput = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
}

/** Calls an API-shaped endpoint; resolves with the payload (no `ok`, secrets removed) or throws its error message. */
export type ApiInvoke = (input: InvokeInput) => Promise<Record<string, unknown>>

/** Plugin credentials that must never reach an agent */
const SECRET_KEYS = new Set(['launchToken', 'linkToken', 'token', 'env'])

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

export function pathWithQuery(path: string, query: InvokeInput['query']): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path
}
