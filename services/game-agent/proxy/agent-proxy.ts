import { type Dispatcher, fetch as undiciFetch, ProxyAgent } from 'undici'

import { agentProxyKind, isLoopbackHost, normalizeAgentProxy } from '@/lib/game-agent/proxy'

import { socksBridgeUrl } from './socks-bridge'

/** Local MCP endpoints and Ollama on this machine never go through the agent's proxy. */
const NO_PROXY = 'localhost,127.0.0.1,::1'

const dispatchers = new Map<string, Promise<Dispatcher>>()

/** An HTTP(S) proxy URL every client understands; SOCKS proxies are reached through the local bridge. */
async function httpProxyUrl(proxy: string): Promise<string> {
  return agentProxyKind(proxy) === 'socks' ? socksBridgeUrl(proxy) : proxy
}

/** Proxy variables for a CLI child process; empty when the profile has no proxy (Chaya's own environment applies). */
export async function agentProxyEnv(proxy: string | undefined): Promise<Record<string, string>> {
  const normalized = normalizeAgentProxy(proxy)
  if (!normalized) return {}
  const url = await httpProxyUrl(normalized)
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    ALL_PROXY: url,
    NO_PROXY,
    http_proxy: url,
    https_proxy: url,
    all_proxy: url,
    no_proxy: NO_PROXY,
  }
}

function dispatcherFor(proxy: string) {
  let dispatcher = dispatchers.get(proxy)
  if (!dispatcher) {
    dispatcher = httpProxyUrl(proxy).then((url) => new ProxyAgent(url))
    dispatchers.set(proxy, dispatcher)
    dispatcher.catch(() => dispatchers.delete(proxy))
  }
  return dispatcher
}

/** `fetch` for an Ollama profile, routed through its proxy unless the endpoint is on this machine. */
export function ollamaFetch(profile: { endpoint: string; proxy?: string }): typeof fetch {
  let proxy: string
  try {
    proxy = normalizeAgentProxy(profile.proxy)
    if (!proxy || isLoopbackHost(new URL(profile.endpoint).hostname)) return fetch
  } catch {
    return fetch
  }
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: await dispatcherFor(proxy) })) as unknown as typeof fetch
}
