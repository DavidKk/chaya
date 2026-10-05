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

/** Credentials that must never reach an agent, logs, or MCP responses. */
export function isSecretKey(key: string) {
  const normalized = key.replace(/[^a-z]/gi, '').toLowerCase()
  if (normalized.startsWith('has')) return false
  return (
    normalized === 'env' ||
    normalized === 'authorization' ||
    normalized === 'password' ||
    normalized === 'secret' ||
    normalized === 'apikey' ||
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret')
  )
}

export function collectSecretValues(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectSecretValues(item, into)
    return into
  }
  if (!value || typeof value !== 'object') return into
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) {
      if (typeof item === 'string' && item) into.add(item)
      continue
    }
    collectSecretValues(item, into)
  }
  return into
}

export function redactSecretText(text: string, secrets: Iterable<string>): string {
  let safe = text
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join('[credential omitted]')
  return safe
}

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as T
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (isSecretKey(key)) continue
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

/** A tool result carrying an image: MCP returns it as `image` content, WebMCP keeps this object as is */
export type McpImageResult = { mcpImage: { mimeType: string; data: string } } & Record<string, unknown>

export function mcpImage(image: { mimeType: string; data: string }, meta: Record<string, unknown> = {}): McpImageResult {
  return { ...meta, mcpImage: { mimeType: image.mimeType, data: image.data } }
}

export function isMcpImageResult(value: unknown): value is McpImageResult {
  const image = (value as { mcpImage?: { mimeType?: unknown; data?: unknown } } | null)?.mcpImage
  return !!image && typeof image.mimeType === 'string' && image.mimeType.startsWith('image/') && typeof image.data === 'string'
}
