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
} from '@/lib/game-agent/proxy'

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
  if (isSocksProxy(proxy) || Object.keys(headers).length > 0) return socksBridgeUrl(proxy, headers)
  return proxy
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
  const key = `${proxy}\n${agentProxyHeadersKey(headers)}`
  let dispatcher = dispatchers.get(key)
  if (!dispatcher) {
    dispatcher = (async () => {
      if (isSocksProxy(proxy)) return new ProxyAgent(await socksBridgeUrl(proxy, headers))
      if (Object.keys(headers).length) return new ProxyAgent({ uri: proxy, headers })
      return new ProxyAgent(proxy)
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
  let proxy: string
  let headers: Record<string, string>
  try {
    const slots = slotsOf(profile)
    proxy = fetchProxyForEndpoint(profile.endpoint, slots)
    headers = normalizeAgentProxyHeaders(profile.proxyHeaders)
    if (!proxy || isLoopbackHost(new URL(profile.endpoint).hostname)) return fetch
  } catch {
    return fetch
  }
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: await dispatcherFor(proxy, headers),
    })) as unknown as typeof fetch
}

/** @deprecated Prefer profile-shaped calls; kept for string-only callers. */
export function normalizeProfileProxy(proxy: string | undefined): string {
  return normalizeAgentProxy(proxy)
}
