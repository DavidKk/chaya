import { followsOwnedStampChain } from '@/services/translate/scheduler/owned-stamps'

describe('owned cache file transitions', () => {
  it('accepts only a complete non-branching chain from the scan stamp to the current stamp', () => {
    const chain = new Map([
      ['v1', 'v2'],
      ['v2', 'v3'],
    ])
    expect(followsOwnedStampChain('v1', 'v3', chain)).toBe(true)
    expect(followsOwnedStampChain('v1', 'v2', chain)).toBe(true)
    expect(followsOwnedStampChain('v1', 'v4', chain)).toBe(false)
    expect(followsOwnedStampChain('v1', 'v3', new Map([['v1', 'v2']]))).toBe(false)
    expect(followsOwnedStampChain('v1', 'v1', chain)).toBe(true)
  })

  it('rejects a cycle or a chain that was truncated', () => {
    expect(
      followsOwnedStampChain(
        'v1',
        'v3',
        new Map([
          ['v1', 'v2'],
          ['v2', 'v1'],
        ])
      )
    ).toBe(false)
    expect(followsOwnedStampChain('v1', 'v2', new Map())).toBe(false)
  })
})
