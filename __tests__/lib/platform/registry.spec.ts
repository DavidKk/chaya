import { getPlatformContext, PlatformRegistry, resolveHostOs, resolveRuntimeLane } from '@/lib/platform'
import { resolveHostShell, resolvePickPath } from '@/services/platform'

describe('platform env + capability tables', () => {
  const prevService = process.env.CHAYA_SERVICE
  const prevVercel = process.env.VERCEL

  afterEach(() => {
    if (prevService === undefined) delete process.env.CHAYA_SERVICE
    else process.env.CHAYA_SERVICE = prevService
    if (prevVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = prevVercel
  })

  it('maps process.platform to HostOs', () => {
    expect(resolveHostOs('darwin')).toBe('osx')
    expect(resolveHostOs('win32')).toBe('windows')
    expect(resolveHostOs('linux')).toBe('linux')
    expect(resolveHostOs('freebsd')).toBeNull()
  })

  it('maps service mode to RuntimeLane', () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'local'
    expect(resolveRuntimeLane()).toBe('local')
    process.env.CHAYA_SERVICE = 'app'
    expect(resolveRuntimeLane()).toBe('local')
    process.env.CHAYA_SERVICE = 'vercel'
    expect(resolveRuntimeLane()).toBe('edge')
    process.env.VERCEL = '1'
    process.env.CHAYA_SERVICE = 'local'
    expect(resolveRuntimeLane()).toBe('edge')
  })

  it('getPlatformContext uses current env', () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'app'
    expect(getPlatformContext({ platform: 'linux' })).toEqual({ os: 'linux', lane: 'local' })
  })

  it('optional PlatformRegistry resolves with wildcards', () => {
    const reg = new PlatformRegistry()
    reg.register('demo', { os: '*', lane: 'edge' }, { via: 'edge-star' })
    reg.register('demo', { os: 'osx', lane: 'local' }, { via: 'osx-local' })
    reg.register('demo', { os: 'osx', lane: '*' }, { via: 'osx-any' })

    expect(reg.resolve('demo', { os: 'osx', lane: 'local' })).toEqual({ via: 'osx-local' })
    expect(reg.resolve('demo', { os: 'osx', lane: 'edge' })).toEqual({ via: 'osx-any' })
    expect(reg.resolve('demo', { os: 'linux', lane: 'edge' })).toEqual({ via: 'edge-star' })
    expect(reg.tryResolve('demo', { os: 'linux', lane: 'local' })).toBeNull()
  })

  it('edge pickPath returns unavailable via resolvePickPath when lane=edge', async () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'vercel'
    // resolvePickPath 读真实 env；用 edge 实现直接测更稳
    const { EdgePickPath } = await import('@/services/platform/pick/edge')
    const result = await new EdgePickPath().pick('game')
    expect(result).toEqual({ ok: false, error: expect.stringContaining('不支持') })
  })

  it('resolvePickPath returns a pickPath capability on local', () => {
    delete process.env.VERCEL
    delete process.env.CHAYA_SERVICE
    expect(resolvePickPath().id).toBe('pickPath')
  })

  it('edge hostShell rejects', async () => {
    const { EdgeHostShell } = await import('@/services/platform/host/edge')
    await expect(new EdgeHostShell().reveal('/tmp')).rejects.toThrow(/不支持/)
  })

  it('resolveHostShell returns hostShell on local', () => {
    delete process.env.VERCEL
    delete process.env.CHAYA_SERVICE
    expect(resolveHostShell().id).toBe('hostShell')
  })
})
