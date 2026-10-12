import { agentProxyKind, isLoopbackHost, normalizeAgentProxy } from '@/lib/game-agent/proxy'

test('normalizes supported proxy URLs to scheme, credentials, host and port', () => {
  expect(normalizeAgentProxy('  ')).toBe('')
  expect(normalizeAgentProxy(undefined)).toBe('')
  expect(normalizeAgentProxy('http://127.0.0.1:7890/')).toBe('http://127.0.0.1:7890')
  expect(normalizeAgentProxy('socks5h://user:p%40ss@proxy.example:1080')).toBe('socks5h://user:p%40ss@proxy.example:1080')
  expect(normalizeAgentProxy('https://[::1]:8443')).toBe('https://[::1]:8443')
})

test('rejects other schemes and URLs with paths', () => {
  expect(() => normalizeAgentProxy('127.0.0.1:7890')).toThrow('代理')
  expect(() => normalizeAgentProxy('ftp://127.0.0.1:21')).toThrow('仅支持')
  expect(() => normalizeAgentProxy('http://127.0.0.1:7890/pac')).toThrow('路径')
})

test('classifies proxies and recognizes loopback hosts', () => {
  expect(agentProxyKind('socks5://127.0.0.1:7890')).toBe('socks')
  expect(agentProxyKind('https://proxy.example')).toBe('http')
  expect(['localhost', '127.0.0.1', '::1', '[::1]'].every(isLoopbackHost)).toBe(true)
  expect(isLoopbackHost('192.168.1.2')).toBe(false)
})
