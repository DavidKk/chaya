import {
  agentProxyKind,
  isLoopbackHost,
  isSocksProxy,
  normalizeAgentProxy,
  normalizeAgentProxyHeaders,
  normalizeAgentProxyProtocols,
  resolveAgentProxySlots,
} from '@/lib/game-agent/proxy'

test('normalizes supported proxy URLs and bare host:port as http default', () => {
  expect(normalizeAgentProxy('  ')).toBe('')
  expect(normalizeAgentProxy(undefined)).toBe('')
  expect(normalizeAgentProxy('127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
  expect(normalizeAgentProxy('http://127.0.0.1:7890/')).toBe('http://127.0.0.1:7890')
  expect(normalizeAgentProxy('https://proxy.example:8443')).toBe('https://proxy.example:8443')
  expect(normalizeAgentProxy('socks5h://user:p%40ss@proxy.example:1080')).toBe('socks5://user:p%40ss@proxy.example:1080')
  expect(normalizeAgentProxy('socks://127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080')
})

test('rejects other schemes and URLs with paths', () => {
  expect(() => normalizeAgentProxy('ftp://127.0.0.1:21')).toThrow('仅支持')
  expect(() => normalizeAgentProxy('http://127.0.0.1:7890/pac')).toThrow('路径')
})

test('declares http, https and socks5 as distinct server kinds', () => {
  expect(agentProxyKind('http://127.0.0.1:7890')).toBe('http')
  expect(agentProxyKind('https://proxy.example')).toBe('https')
  expect(agentProxyKind('socks5://127.0.0.1:7890')).toBe('socks5')
  expect(isSocksProxy('socks5://127.0.0.1:7890')).toBe(true)
  expect(isSocksProxy('https://proxy.example')).toBe(false)
  expect(['localhost', '127.0.0.1', '::1', '[::1]'].every(isLoopbackHost)).toBe(true)
  expect(isLoopbackHost('192.168.1.2')).toBe(false)
})

test('default proxy fills http https socks5 all and ftp like ZeroOmega', () => {
  const slots = resolveAgentProxySlots('127.0.0.1:7890')
  expect(slots).toEqual({
    http: 'http://127.0.0.1:7890',
    https: 'http://127.0.0.1:7890',
    socks5: 'http://127.0.0.1:7890',
    all: 'http://127.0.0.1:7890',
    ftp: 'http://127.0.0.1:7890',
  })
})

test('per-protocol overrides win while empty slots keep inheriting the default', () => {
  const slots = resolveAgentProxySlots('http://127.0.0.1:7890', { https: 'socks5://127.0.0.1:1080', ftp: '' })
  expect(slots.http).toBe('http://127.0.0.1:7890')
  expect(slots.https).toBe('socks5://127.0.0.1:1080')
  expect(slots.ftp).toBe('http://127.0.0.1:7890')
  expect(normalizeAgentProxyProtocols('http://127.0.0.1:7890', { https: 'socks5://127.0.0.1:1080', http: 'http://127.0.0.1:7890' })).toEqual({
    https: 'socks5://127.0.0.1:1080',
  })
})

test('normalizes proxy headers from lines, JSON text, or maps', () => {
  expect(normalizeAgentProxyHeaders('')).toEqual({})
  expect(normalizeAgentProxyHeaders('X-Token: abc\nUser-Agent=chaya')).toEqual({ 'X-Token': 'abc', 'User-Agent': 'chaya' })
  expect(normalizeAgentProxyHeaders('{"X-Token":"abc","User-Agent":"chaya"}')).toEqual({ 'X-Token': 'abc', 'User-Agent': 'chaya' })
  expect(normalizeAgentProxyHeaders('[{"name":"X-Token","value":"abc"}]')).toEqual({ 'X-Token': 'abc' })
  expect(normalizeAgentProxyHeaders({ 'X-Token': 'abc' })).toEqual({ 'X-Token': 'abc' })
  expect(() => normalizeAgentProxyHeaders('not-a-header')).toThrow('代理请求头')
  expect(() => normalizeAgentProxyHeaders('{bad json')).toThrow('JSON')
  expect(() => normalizeAgentProxyHeaders('Proxy-Authorization: Basic x')).toThrow('Proxy-Authorization')
})
