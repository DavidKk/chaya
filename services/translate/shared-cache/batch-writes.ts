import { startOperation, type TimedOperation } from '@/services/log/operation'

import type { openSharedCache } from './index'
import type { CacheWriteOpts, CacheWriteResult } from './write-pairs'

type Store = ReturnType<typeof openSharedCache>
type Pending = {
  pairs: Array<[string, string]>
  resolve: (result: CacheWriteResult) => void
  reject: (error: unknown) => void
}
type Batch = {
  items: Pending[]
  sources: Set<string>
  timer: ReturnType<typeof setTimeout>
  timing: TimedOperation
}
const writers = new WeakMap<Store, Map<string, Batch>>()

/** Coalesce completed seed results without waiting for slower engine requests. */
export function writeTranslationBatch(store: Store, pairs: Array<[string, string]>, engine: string, opts: CacheWriteOpts, contentRoot?: string): Promise<CacheWriteResult> {
  const batches = writers.get(store) ?? new Map<string, Batch>()
  writers.set(store, batches)
  const key = JSON.stringify([engine, opts.from, opts.to, opts.category, contentRoot])
  const flush = () => {
    const batch = batches.get(key)
    if (!batch) return
    batches.delete(key)
    clearTimeout(batch.timer)
    const started = performance.now()
    const queueMs = batch.timing.elapsedMs()
    try {
      const submitted = batch.items.flatMap((item) => item.pairs)
      const result = batch.timing.run(() => {
        const written = store.writeMany(submitted, engine, opts)
        if (contentRoot && written.records.length) store.queueBackfill(contentRoot, written.records)
        return written
      })
      for (const item of batch.items) {
        const sources = new Set(item.pairs.map(([src]) => src))
        item.resolve({
          accepted: result.accepted.filter(([src]) => sources.has(src)),
          records: result.records.filter((record) => sources.has(record.src)),
          rejected: result.rejected.filter((record) => sources.has(record.src)),
        })
      }
      batch.timing.end('completed', {
        engine,
        resultItems: batch.items.length,
        pairs: submitted.length,
        sourceChars: submitted.reduce((sum, [src]) => sum + Array.from(src).length, 0),
        accepted: result.accepted.length,
        rejected: result.rejected.length,
        queueMs,
        writeMs: Math.round((performance.now() - started) * 10) / 10,
      })
    } catch (error) {
      batch.timing.fail(error, { queueMs, writeMs: Math.round((performance.now() - started) * 10) / 10 })
      for (const item of batch.items) item.reject(error)
    }
  }
  // Overlapping keys need separate results so callers receive their own write outcome.
  if (pairs.some(([src]) => batches.get(key)?.sources.has(src))) flush()
  return new Promise((resolve, reject) => {
    let batch = batches.get(key)
    if (!batch) {
      batch = { items: [], sources: new Set(), timer: setTimeout(flush, 20), timing: startOperation('translate', 'translation.results.persist', { engine }, { start: false }) }
      batches.set(key, batch)
    }
    batch.items.push({ pairs, resolve, reject })
    for (const [src] of pairs) batch.sources.add(src)
    if (batch.sources.size >= 64) flush()
  })
}
