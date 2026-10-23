import { type BindingStatusInput, buildBindingChecks } from '@/components/BindingStatusMenu'

describe('buildBindingChecks', () => {
  const fakeT = ((key: string) => key) as any

  const baseStatus: BindingStatusInput = {
    kind: 'rgss',
    hasShell: true,
    bundled: false,
    plugins: [{ name: 'ChayaRGSS', registered: true, enabled: true, fileExists: true }],
    hasNwPackage: false,
  }

  it('omits package.json check for RGSS engines (VX Ace and VX)', () => {
    const vxAceChecks = buildBindingChecks({ ...baseStatus, engine: 'VX Ace' }, fakeT)
    expect(vxAceChecks.some((c) => c.id === 'window')).toBe(false)
    expect(vxAceChecks.every((c) => c.ok)).toBe(true)

    const vxChecks = buildBindingChecks({ ...baseStatus, engine: 'VX' }, fakeT)
    expect(vxChecks.some((c) => c.id === 'window')).toBe(false)
    expect(vxChecks.every((c) => c.ok)).toBe(true)
  })

  it('includes package.json check for MV engines', () => {
    const mvChecks = buildBindingChecks({ ...baseStatus, engine: 'MV' }, fakeT)
    const windowCheck = mvChecks.find((c) => c.id === 'window')
    expect(windowCheck).toBeDefined()
    expect(windowCheck?.ok).toBe(false)
    expect(mvChecks.every((c) => c.ok)).toBe(false)
  })
})
