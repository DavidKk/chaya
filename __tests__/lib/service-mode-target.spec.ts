type ModeModule = typeof import('@/lib/service-mode/mode')
type TargetModule = typeof import('@/lib/service-mode/target')

const KEYS = ['NEXT_PUBLIC_CHAYA_TARGET', 'CHAYA_DEV_TARGET', 'CHAYA_SERVICE', 'VERCEL'] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

function load(env: Partial<Record<(typeof KEYS)[number], string>>): ModeModule & TargetModule {
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, env)
  let mod!: ModeModule & TargetModule
  jest.isolateModules(() => {
    mod = { ...jest.requireActual<ModeModule>('@/lib/service-mode/mode'), ...jest.requireActual<TargetModule>('@/lib/service-mode/target') }
  })
  return mod
}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('build target', () => {
  it('treats a missing target as a server build', () => {
    expect(load({}).BUILD_TARGET).toBe('server')
  })

  it('edge builds are always vercel, even with CHAYA_SERVICE=local', () => {
    const mod = load({ NEXT_PUBLIC_CHAYA_TARGET: 'edge', CHAYA_SERVICE: 'local' })
    expect(mod.getServiceMode()).toBe('vercel')
    expect(mod.canUseDisk()).toBe(false)
  })

  it('server builds keep honouring CHAYA_SERVICE=app', () => {
    expect(load({ NEXT_PUBLIC_CHAYA_TARGET: 'server', CHAYA_SERVICE: 'app' }).getServiceMode()).toBe('app')
  })
})

describe('dev target switch', () => {
  it('defaults to server, or edge when started with CHAYA_SERVICE=vercel', () => {
    expect(load({ NEXT_PUBLIC_CHAYA_TARGET: 'dev', CHAYA_SERVICE: 'local' }).getServiceMode()).toBe('local')
    expect(load({ NEXT_PUBLIC_CHAYA_TARGET: 'dev', CHAYA_SERVICE: 'vercel' }).getServiceMode()).toBe('vercel')
  })

  it('switches the whole process without reloading modules', () => {
    const mod = load({ NEXT_PUBLIC_CHAYA_TARGET: 'dev', CHAYA_SERVICE: 'app' })
    expect(mod.getServiceMode()).toBe('app')
    mod.setDevTarget('edge')
    expect(mod.getServiceMode()).toBe('vercel')
    mod.setDevTarget('server')
    expect(mod.getServiceMode()).toBe('app')
  })

  it('ignores the dev switch outside dev builds', () => {
    expect(load({ NEXT_PUBLIC_CHAYA_TARGET: 'server', CHAYA_DEV_TARGET: 'edge' }).getServiceMode()).toBe('local')
  })
})
