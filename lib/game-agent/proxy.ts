const PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'])

export type AgentProxyKind = 'http' | 'socks'

/** `''` means no per-agent proxy (Chaya's own environment applies). Throws a player-facing message when invalid. */
export function normalizeAgentProxy(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('代理地址格式无效，例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890')
  }
  if (!PROTOCOLS.has(url.protocol)) throw new Error('代理仅支持 http、https、socks5 协议')
  if (!url.hostname) throw new Error('代理地址缺少主机名')
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) throw new Error('代理地址只需协议、主机和端口，不要带路径')
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
  return `${url.protocol}//${auth}${url.host}`
}

export function agentProxyKind(proxy: string): AgentProxyKind {
  return /^socks/i.test(proxy) ? 'socks' : 'http'
}

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.test(hostname)
}
