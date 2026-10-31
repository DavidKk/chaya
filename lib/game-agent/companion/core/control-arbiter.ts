/**
 * Control Arbiter for game operation authority.
 * Prevents multiple controllers/tasks from dispatching conflicting inputs.
 * Governs generations, immediate revocation, and safe release semantics.
 */

import type { AuthorizedControlRequest, ControlArbiter, ControlLease, ControlRevocationReason } from './types'

export class ControlArbiterError extends Error {
  constructor(
    message: string,
    public readonly code: 'LEASE_EXPIRED' | 'LEASE_REVOKED' | 'UNAUTHORIZED' | 'CONTROL_BUSY'
  ) {
    super(message)
    this.name = 'ControlArbiterError'
  }
}

export function createControlArbiter(): ControlArbiter & { revokeCurrent(reason: ControlRevocationReason): void } {
  let activeLease: ControlLease | null = null
  let currentGeneration = 0
  let revokedGeneration = -1
  const inputs = new Map<symbol, { generation: number; cancel: () => void }>()
  const idleWaiters = new Set<() => void>()

  function cancelInputs(generation: number): void {
    for (const input of inputs.values()) {
      if (input.generation === generation) input.cancel()
    }
  }

  return {
    acquire(input: AuthorizedControlRequest): ControlLease {
      if (!input.ownerId || !input.runtimeInstanceId) {
        throw new ControlArbiterError('Invalid control request: missing ownerId or runtimeInstanceId', 'UNAUTHORIZED')
      }
      if (activeLease || inputs.size) throw new ControlArbiterError('Game control is already held', 'CONTROL_BUSY')

      currentGeneration += 1
      const lease: ControlLease = {
        runtimeInstanceId: input.runtimeInstanceId,
        ownerId: input.ownerId,
        generation: currentGeneration,
        acquiredAt: input.requestedAt || Date.now(),
      }
      activeLease = lease
      return { ...lease }
    },

    assertCurrent(lease: ControlLease): void {
      if (!activeLease) {
        throw new ControlArbiterError('No active control lease present', 'LEASE_EXPIRED')
      }
      if (lease.generation <= revokedGeneration) {
        throw new ControlArbiterError(`Control lease generation ${lease.generation} has been revoked`, 'LEASE_REVOKED')
      }
      if (activeLease.generation !== lease.generation || activeLease.ownerId !== lease.ownerId || activeLease.runtimeInstanceId !== lease.runtimeInstanceId) {
        throw new ControlArbiterError(
          `Control lease mismatch: active is generation ${activeLease.generation} (${activeLease.ownerId}), requested was ${lease.generation} (${lease.ownerId})`,
          'LEASE_EXPIRED'
        )
      }
    },

    isCurrent(lease: ControlLease): boolean {
      if (!activeLease) return false
      if (lease.generation <= revokedGeneration) return false
      return activeLease.generation === lease.generation && activeLease.ownerId === lease.ownerId && activeLease.runtimeInstanceId === lease.runtimeInstanceId
    },

    currentLease(): ControlLease | null {
      return activeLease ? { ...activeLease } : null
    },

    trackInput(lease: ControlLease, cancel: () => void): () => void {
      this.assertCurrent(lease)
      const id = Symbol()
      inputs.set(id, { generation: lease.generation, cancel })
      return () => {
        inputs.delete(id)
        if (!inputs.size) {
          for (const resolve of idleWaiters) resolve()
          idleWaiters.clear()
        }
      }
    },

    whenIdle(): Promise<void> {
      return inputs.size ? new Promise((resolve) => idleWaiters.add(resolve)) : Promise.resolve()
    },

    revoke(lease: ControlLease, _reason: ControlRevocationReason): void {
      // Must compare full lease so old callbacks cannot revoke a newer lease
      if (activeLease && activeLease.generation === lease.generation && activeLease.ownerId === lease.ownerId && activeLease.runtimeInstanceId === lease.runtimeInstanceId) {
        revokedGeneration = Math.max(revokedGeneration, lease.generation)
        activeLease = null
        cancelInputs(lease.generation)
      }
    },

    revokeCurrent(_reason: ControlRevocationReason): void {
      if (activeLease) {
        const generation = activeLease.generation
        revokedGeneration = Math.max(revokedGeneration, generation)
        activeLease = null
        cancelInputs(generation)
      }
    },

    release(lease: ControlLease): void {
      // Release only succeeds if the active lease is exactly this lease
      if (activeLease && activeLease.generation === lease.generation && activeLease.ownerId === lease.ownerId && activeLease.runtimeInstanceId === lease.runtimeInstanceId) {
        activeLease = null
        cancelInputs(lease.generation)
      }
    },
  }
}
