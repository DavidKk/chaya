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
import { createGameTranslateLookup } from '@/services/translate/game-lookup'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { readSeedInventory, seedFileStamp, seedProgressStamp } from '@/services/translate/scheduler/seed-inventory'
import { readSeedFailures } from '@/services/translate/seed-failures'
import { seedJobFile } from '@/services/translate/seed-job-state'
import { charCount } from '@/services/translate/text-classify'

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

export function seedInventoryFile(contentRoot: string): string {
  return seedJobFile(contentRoot).replace(/\.json$/, '.inventory.json')
}

export function readPersistedSeedInventory(contentRoot: string): SeedInventoryBundle | null {
  try {
    const file = seedInventoryFile(contentRoot)
    if (!fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as SeedInventoryBundle
    if (!raw || !raw.progress || !Array.isArray(raw.pending) || !raw.stamp) return null
    return raw
  } catch {
    return null
  }
}

export function persistSeedInventory(contentRoot: string, bundle: SeedInventoryBundle) {
  try {
    const file = seedInventoryFile(contentRoot)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(bundle), 'utf8')
    fs.renameSync(tmp, file)
  } catch {
    /* non-fatal fallback */
  }
}

/**
 * Fast reconciliation: when source text (seed.json) is unchanged, reconcile pending
 * items against local game records (cache.ndjson) and failures in milliseconds instead
 * of running a full tens-of-seconds inventory scan across SQLite.
 */
export function reconcileSeedInventory(bundle: SeedInventoryBundle, contentRoot: string): SeedInventoryBundle {
  const seedStampNow = seedFileStamp(contentRoot)
  if (bundle.stamp !== seedStampNow) return bundle

  const progressStampNow = seedProgressStamp(contentRoot)
  if (bundle.progressStamp === progressStampNow) return bundle

  const records = loadGameTranslationRecords(contentRoot, undefined, { localOnly: true })
  const doneLookup = createGameTranslateLookup(records)
  const failures = readSeedFailures(contentRoot)

  const pending: string[] = []
  let done = 0
  let doneChars = 0
  let missing = 0
  let missingChars = 0
  let failedCount = 0
  let failedChars = 0

  for (const key of bundle.pending) {
    const chars = charCount(key)
    if (doneLookup[key] != null) {
      done++
      doneChars += chars
    } else if (failures.has(key)) {
      failedCount++
      failedChars += chars
    } else {
      missing++
      missingChars += chars
      pending.push(key)
    }
  }

  const previouslyDone = bundle.progress.done
  const totalDone = previouslyDone + done

  const progress: SeedProgress = {
    ...bundle.progress,
    done: totalDone,
    doneChars: bundle.progress.doneChars + doneChars,
    missing,
    missingChars,
    failedCount,
    failedChars,
    batchesLeft: Math.ceil(missing / (bundle.progress.batchSize || 40)),
  }

  return {
    progress,
    pending,
    stamp: bundle.stamp,
    progressStamp: progressStampNow,
  }
}

export function setSeedInventory(contentRoot: string, bundle: SeedInventoryBundle) {
  const key = keyFor(contentRoot)
  cache.set(key, bundle)
  persistSeedInventory(contentRoot, bundle)
}

export function peekSeedInventory(contentRoot: string): SeedInventoryBundle | null {
  const key = keyFor(contentRoot)
  let bundle = cache.get(key) ?? null
  if (!bundle) {
    bundle = readPersistedSeedInventory(contentRoot)
    if (bundle) cache.set(key, bundle)
  }
  if (!bundle) return null
  const seedStampNow = seedFileStamp(contentRoot)
  if (bundle.stamp === seedStampNow) {
    const progressStampNow = seedProgressStamp(contentRoot)
    if (bundle.progressStamp !== progressStampNow) {
      bundle = reconcileSeedInventory(bundle, contentRoot)
      cache.set(key, bundle)
      persistSeedInventory(contentRoot, bundle)
    }
  }
  return bundle
}

export function invalidateSeedInventory(contentRoot: string) {
  cache.delete(keyFor(contentRoot))
  try {
    const file = seedInventoryFile(contentRoot)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {
    /* non-fatal */
  }
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

export function prepareSeedInventory(contentRoot: string, options?: { force?: boolean }): Promise<SeedInventoryBundle> {
  const key = keyFor(contentRoot)
  return singleFlight(flights, key, async () => {
    await yieldEventLoop()
    if (!options?.force) {
      const peeked = peekSeedInventory(contentRoot)
      if (peeked && peeked.stamp === seedFileStamp(contentRoot) && peeked.progressStamp === seedProgressStamp(contentRoot)) {
        return peeked
      }
    }
    let bundle: SeedInventoryBundle
    try {
      bundle = await runSeedInventoryWorker(contentRoot)
    } catch (_err) {
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
    persistSeedInventory(contentRoot, bundle)
    return bundle
  })
}

export function resetSeedPrepareForTests() {
  flights.clear()
  cache.clear()
}
