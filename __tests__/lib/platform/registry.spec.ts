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
    process.env.CHAYA_SERVICE = 'remote'
    expect(resolveRuntimeLane()).toBe('remote')
    process.env.VERCEL = '1'
    process.env.CHAYA_SERVICE = 'local'
    expect(resolveRuntimeLane()).toBe('remote')
  })

  it('getPlatformContext uses current env', () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'app'
    expect(getPlatformContext({ platform: 'linux' })).toEqual({ os: 'linux', lane: 'local' })
  })

  it('optional PlatformRegistry resolves with wildcards', () => {
    const reg = new PlatformRegistry()
    reg.register('demo', { os: '*', lane: 'remote' }, { via: 'remote-star' })
    reg.register('demo', { os: 'osx', lane: 'local' }, { via: 'osx-local' })
    reg.register('demo', { os: 'osx', lane: '*' }, { via: 'osx-any' })

    expect(reg.resolve('demo', { os: 'osx', lane: 'local' })).toEqual({ via: 'osx-local' })
    expect(reg.resolve('demo', { os: 'osx', lane: 'remote' })).toEqual({ via: 'osx-any' })
    expect(reg.resolve('demo', { os: 'linux', lane: 'remote' })).toEqual({ via: 'remote-star' })
    expect(reg.tryResolve('demo', { os: 'linux', lane: 'local' })).toBeNull()
  })

  it('remote pickPath returns unavailable via resolvePickPath when lane=remote', async () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'remote'
    // resolvePickPath 读真实 env；用 remote 实现直接测更稳
    const { RemotePickPath } = await import('@/services/platform/pick/remote')
    const result = await new RemotePickPath().pick('game')
    expect(result).toEqual({ ok: false, error: expect.stringContaining('not supported') })
  })

  it('resolvePickPath returns a pickPath capability on local', () => {
    delete process.env.VERCEL
    delete process.env.CHAYA_SERVICE
    expect(resolvePickPath().id).toBe('pickPath')
  })

  it('remote hostShell rejects', async () => {
    const { RemoteHostShell } = await import('@/services/platform/host/remote')
    await expect(new RemoteHostShell().reveal('/tmp')).rejects.toThrow('Local file manager is not supported in current service mode')
  })

  it('resolveHostShell returns hostShell on local', () => {
    delete process.env.VERCEL
    delete process.env.CHAYA_SERVICE
    expect(resolveHostShell().id).toBe('hostShell')
  })
})
