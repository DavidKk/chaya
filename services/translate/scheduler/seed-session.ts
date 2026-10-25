/** A continuous job: cache scanning and engine slots share task ownership, never a batch barrier. */
import { engineAcceptsSensitive, type TranslateRunEngine, translationFallbackOrder } from '@/lib/translate/engines'
import type { SentencePlan } from '@/lib/translate/sentence-plan'

import { getTranslateEngineSwitches } from '../engine-switches'
import type { FillMissingResult, SeedFillOptions } from '../fill-missing'
import { getGameCacheContext } from '../game-cache-context'
import { gameTranslationFiles } from '../game-records'
import { type LiveTranslateItem, liveTranslateTexts } from '../live-translate'
import { isSensitiveForCloud } from '../sensitive-text'
import { openSharedCache } from '../shared-cache'
import { charCount } from '../text-classify'
import { type CacheLane, startCacheLane } from './cache-lane'
import type { CacheScanResult } from './cache-scan'
import { engineCapacity } from './engine-capacity'
import { readSeedInventory, seedFileStamp } from './seed-inventory'
import type { SeedInventoryBundle } from './seed-prepare'

const UNKNOWN = 0,
  MISS = 1,
  RUNNING = 2,
  DONE = 3,
  FAILED = 4,
  WAIT_CACHE = 5,
  RECHECK = 6
const MAX_BUFFER = 64
const CACHE_RESULT_LIMIT = 40
const CACHE_RESULT_MAX_CHARS = 10_000
const MAX_RECHECKS = 2

type Attempt = { order: TranslateRunEngine[]; next: number; tried: Set<TranslateRunEngine>; errors: string[] }
type Active = { engine: TranslateRunEngine; controller: AbortController; work: Promise<void> }
type Completed = { item: LiveTranslateItem; cacheMs: number }

/** A stamp change may only be ignored when every edge came from this session's own append. */
export function followsOwnedStampChain(from: string, to: string, transitions: ReadonlyMap<string, string>): boolean {
  let current = from
  const seen = new Set<string>()
  while (current !== to) {
    if (seen.has(current)) return false
    seen.add(current)
    const next = transitions.get(current)
    if (!next) return false
    current = next
  }
  return true
}

export function createScheduledSeedSession(contentRoot: string, initialTrace?: (message: string) => void, opts?: { inventory?: SeedInventoryBundle }) {
  let inventory: SeedInventoryBundle = opts?.inventory ?? readSeedInventory(contentRoot)
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
  let submittedEngines = new Set<TranslateRunEngine>()
  let cacheUnavailable = false
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
  const ownedFileTransitions = new Map<string, string>()
  const recheckQueue: number[] = []
  let recheckAttempts = new Uint8Array(states.length)
  const counters = {
    cacheHit: 0,
    cacheMiss: 0,
    cachePartial: 0,
    cacheBypassed: 0,
    cacheCancelled: 0,
    cacheRecheck: 0,
    cacheRecheckMiss: 0,
    engineSubmitted: 0,
    duplicateInFlight: 0,
  }
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

  function releaseRechecks() {
    for (let id = 0; id < states.length; id++) {
      if (states[id] === RECHECK) {
        states[id] = MISS
        if (!misses.includes(id)) misses.push(id)
      }
    }
    recheckQueue.length = 0
  }

  function cacheFailed(error: string) {
    cacheAvailable = false
    cacheUnavailable = true
    // Missing worker is expected after a clean checkout until `pnpm build:translate`;
    // translation continues via enabled engines — do not surface a Node module stack.
    const soft = error === 'CACHE_WORKER_MISSING' || /chaya-cache-worker|Cache worker missing/i.test(error)
    trace(soft ? 'Cache scan unavailable: worker not built — continuing with engines only (run pnpm build:translate)' : `Cache scan unavailable: ${error}`)
    for (const [id, item] of waitingCache) finish(id, item)
    releaseRechecks()
    notify()
  }

  function valid(result: CacheScanResult): boolean {
    try {
      const currentStamp = gameTranslationFiles(contentRoot).stamp
      if (currentStamp !== result.stamp && !followsOwnedStampChain(result.stamp, currentStamp, ownedFileTransitions)) return false
      if (getGameCacheContext(contentRoot).authorityVersion !== result.authorityVersion) return false
      const shared = cache()
      return shared.version() === result.plan.corpusVersion && shared.current(result.plan.matches.filter((m) => !m.record.local).map((m) => m.record))
    } catch (error) {
      trace(`Cache result rejected: reason=${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function rememberOwnedTransition(before: string, after: string) {
    if (before === after) return
    // An evicted source deliberately falls back to a full recheck.
    if (ownedFileTransitions.size >= 256) ownedFileTransitions.delete(ownedFileTransitions.keys().next().value!)
    ownedFileTransitions.set(before, after)
  }

  function flushBackfill() {
    if (!store) return
    const before = gameTranslationFiles(contentRoot).stamp
    let flushed: { sharedOnly: boolean }
    try {
      flushed = store.flushBackfill(contentRoot)
    } catch (error) {
      trace(`Cache backfill flush failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const after = gameTranslationFiles(contentRoot).stamp
    if (flushed.sharedOnly) rememberOwnedTransition(before, after)
  }

  function onCache(result: CacheScanResult) {
    pendingCacheMs += result.elapsedMs
    const id = result.id
    if (paused || closed || result.src !== inventory.pending[id] || states[id] === DONE || states[id] === FAILED) return
    cacheSeen[id] = 1
    if (result.plan.status === 'full' && result.plan.zh != null) {
      if (valid(result)) {
        counters.cacheHit++
        if (result.records?.length) cache().queueBackfill(contentRoot, result.records)
        finish(id, { src: result.src, zh: result.plan.zh, status: 'full', engine: 'cache:scan', plan: result.plan }, result.elapsedMs)
        if (active.has(id)) {
          counters.cacheCancelled++
          active.get(id)!.controller.abort(new Error('A valid cache result completed this translation task'))
        }
      } else {
        // A stale full hit is not a miss. Keep it out of engine dispatch until
        // the cache lane has revalidated this item.
        counters.cacheRecheck++
        if (states[id] !== DONE && states[id] !== FAILED) {
          waitingCache.delete(id)
          ready.delete(id)
          retries.delete(id)
          states[id] = RECHECK
          if (recheckAttempts[id] < MAX_RECHECKS && !recheckQueue.includes(id)) {
            recheckAttempts[id]++
            recheckQueue.push(id)
          } else if (!recheckQueue.includes(id)) {
            // Bound repeated stale scans. The next engine pass is preferable to
            // leaving the item permanently outside both cache and engine work.
            retries.delete(id)
            states[id] = MISS
            if (!misses.includes(id)) misses.push(id)
          }
        }
        if (active.has(id)) active.get(id)!.controller.abort(new Error('Cache snapshot expired; rechecking before engine dispatch'))
      }
    } else if (waitingCache.has(id)) {
      finish(id, waitingCache.get(id)!)
    } else if (states[id] !== RUNNING) {
      if (states[id] === RECHECK && result.plan.status === 'miss') {
        counters.cacheRecheckMiss++
        const index = recheckQueue.indexOf(id)
        if (index >= 0) recheckQueue.splice(index, 1)
      }
      if (result.plan.status === 'miss' || result.plan.status === 'partial') {
        const index = recheckQueue.indexOf(id)
        if (index >= 0) recheckQueue.splice(index, 1)
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
            submittedEngines.add(engine)
          },
          onDuplicateInFlight: () => {
            counters.duplicateInFlight++
          },
        })
        if (closed || ownGeneration !== generation || states[id] === DONE || states[id] === RECHECK) return
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
        if (!closed && ownGeneration === generation && states[id] !== DONE && states[id] !== RECHECK) {
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
    paused = false
    if (started) return
    started = true
    for (let id = 0; id < states.length; id++) {
      if (states[id] === RECHECK && !recheckQueue.includes(id)) recheckQueue.push(id)
    }
    engines = getTranslateEngineSwitches(contentRoot).enabled
    if (cacheAvailable) {
      try {
        cacheLane = startCacheLane({
          contentRoot,
          onResult: onCache,
          onError: cacheFailed,
          next: () => {
            if (paused || closed) return []
            if (completed.length >= MAX_BUFFER) return null
            const tasks: Array<{ id: number; src: string }> = []
            while (recheckQueue.length && tasks.length < 32) {
              const id = recheckQueue.shift()!
              if (states[id] === RECHECK) tasks.push({ id, src: inventory.pending[id] })
            }
            while (scanCursor < states.length && tasks.length < 32) {
              const id = scanCursor++
              if (states[id] !== DONE && states[id] !== FAILED && states[id] !== RECHECK) tasks.push({ id, src: inventory.pending[id] })
            }
            return tasks
          },
        })
      } catch (error) {
        cacheFailed(error instanceof Error ? error.message : String(error))
      }
    }
    pump()
  }

  async function drain() {
    paused = true
    started = false
    for (const [id, item] of waitingCache) finish(id, item)
    await cacheLane?.close()
    cacheLane = undefined
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
      started = false
      for (const [id, item] of waitingCache) finish(id, item)
      void cacheLane?.close()
      cacheLane = undefined
      notify()
    },
    async close() {
      await drain()
      closed = true
      generation++
      try {
        flushBackfill()
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
        ownedFileTransitions.clear()
        recheckQueue.length = 0
        recheckAttempts = new Uint8Array(states.length)
        cacheAvailable = true
        cacheUnavailable = false
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
      let selectedChars = 0
      let selectedCache = 0
      const windowLimit = () => (selectedCache === selected.length ? CACHE_RESULT_LIMIT : cap())
      const canSelect = () => {
        if (!selected.length) return true
        if (selectedCache === selected.length) return selected.length < CACHE_RESULT_LIMIT
        return selected.length < cap()
      }
      const selectReady = () => {
        while (completed.length && canSelect()) {
          const entry = completed.shift()!
          const chars = charCount(entry.item.src)
          const isCache = entry.item.engine?.startsWith('cache:') === true
          if (selected.length && isCache && selectedCache === selected.length && selectedChars + chars > CACHE_RESULT_MAX_CHARS) {
            completed.unshift(entry)
            break
          }
          selected.push(entry)
          selectedChars += chars
          if (isCache) selectedCache++
          opts.onItem?.(entry.item)
        }
      }
      while (true) {
        selectReady()
        cacheLane?.wake()
        pump()
        selectReady()
        if (selected.length >= windowLimit() || (!active.size && (paused || !hasPending())) || (selected.length && performance.now() - elapsed >= 5000)) break
        await new Promise<void>((resolve) => {
          resolveWait = resolve
        })
        resolveWait = undefined
        if (selected.length || completed.length) {
          selectReady()
          break
        }
      }
      const items = selected.map((entry) => entry.item)
      const unresolved = items.filter((item) => item.zh == null || item.error || item.status === 'partial').map((item) => item.src)
      flushBackfill()
      const cacheMs = pendingCacheMs
      pendingCacheMs = 0
      const submitted = [...submittedEngines]
      submittedEngines = new Set()
      const unavailable = cacheUnavailable
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
        submittedEngines: submitted,
        cacheUnavailable: unavailable,
        performance: {
          // Exclude cache hits so the throughput estimate reflects live engine work, not near-instant lookups.
          completedChars: items.filter((item) => !unresolved.includes(item.src) && !item.engine?.startsWith('cache:')).reduce((sum, item) => sum + charCount(item.src), 0),
          cacheMs,
        },
      }
    },
  }
}
