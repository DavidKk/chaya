import { type Dispatcher, fetch as undiciFetch, ProxyAgent } from 'undici'

import {
  agentProxyConfigured,
  agentProxyHeadersKey,
  type AgentProxyProtocols,
  isLoopbackHost,
  isSocksProxy,
  normalizeAgentProxy,
  normalizeAgentProxyHeaders,
  normalizeAgentProxyProtocols,
  resolveAgentProxySlots,
  runtimeAgentProxyUrl,
} from '@/lib/game-agent/proxy'
import { startOperation } from '@/services/log/operation'

import { socksBridgeUrl } from './socks-bridge'

/** Local MCP endpoints and Ollama on this machine never go through the agent's proxy. */
const NO_PROXY = 'localhost,127.0.0.1,::1'

export type AgentProxyProfile = {
  proxy?: string
  proxyProtocols?: AgentProxyProtocols
  proxyHeaders?: Record<string, string> | string
}

const dispatchers = new Map<string, Promise<Dispatcher>>()

function headerMap(profile: AgentProxyProfile | string | undefined): Record<string, string> {
  if (typeof profile === 'string' || profile == null) return {}
  try {
    return normalizeAgentProxyHeaders(profile.proxyHeaders)
  } catch {
    return {}
  }
}

function slotsOf(profile: AgentProxyProfile | string | undefined) {
  if (typeof profile === 'string') return resolveAgentProxySlots(profile)
  const defaults = profile?.proxy
  const overrides = normalizeAgentProxyProtocols(defaults, profile?.proxyProtocols)
  return resolveAgentProxySlots(defaults, overrides)
}

/** CLI-facing HTTP(S) proxy URL. socks5 and headered http/https proxies use the local bridge. */
async function cliProxyUrl(proxy: string, headers: Record<string, string>): Promise<string> {
  if (!proxy) return ''
  const runtime = runtimeAgentProxyUrl(proxy)
  if (isSocksProxy(runtime) || Object.keys(headers).length > 0) return socksBridgeUrl(runtime, headers)
  return runtime
}

/**
 * Proxy variables for a CLI / SDK child process.
 * One default fills HTTP / HTTPS / ALL / FTP (and SOCKS via ALL when the default is socks5);
 * per-protocol overrides win when set.
 */
export async function agentProxyEnv(profile: AgentProxyProfile | string | undefined): Promise<Record<string, string>> {
  let slots: ReturnType<typeof slotsOf>
  let headers: Record<string, string>
  try {
    slots = slotsOf(profile)
    headers = headerMap(profile)
  } catch {
    return {}
  }
  if (!agentProxyConfigured(slots)) return {}

  const http = await cliProxyUrl(slots.http || slots.all, headers)
  const https = await cliProxyUrl(slots.https || slots.all || slots.http, headers)
  const all = await cliProxyUrl(slots.all || slots.http || slots.https || slots.socks5, headers)
  const ftp = await cliProxyUrl(slots.ftp || slots.all || slots.http, headers)
  // Prefer an explicit socks5 slot for ALL when the default is socks and all inherited it.
  const socks = slots.socks5 ? await cliProxyUrl(slots.socks5, headers) : ''

  return {
    HTTP_PROXY: http || all,
    HTTPS_PROXY: https || all,
    ALL_PROXY: all || socks || http,
    FTP_PROXY: ftp || all,
    NO_PROXY,
    http_proxy: http || all,
    https_proxy: https || all,
    all_proxy: all || socks || http,
    ftp_proxy: ftp || all,
    no_proxy: NO_PROXY,
  }
}

function dispatcherFor(proxy: string, headers: Record<string, string>) {
  const runtime = runtimeAgentProxyUrl(proxy)
  const key = `${runtime}\n${agentProxyHeadersKey(headers)}`
  let dispatcher = dispatchers.get(key)
  if (!dispatcher) {
    dispatcher = (async () => {
      if (isSocksProxy(runtime)) return new ProxyAgent(await socksBridgeUrl(runtime, headers))
      if (Object.keys(headers).length) return new ProxyAgent({ uri: runtime, headers })
      return new ProxyAgent(runtime)
    })()
    dispatchers.set(key, dispatcher)
    dispatcher.catch(() => dispatchers.delete(key))
  }
  return dispatcher
}

function fetchProxyForEndpoint(endpoint: string, slots: ReturnType<typeof slotsOf>): string {
  let scheme = 'http:'
  try {
    scheme = new URL(endpoint).protocol
  } catch {
    // Keep http fallback.
  }
  if (scheme === 'https:') return slots.https || slots.all || slots.http || slots.socks5
  if (scheme === 'ftp:') return slots.ftp || slots.all || slots.http || slots.socks5
  return slots.http || slots.all || slots.https || slots.socks5
}

/**
 * `fetch` for an HTTP model profile, routed through its proxy unless the endpoint is on this machine.
 * Custom `proxyHeaders` are sent to the upstream HTTP proxy (or via the SOCKS bridge when needed).
 */
export function ollamaFetch(profile: AgentProxyProfile & { endpoint: string }): typeof fetch {
  let proxy = ''
  let headers: Record<string, string> = {}
  try {
    const slots = slotsOf(profile)
    proxy = fetchProxyForEndpoint(profile.endpoint, slots)
    headers = normalizeAgentProxyHeaders(profile.proxyHeaders)
    if (isLoopbackHost(new URL(profile.endpoint).hostname)) proxy = ''
  } catch {
    proxy = ''
  }
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const timing = startOperation('communication', 'agent.http.headers', {
      host: url.host,
      path: url.pathname,
      method: init?.method || (input instanceof Request ? input.method : 'GET'),
      proxy: !!proxy,
    })
    try {
      const response = proxy
        ? await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
            ...(init as Parameters<typeof undiciFetch>[1]),
            dispatcher: await dispatcherFor(proxy, headers),
          })
        : await fetch(input, init)
      // Fetch resolves at headers; agent.request includes consuming and parsing the body.
      timing.end(response.status >= 400 ? 'failed' : 'completed', { status: response.status, phase: 'headers' })
      return response
    } catch (error) {
      timing.fail(error)
      throw error
    }
  }) as unknown as typeof fetch
}

/** @deprecated Prefer profile-shaped calls; kept for string-only callers. */
export function normalizeProfileProxy(proxy: string | undefined): string {
  return normalizeAgentProxy(proxy)
}
