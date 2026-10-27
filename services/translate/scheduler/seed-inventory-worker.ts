/**
 * Bundled worker: seed inventory off the Next.js main thread.
 * Writes progress+pending to a temp file and posts only the path (no large clone).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

import { openSharedCache } from '../shared-cache'
import { readSeedInventory } from './seed-inventory'

try {
  const contentRoot = String((workerData as { contentRoot?: string })?.contentRoot || '')
  if (!contentRoot) throw new Error('seed-inventory-worker: missing contentRoot')
  const cache = openSharedCache()
  try {
    cache.syncGameCache(contentRoot)
  } finally {
    cache.close()
  }
  const inv = readSeedInventory(contentRoot)
  const out = path.join(os.tmpdir(), `chaya-seed-inv-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(out, JSON.stringify(inv))
  parentPort?.postMessage({ ok: true as const, path: out, pending: inv.pending.length, total: inv.progress.total })
} catch (error) {
  parentPort?.postMessage({ ok: false as const, error: error instanceof Error ? error.message : String(error) })
}
