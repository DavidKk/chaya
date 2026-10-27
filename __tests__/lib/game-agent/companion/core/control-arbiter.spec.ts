import { ControlArbiterError, createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'

describe('ControlArbiter', () => {
  test('rejects competing acquisition and does not expose mutable active leases', () => {
    const arbiter = createControlArbiter()
    const request = { runtimeInstanceId: 'inst-1', ownerId: 'owner-a', scope: 'battle', allowedActions: ['attack'], requestedAt: 1000 }
    const lease = arbiter.acquire(request)
    expect(() => arbiter.acquire({ ...request, ownerId: 'owner-b' })).toThrow('Game control is already held')
    lease.ownerId = 'mutated'
    const snapshot = arbiter.currentLease()!
    expect(snapshot.ownerId).toBe('owner-a')
    snapshot.ownerId = 'another-mutation'
    expect(arbiter.currentLease()?.ownerId).toBe('owner-a')
  })

  test('acquires sequential leases with increasing generation', () => {
    const arbiter = createControlArbiter()
    const l1 = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'owner-a',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: 1000,
    })
    expect(l1.generation).toBe(1)
    expect(arbiter.isCurrent(l1)).toBe(true)
    expect(arbiter.currentLease()?.generation).toBe(1)

    arbiter.release(l1)
    const l2 = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'owner-b',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: 2000,
    })
    expect(l2.generation).toBe(2)
    expect(arbiter.isCurrent(l2)).toBe(true)
    expect(arbiter.isCurrent(l1)).toBe(false)
  })

  test('assertCurrent passes for active lease and throws for expired/revoked lease', () => {
    const arbiter = createControlArbiter()
    const l1 = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'owner-a',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: 1000,
    })
    expect(() => arbiter.assertCurrent(l1)).not.toThrow()

    arbiter.revoke(l1, 'user_stop')
    expect(arbiter.isCurrent(l1)).toBe(false)
    expect(() => arbiter.assertCurrent(l1)).toThrow(ControlArbiterError)
  })

  test('old lease callback cannot revoke or release a newer lease', () => {
    const arbiter = createControlArbiter()
    const l1 = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'owner-same',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: 1000,
    })

    arbiter.revoke(l1, 'user_stop')
    const l2 = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'owner-same',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: 2000,
    })

    // Old lease l1 calls release
    arbiter.release(l1)
    expect(arbiter.isCurrent(l2)).toBe(true)

    // Old lease l1 calls revoke
    arbiter.revoke(l1, 'user_stop')
    expect(arbiter.isCurrent(l2)).toBe(true)
    expect(() => arbiter.assertCurrent(l2)).not.toThrow()
  })

  test('revokeCurrent revokes whatever lease is active', () => {
    const arbiter = createControlArbiter()
    const l1 = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'owner-a',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: 1000,
    })
    arbiter.revokeCurrent('manual_takeover')
    expect(arbiter.isCurrent(l1)).toBe(false)
    expect(arbiter.currentLease()).toBeNull()
  })
})
