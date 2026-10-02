import { resolveInAppPath } from '@/components/webmcp/page/tools'

const ORIGIN = 'http://127.0.0.1:3927'

describe('resolveInAppPath', () => {
  it('keeps same-origin page paths with query and hash', () => {
    expect(resolveInAppPath('/logs?level=fail#top', ORIGIN)).toBe('/logs?level=fail#top')
    expect(resolveInAppPath(`${ORIGIN}/game`, ORIGIN)).toBe('/game')
    expect(resolveInAppPath('translate/cache', ORIGIN)).toBe('/translate/cache')
  })

  it('rejects other origins and schemes', () => {
    expect(resolveInAppPath('https://evil.example/game', ORIGIN)).toBeNull()
    expect(resolveInAppPath('//evil.example/game', ORIGIN)).toBeNull()
    expect(resolveInAppPath('javascript:alert(1)', ORIGIN)).toBeNull()
    expect(resolveInAppPath('  ', ORIGIN)).toBeNull()
  })

  it('rejects API paths, including encoded and case variants', () => {
    for (const raw of ['/api', '/api/integration/mcp', '/API/status', '/%61pi/status', '/game/../api/status', '/%zz']) {
      expect(resolveInAppPath(raw, ORIGIN)).toBeNull()
    }
    expect(resolveInAppPath('/apix', ORIGIN)).toBe('/apix')
  })
})
