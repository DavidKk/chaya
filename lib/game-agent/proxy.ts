const PROXY_SCHEMES = new Set(['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'])
const MAX_PROXY_HEADERS = 20
const MAX_HEADER_NAME = 64
const MAX_HEADER_VALUE = 512
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

/**
 * Application / env proxy slots (ZeroOmega-style).
 * The URL scheme is how to reach the proxy server; slots are which traffic uses it.
 */
export const AGENT_PROXY_PROTOCOLS = ['http', 'https', 'socks5', 'all', 'ftp'] as const
export type AgentProxyProtocol = (typeof AGENT_PROXY_PROTOCOLS)[number]
export type AgentProxyProtocols = Partial<Record<AgentProxyProtocol, string>>

/** How the proxy server itself is reached (URL scheme of a proxy value). */
export type AgentProxyKind = 'http' | 'https' | 'socks5'

const BARE_HOST_PORT = /^(?:\[[^\]]+\]|[^:/?#]+)(?::\d+)?$/

/** `''` means no per-agent proxy (Chaya's own environment applies). Throws a player-facing message when invalid. */
export function normalizeAgentProxy(value: unknown): string {
  let raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  // ZeroOmega-style: host:port with no scheme defaults to http (the default slot).
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (!BARE_HOST_PORT.test(raw)) throw new Error('Invalid proxy endpoint format, e.g. 127.0.0.1:7890, http://127.0.0.1:7890, or socks5://127.0.0.1:7890')
    raw = `http://${raw}`
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Invalid proxy endpoint format, e.g. 127.0.0.1:7890, http://127.0.0.1:7890, or socks5://127.0.0.1:7890')
  }
  if (!PROXY_SCHEMES.has(url.protocol)) throw new Error('Proxy server only supports http, https, socks5')
  if (!url.hostname) throw new Error('Proxy endpoint missing hostname')
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) throw new Error('Proxy endpoint only requires protocol, host, and port; paths are not supported')
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
  const protocol = url.protocol === 'socks:' || url.protocol === 'socks5h:' ? 'socks5:' : url.protocol
  return `${protocol}//${auth}${url.host}`
}

/**
 * One default fills every empty slot (http / https / socks5 / all / ftp).
 * Non-empty overrides stay as explicit per-protocol values.
 */
export function resolveAgentProxySlots(defaultProxy: unknown, overrides: AgentProxyProtocols | undefined = {}): Record<AgentProxyProtocol, string> {
  const base = normalizeAgentProxy(defaultProxy)
  const slots = { http: '', https: '', socks5: '', all: '', ftp: '' } satisfies Record<AgentProxyProtocol, string>
  for (const key of AGENT_PROXY_PROTOCOLS) {
    const override = typeof overrides?.[key] === 'string' ? overrides[key].trim() : ''
    slots[key] = override ? normalizeAgentProxy(override) : base
  }
  return slots
}

/** True when any resolved slot has a proxy URL. */
export function agentProxyConfigured(slots: Record<AgentProxyProtocol, string>): boolean {
  return AGENT_PROXY_PROTOCOLS.some((key) => !!slots[key])
}

/** Normalize override map: drop empties / values identical to default (they inherit). */
export function normalizeAgentProxyProtocols(defaultProxy: unknown, overrides: unknown): AgentProxyProtocols {
  const base = normalizeAgentProxy(defaultProxy)
  if (overrides == null || overrides === '') return {}
  if (typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Protocol proxy overrides format is invalid')
  const next: AgentProxyProtocols = {}
  for (const key of AGENT_PROXY_PROTOCOLS) {
    const raw = (overrides as Record<string, unknown>)[key]
    if (raw == null || raw === '') continue
    if (typeof raw !== 'string') throw new Error(`Proxy "${key}" must be a string`)
    const normalized = normalizeAgentProxy(raw)
    if (!normalized || normalized === base) continue
    next[key] = normalized
  }
  return next
}

function proxyHeaderEntriesFromObject(value: object): Array<[string, string]> {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('Proxy header format is invalid')
      const name = (item as { name?: unknown; key?: unknown }).name ?? (item as { key?: unknown }).key
      const headerValue = (item as { value?: unknown }).value
      if (typeof name !== 'string' || typeof headerValue !== 'string') throw new Error('Proxy header format is invalid')
      return [name, headerValue]
    })
  }
  return Object.entries(value as Record<string, unknown>).map(([name, headerValue]) => {
    if (typeof headerValue !== 'string') throw new Error('Proxy header value must be a string')
    return [name, headerValue]
  })
}

function proxyHeaderEntriesFromLines(text: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^([^:=]+)\s*[:=]\s*(.*)$/)
    if (!match) throw new Error('Proxy headers must be Name: value or Name=value per line, or JSON object')
    entries.push([match[1].trim(), match[2].trim()])
  }
  return entries
}

/**
 * Extra headers sent to the upstream proxy (CONNECT / absolute-form). Empty when unused.
 * Accepts a map, JSON text (`{"X-Token":"…"}` / `[{name,value}]`), or lines `Name: value` / `Name=value`.
 */
export function normalizeAgentProxyHeaders(value: unknown): Record<string, string> {
  if (value == null || value === '') return {}
  let entries: Array<[string, string]>
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return {}
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        throw new Error('Proxy header JSON invalid, please use Name: value per line')
      }
      if (!parsed || typeof parsed !== 'object') throw new Error('Proxy header JSON must be an object or array')
      entries = proxyHeaderEntriesFromObject(parsed)
    } else {
      entries = proxyHeaderEntriesFromLines(trimmed)
    }
  } else if (typeof value === 'object') {
    entries = proxyHeaderEntriesFromObject(value)
  } else throw new Error('Proxy header format is invalid')

  if (entries.length > MAX_PROXY_HEADERS) throw new Error(`Maximum ${MAX_PROXY_HEADERS} proxy headers allowed`)
  const headers: Record<string, string> = {}
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim()
    const headerValue = rawValue.trim()
    if (!name && !headerValue) continue
    if (!name || !HEADER_NAME.test(name) || name.length > MAX_HEADER_NAME) throw new Error(`Invalid proxy header name: ${name || '(empty)'}`)
    if (/^proxy-authorization$/i.test(name)) throw new Error('Please include proxy credentials in the proxy URL, not in Proxy-Authorization header')
    if (!headerValue || headerValue.length > MAX_HEADER_VALUE) throw new Error(`Invalid value for proxy header "${name}"`)
    if (/[\r\n]/.test(headerValue)) throw new Error(`Proxy header "${name}" cannot contain newlines`)
    headers[name] = headerValue
  }
  return headers
}

/** Stable cache / warm-pool key fragment for a header map. */
export function agentProxyHeadersKey(headers: Record<string, string> | undefined): string {
  if (!headers || !Object.keys(headers).length) return ''
  return JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))
}

export function agentProxyKind(proxy: string): AgentProxyKind {
  if (/^socks/i.test(proxy)) return 'socks5'
  if (/^https:/i.test(proxy)) return 'https'
  return 'http'
}

export function isSocksProxy(proxy: string): boolean {
  return agentProxyKind(proxy) === 'socks5'
}

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.test(hostname)
}
