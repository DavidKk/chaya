/** A continuous job: cache scanning and engine slots share task ownership, never a batch barrier. */
import { engineAcceptsSensitive, type TranslateRunEngine, translationFallbackOrder } from '@/lib/translate/engines'
import type { SentencePlan } from '@/lib/translate/sentence-plan'

import { getTranslateEngineSwitches } from '../engine-switches'
import type { FillMissingResult, SeedFillOptions } from '../fill-missing'
import { gameTranslationFiles } from '../game-records'
import { type LiveTranslateItem, liveTranslateTexts } from '../live-translate'
import { isSensitiveForCloud } from '../sensitive-text'
import { openSharedCache } from '../shared-cache'
import { charCount } from '../text-classify'
import { type CacheLane, startCacheLane } from './cache-lane'
import type { CacheScanResult } from './cache-scan'
import { engineCapacity } from './engine-capacity'
import { readSeedInventory, seedFileStamp } from './seed-inventory'

const UNKNOWN = 0,
  MISS = 1,
  RUNNING = 2,
  DONE = 3,
  FAILED = 4,
  WAIT_CACHE = 5
const MAX_BUFFER = 64

type Attempt = { order: TranslateRunEngine[]; next: number; tried: Set<TranslateRunEngine>; errors: string[] }
type Active = { engine: TranslateRunEngine; controller: AbortController; work: Promise<void> }
type Completed = { item: LiveTranslateItem; cacheMs: number }

export function createScheduledSeedSession(contentRoot: string, initialTrace?: (message: string) => void) {
  let inventory = readSeedInventory(contentRoot)
  let progress = { ...inventory.progress }
  let states = new Uint8Array(inventory.pending.length)
  let scanCursor = 0,
    generation = 0
  let cacheSeen = new Uint8Array(states.length)
  let cacheAvailable = true
  let dispatchedSinceYield = 0
  let pumpTimer: ReturnType<typeof setImmediate> | undefined
  const waitingCache = new Map<number, LiveTranslateItem>()
  let pendingCount = states.length
  let pendingCacheMs = 0
  let processed = 0
  const misses: number[] = []
  const freshCursors = new Map<TranslateRunEngine, number>()
  const deferred = new Map<TranslateRunEngine, Set<number>>()
  let sensitiveFlags = new Uint8Array(states.length)
  let started = false,
    paused = false,
    closed = false
  let options: SeedFillOptions = {}
  let engines: TranslateRunEngine[] = []
  let store: ReturnType<typeof openSharedCache> | undefined
  let cacheLane: CacheLane | undefined
  let resolveWait: (() => void) | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const active = new Map<number, Active>()
  const retries = new Map<number, Attempt>()
  const ready = new Map<number, CacheScanResult>()
  const completed: Completed[] = []
  const counters = { cacheHit: 0, cacheMiss: 0, cachePartial: 0, cacheBypassed: 0, cacheCancelled: 0, engineSubmitted: 0, duplicateInFlight: 0 }
  const trace = (message: string) => (options.onTrace || initialTrace)?.(message)
  const cache = () => (store ??= openSharedCache())
  const notify = () => resolveWait?.()
  const cap = () => Math.min(40, Math.max(1, options.limit || 12))

  function finish(id: number, item: LiveTranslateItem, cacheMs = 0) {
    if (closed || states[id] === DONE || states[id] === FAILED) return
    pendingCount--
    const success = item.zh != null && !item.error && item.status !== 'partial'
    states[id] = success ? DONE : FAILED
    retries.delete(id)
    ready.delete(id)
    waitingCache.delete(id)
    if (success) {
      processed++
      const chars = charCount(item.src)
      progress.done++
      progress.missing--
      progress.doneChars += chars
      progress.missingChars -= chars
    }
    progress.batchesLeft = Math.ceil(progress.missing / cap())
    completed.push({ item, cacheMs })
    if (completed.length >= cap() || (!active.size && !hasPending())) notify()
    else if (!flushTimer)
      flushTimer = setTimeout(() => {
        flushTimer = undefined
        notify()
      }, 250)
  }

  function failOrWait(id: number, item: LiveTranslateItem) {
    if (!paused && cacheAvailable && !cacheSeen[id] && waitingCache.size < MAX_BUFFER) {
      states[id] = WAIT_CACHE
      waitingCache.set(id, item)
    } else finish(id, item)
  }

  function cacheFailed(error: string) {
    cacheAvailable = false
    trace(`Cache scan unavailable: ${error}`)
    for (const [id, item] of waitingCache) finish(id, item)
    notify()
  }

  function valid(result: CacheScanResult): boolean {
    try {
      if (gameTranslationFiles(contentRoot).stamp !== result.stamp) return false
      const shared = cache()
      return shared.version() === result.plan.corpusVersion && shared.current(result.plan.matches.filter((m) => !m.record.local).map((m) => m.record))
    } catch (error) {
      trace(`Cache result rejected: reason=${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function onCache(result: CacheScanResult) {
    pendingCacheMs += result.elapsedMs
    const id = result.id
    if (paused || closed || result.src !== inventory.pending[id] || states[id] === DONE || states[id] === FAILED) return
    cacheSeen[id] = 1
    if (result.plan.status === 'full' && result.plan.zh != null && valid(result)) {
      counters.cacheHit++
      if (result.records?.length) cache().queueBackfill(contentRoot, result.records)
      finish(id, { src: result.src, zh: result.plan.zh, status: 'full', engine: 'cache:scan', plan: result.plan }, result.elapsedMs)
      if (active.has(id)) {
        counters.cacheCancelled++
        active.get(id)!.controller.abort(new Error('A valid cache result completed this translation task'))
      }
    } else if (waitingCache.has(id)) {
      finish(id, waitingCache.get(id)!)
    } else if (states[id] !== RUNNING) {
      if (result.plan.status === 'miss' || result.plan.status === 'partial') {
        states[id] = MISS
        if (result.plan.status === 'partial') counters.cachePartial++
        else if (!result.plan.limited) counters.cacheMiss++
        if (misses.length < 2048) misses.push(id)
      }
      if (result.plan.status === 'partial' && !result.plan.limited && ready.size < 128) ready.set(id, result)
    }
    pump()
  }

  function hasPending() {
    return pendingCount > 0
  }

  function sensitive(id: number): boolean {
    if (!sensitiveFlags[id]) sensitiveFlags[id] = isSensitiveForCloud(inventory.pending[id]) ? 2 : 1
    return sensitiveFlags[id] === 2
  }
  function canFit(id: number) {
    if (!active.size) return true
    const chars = [...active.keys()].reduce((sum, key) => sum + inventory.pending[key].length, 0)
    return chars + inventory.pending[id].length <= (options.maxChars || 3000)
  }
  function nextTask(engine: TranslateRunEngine): number | undefined {
    for (let i = 0; retries.size < MAX_BUFFER && i < misses.length;) {
      const id = misses[i]
      if (states[id] !== MISS || retries.has(id)) {
        misses.splice(i, 1)
        continue
      }
      if (options.exclude?.has(inventory.pending[id])) {
        states[id] = FAILED
        pendingCount--
        misses.splice(i, 1)
        continue
      }
      if (canFit(id) && (!sensitive(id) || engineAcceptsSensitive(engine))) {
        misses.splice(i, 1)
        return id
      }
      i++
    }
    // Each engine visits the source array once; never rescan the full job for each empty slot.
    const delayed = deferred.get(engine) || new Set<number>()
    deferred.set(engine, delayed)
    if (retries.size < MAX_BUFFER) {
      for (const id of delayed) {
        if (options.exclude?.has(inventory.pending[id])) {
          if (states[id] === UNKNOWN || states[id] === MISS) {
            states[id] = FAILED
            pendingCount--
          }
          delayed.delete(id)
          continue
        }
        if ((states[id] !== UNKNOWN && states[id] !== MISS) || retries.has(id)) {
          delayed.delete(id)
          continue
        }
        if (canFit(id)) {
          delayed.delete(id)
          return id
        }
      }
      let cursor = freshCursors.get(engine) || 0
      while (cursor < states.length && delayed.size < 64) {
        const id = cursor++
        freshCursors.set(engine, cursor)
        if ((states[id] !== UNKNOWN && states[id] !== MISS) || retries.has(id)) continue
        if (options.exclude?.has(inventory.pending[id])) {
          states[id] = FAILED
          pendingCount--
          continue
        }
        if (sensitive(id) && !engineAcceptsSensitive(engine)) continue
        if (!canFit(id)) {
          delayed.add(id)
          continue
        }
        return id
      }
    }
    // A failed item joins this engine's tail, behind fresh work already available.
    for (const [id, attempt] of retries) {
      if (states[id] === MISS && attempt.order[attempt.next] === engine && canFit(id)) return id
    }
    return undefined
  }

  function refreshAttempt(attempt: Attempt, id: number) {
    const candidates = [...attempt.order, ...engines.filter((engine) => !attempt.order.includes(engine))]
    attempt.order = translationFallbackOrder(
      candidates.filter((engine) => engines.includes(engine) && !attempt.tried.has(engine) && (!sensitive(id) || engineAcceptsSensitive(engine)))
    )
    attempt.next = 0
  }

  function dispatch(id: number, engine: TranslateRunEngine) {
    dispatchedSinceYield++
    const src = inventory.pending[id]
    const prepared = ready.get(id)
    ready.delete(id)
    const plan: SentencePlan | undefined = prepared && valid(prepared) ? prepared.plan : undefined
    if (plan && prepared?.records?.length) cache().queueBackfill(contentRoot, prepared.records)
    const attempt = retries.get(id) || {
      order: translationFallbackOrder([engine, ...engines.filter((value) => value !== engine && (!sensitive(id) || engineAcceptsSensitive(value)))]),
      next: 0,
      tried: new Set<TranslateRunEngine>(),
      errors: [],
    }
    retries.set(id, attempt)
    states[id] = RUNNING
    const controller = new AbortController()
    const ownGeneration = generation
    if (!plan) counters.cacheBypassed++
    // Defer completion until the active entry exists, even for synchronous adapter failures.
    const work = Promise.resolve().then(async () => {
      try {
        const result = await liveTranslateTexts([src], {
          contentRoot,
          engines: [engine],
          sharedCache: cache,
          cacheMode: plan ? undefined : 'bypass',
          preparedPlan: plan,
          local: { signal: controller.signal },
          itemTimeoutMs: 15000,
          onTrace: trace,
          onEngineDispatch: () => {
            counters.engineSubmitted++
          },
          onDuplicateInFlight: () => {
            counters.duplicateInFlight++
          },
        })
        if (closed || ownGeneration !== generation || states[id] === DONE) return
        const item = result.items[0] || { src, zh: null, error: 'No translation result returned' }
        if (item.zh != null && !item.error && item.status !== 'partial') finish(id, item)
        else {
          attempt.errors.push(item.error || 'Translation failed')
          attempt.tried.add(engine)
          refreshAttempt(attempt, id)
          retries.delete(id)
          retries.set(id, attempt)
          if (!paused && attempt.next < attempt.order.length) states[id] = MISS
          else failOrWait(id, { src, zh: null, error: attempt.errors.join('; ') })
        }
      } catch (error) {
        if (!closed && ownGeneration === generation && states[id] !== DONE) {
          attempt.errors.push(error instanceof Error ? error.message : String(error))
          attempt.tried.add(engine)
          refreshAttempt(attempt, id)
          retries.delete(id)
          retries.set(id, attempt)
          if (!paused && attempt.next < attempt.order.length) states[id] = MISS
          else failOrWait(id, { src, zh: null, error: attempt.errors.join('; ') })
        }
      } finally {
        active.delete(id)
        if (!closed && ownGeneration === generation) {
          pump()
          if (!active.size) notify()
        }
      }
    })
    active.set(id, { engine, controller, work })
  }

  function pump() {
    if (paused || closed || !started || pumpTimer) return
    if (dispatchedSinceYield >= 32) {
      dispatchedSinceYield = 0
      pumpTimer = setImmediate(() => {
        pumpTimer = undefined
        pump()
      })
      return
    }
    while (active.size < cap() && completed.length + active.size < MAX_BUFFER) {
      let dispatched = false
      for (const engine of engines) {
        if (active.size >= cap()) break
        const count = [...active.values()].filter((entry) => entry.engine === engine).length
        if (count >= engineCapacity(engine)) continue
        const id = nextTask(engine)
        if (id === undefined) continue
        dispatch(id, engine)
        dispatched = true
      }
      if (!dispatched) break
    }
    // Texts with no eligible engine must not leave fill waiting forever.
    if (!active.size) {
      for (let id = 0; id < states.length && completed.length < MAX_BUFFER; id++) {
        if (
          (states[id] === UNKNOWN || states[id] === MISS) &&
          !options.exclude?.has(inventory.pending[id]) &&
          !engines.some((engine) => !sensitive(id) || engineAcceptsSensitive(engine))
        ) {
          failOrWait(id, { src: inventory.pending[id], zh: null, error: 'No eligible translation engines are enabled' })
        }
      }
      if (completed.length || !hasPending()) notify()
    }
  }

  function start() {
    if (started) return
    started = true
    engines = getTranslateEngineSwitches(contentRoot).enabled
    try {
      cacheLane = startCacheLane({
        contentRoot,
        onResult: onCache,
        onError: cacheFailed,
        next: () => {
          if (paused || closed) return []
          if (completed.length >= MAX_BUFFER) return null
          const tasks: Array<{ id: number; src: string }> = []
          while (scanCursor < states.length && tasks.length < 32) {
            const id = scanCursor++
            if (states[id] !== DONE && states[id] !== FAILED) tasks.push({ id, src: inventory.pending[id] })
          }
          return tasks
        },
      })
    } catch (error) {
      cacheFailed(error instanceof Error ? error.message : String(error))
    }
    pump()
  }

  async function drain() {
    paused = true
    for (const [id, item] of waitingCache) finish(id, item)
    await cacheLane?.close()
    await Promise.allSettled([...active.values()].map((entry) => entry.work))
    if (flushTimer) clearTimeout(flushTimer)
    if (pumpTimer) clearImmediate(pumpTimer)
    pumpTimer = undefined
    flushTimer = undefined
  }

  return {
    get progress() {
      return { ...progress }
    },
    get processed() {
      return processed
    },
    pause() {
      paused = true
      for (const [id, item] of waitingCache) finish(id, item)
      void cacheLane?.close()
      notify()
    },
    async close() {
      await drain()
      closed = true
      generation++
      try {
        store?.flushBackfill(contentRoot)
      } finally {
        store?.close()
        store = undefined
      }
    },
    async fill(opts: SeedFillOptions = {}): Promise<FillMissingResult> {
      if (closed) throw new Error('Translation session is closed')
      if (inventory.stamp !== seedFileStamp(contentRoot)) {
        await drain()
        generation++
        inventory = readSeedInventory(contentRoot)
        progress = { ...inventory.progress }
        states = new Uint8Array(inventory.pending.length)
        scanCursor = 0
        freshCursors.clear()
        deferred.clear()
        sensitiveFlags = new Uint8Array(states.length)
        pendingCount = states.length
        cacheSeen = new Uint8Array(states.length)
        cacheAvailable = true
        dispatchedSinceYield = 0
        waitingCache.clear()
        pendingCacheMs = 0
        misses.length = 0
        retries.clear()
        ready.clear()
        completed.length = 0
        started = paused = false
      }
      engines = getTranslateEngineSwitches(contentRoot).enabled
      for (const entry of active.values()) if (!engines.includes(entry.engine)) entry.controller.abort(new Error('Translation engine was disabled'))
      for (const [id, attempt] of retries) {
        if (states[id] !== MISS && states[id] !== WAIT_CACHE) continue
        refreshAttempt(attempt, id)
        if (attempt.order.length) {
          states[id] = MISS
          waitingCache.delete(id)
        } else failOrWait(id, { src: inventory.pending[id], zh: null, error: attempt.errors.join('; ') || 'No eligible translation engines remain enabled' })
      }
      options = opts
      progress.batchSize = cap()
      const elapsed = performance.now()
      start()
      const selected: Completed[] = []
      while (selected.length < cap()) {
        while (completed.length && selected.length < cap()) {
          const entry = completed.shift()!
          selected.push(entry)
          opts.onItem?.(entry.item)
        }
        cacheLane?.wake()
        pump()
        if (selected.length >= cap() || (!active.size && (paused || !hasPending())) || (selected.length && performance.now() - elapsed >= 5000)) break
        await new Promise<void>((resolve) => {
          resolveWait = resolve
        })
        resolveWait = undefined
        if (selected.length || completed.length) {
          while (completed.length && selected.length < cap()) {
            const entry = completed.shift()!
            selected.push(entry)
            opts.onItem?.(entry.item)
          }
          break
        }
      }
      const items = selected.map((entry) => entry.item)
      const unresolved = items.filter((item) => item.zh == null || item.error || item.status === 'partial').map((item) => item.src)
      store?.flushBackfill(contentRoot)
      const cacheMs = pendingCacheMs
      pendingCacheMs = 0
      trace(
        `Scheduler progress: ${Object.entries(counters)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')}, active=${active.size}`
      )
      return {
        ...progress,
        pendingResults: completed.length,
        scanned: items.length,
        translated: items.length - unresolved.length,
        failed: unresolved.length,
        unresolved,
        items,
        performance: { completedChars: items.filter((item) => !unresolved.includes(item.src)).reduce((sum, item) => sum + charCount(item.src), 0), cacheMs },
      }
    },
  }
}
