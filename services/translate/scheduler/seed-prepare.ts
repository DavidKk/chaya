/**
 * Single-flight seed inventory prepare for Start/Continue / explicit refresh.
 * Heavy `readSeedInventory` runs in a worker thread so Next.js APIs stay responsive.
 * @see docs/translation-mainthread-offload.md §3.3
 */
import fs from 'node:fs'
import path from 'node:path'

import { SEED_INVENTORY_WORKER_PATH } from '@/constants/paths'
import { runWorkerOnce, singleFlight, yieldEventLoop } from '@/services/jobs'
import type { SeedProgress } from '@/services/translate/fill-missing'
import { readSeedInventory } from '@/services/translate/scheduler/seed-inventory'

export type SeedInventoryBundle = {
  progress: SeedProgress
  pending: string[]
  stamp: string
  progressStamp?: string
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

async function runSeedInventoryWorker(contentRoot: string): Promise<SeedInventoryBundle> {
  const { path: out } = await runWorkerOnce({
    entry: SEED_INVENTORY_WORKER_PATH,
    workerData: { contentRoot },
    missingError: 'SEED_INVENTORY_WORKER_MISSING',
  })
  try {
    return JSON.parse(fs.readFileSync(out, 'utf8')) as SeedInventoryBundle
  } finally {
    fs.unlink(out, () => {})
  }
}

export function prepareSeedInventory(contentRoot: string): Promise<SeedInventoryBundle> {
  const key = keyFor(contentRoot)
  return singleFlight(flights, key, async () => {
    await yieldEventLoop()
    let bundle: SeedInventoryBundle
    try {
      bundle = await runSeedInventoryWorker(contentRoot)
    } catch {
      // Worker missing / crash: fall back on this background task only (still off the HTTP return).
      await yieldEventLoop()
      const { openSharedCache } = await import('@/services/translate/shared-cache')
      const store = openSharedCache()
      try {
        store.syncGameCache(contentRoot)
      } finally {
        store.close()
      }
      const inv = readSeedInventory(contentRoot)
      bundle = inv
    }
    cache.set(key, bundle)
    return bundle
  })
}

export function resetSeedPrepareForTests() {
  flights.clear()
  cache.clear()
}
