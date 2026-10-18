import { canUseDisk, getServiceMode, requireDisk } from '@/lib/service-mode'

describe('service-mode', () => {
  const prevService = process.env.CHAYA_SERVICE
  const prevVercel = process.env.VERCEL

  afterEach(() => {
    if (prevService === undefined) delete process.env.CHAYA_SERVICE
    else process.env.CHAYA_SERVICE = prevService
    if (prevVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = prevVercel
  })

  it('defaults to local with disk', () => {
    delete process.env.CHAYA_SERVICE
    delete process.env.VERCEL
    expect(getServiceMode()).toBe('local')
    expect(canUseDisk()).toBe(true)
  })

  it('forces remote when VERCEL=1 even if CHAYA_SERVICE=local', () => {
    process.env.VERCEL = '1'
    process.env.CHAYA_SERVICE = 'local'
    expect(getServiceMode()).toBe('remote')
    expect(canUseDisk()).toBe(false)
  })

  it('allows CHAYA_SERVICE=remote off-platform to simulate cloud', () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'remote'
    expect(getServiceMode()).toBe('remote')
    expect(canUseDisk()).toBe(false)
  })

  it('reads app mode when not on Vercel', () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'app'
    expect(getServiceMode()).toBe('app')
    expect(canUseDisk()).toBe(true)
  })

  it('rejects a non-empty invalid CHAYA_SERVICE', () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'invalid'
    expect(() => getServiceMode()).toThrow(/Invalid CHAYA_SERVICE configuration/)
  })

  it('requireDisk returns null when disk is allowed', () => {
    delete process.env.VERCEL
    delete process.env.CHAYA_SERVICE
    expect(requireDisk()).toBeNull()
  })

  it('requireDisk returns 501 DISK_UNAVAILABLE on remote', async () => {
    process.env.VERCEL = '1'
    const res = requireDisk()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(501)
    const body = (await res!.json()) as { ok: false; error: { code: string; message: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('DISK_UNAVAILABLE')
  })

  it('requireDisk returns 501 when simulating cloud via CHAYA_SERVICE=remote', async () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'remote'
    const res = requireDisk()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(501)
    const body = (await res!.json()) as { ok: false; error: { code: string } }
    expect(body.error.code).toBe('DISK_UNAVAILABLE')
  })

  it('requireDisk allows app mode', () => {
    delete process.env.VERCEL
    process.env.CHAYA_SERVICE = 'app'
    expect(requireDisk()).toBeNull()
  })
})
