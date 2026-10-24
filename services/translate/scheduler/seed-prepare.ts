/**
 * Single-flight seed inventory prepare for Start/Continue.
 * @see docs/translation-mainthread-offload.md §3.3
 */
import path from 'node:path'

import type { SeedProgress } from '@/services/translate/fill-missing'
import { readSeedInventory } from '@/services/translate/scheduler/seed-inventory'
import { singleFlight, yieldEventLoop } from '@/services/translate/scheduler/single-flight'

export type SeedInventoryBundle = {
  progress: SeedProgress
  pending: string[]
  stamp: string
}

const flights = new Map<string, Promise<SeedInventoryBundle>>()
const cache = new Map<string, SeedInventoryBundle>()

function keyFor(contentRoot: string) {
  return path.resolve(contentRoot)
}

export function peekSeedInventory(contentRoot: string): SeedInventoryBundle | null {
  return cache.get(keyFor(contentRoot)) ?? null
}

/** True while prepareSeedInventory is in-flight (poll must not demote running→paused). */
export function isSeedInventoryPreparing(contentRoot: string): boolean {
  return flights.has(keyFor(contentRoot))
}

export function prepareSeedInventory(contentRoot: string): Promise<SeedInventoryBundle> {
  const key = keyFor(contentRoot)
  return singleFlight(flights, key, async () => {
    await yieldEventLoop()
    const inv = readSeedInventory(contentRoot)
    const bundle: SeedInventoryBundle = { progress: inv.progress, pending: inv.pending, stamp: inv.stamp }
    cache.set(key, bundle)
    return bundle
  })
}

export function resetSeedPrepareForTests() {
  flights.clear()
  cache.clear()
}
