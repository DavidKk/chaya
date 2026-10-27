/** A continuous job: cache scanning and engine slots share task ownership, never a batch barrier. */
import { randomUUID } from 'node:crypto'

import { detectCacheLang } from '@/lib/translate/cache-lang'
import { engineAcceptsSensitive, type TranslateAgentEntry, type TranslateRunEngine, translationFallbackOrder } from '@/lib/translate/engines'
import { isCacheResult } from '@/lib/translate/result-sources'
import type { SentencePlan } from '@/lib/translate/sentence-plan'

import type { AgentBatchScope } from '../agent-translate'
import { getTranslateEngineSwitches } from '../engine-switches'
import type { FillMissingResult, SeedFillOptions } from '../fill-missing'
import { getGameCacheContext } from '../game-cache-context'
import { gameTranslationFiles } from '../game-records'
import { type LiveTranslateItem, liveTranslateTexts } from '../live-translate'
import { recordSeedFailure } from '../seed-failures'
import { isSensitiveForCloud } from '../sensitive-text'
import { openSharedCache } from '../shared-cache'
import type { IndexedRecord } from '../shared-cache/match-index'
import { charCount } from '../text-classify'
import { type CacheLane, type CacheScanBatch, startCacheLane } from './cache-lane'
import type { CacheScanResult } from './cache-scan'
import { engineCapacity } from './engine-capacity'
import { followsOwnedStampChain } from './owned-stamps'
import { collectResultWindow, type Completed } from './result-window'
import { seedEngineBudget } from './seed-engine-budget'
import { DONE, FAILED, MISS, RECHECK, RUNNING, takeSeedEngineTask, UNKNOWN, WAIT_CACHE } from './seed-engine-queue'
import { readSeedInventory, seedFileStamp } from './seed-inventory'
import type { SeedInventoryBundle } from './seed-prepare'

const MAX_BUFFER = 64
const MAX_RECHECKS = 2
const MAX_CACHE_PENDING = 64
const CACHE_SHARD = 32
// A 32-item shard takes roughly 0.7s on a warm corpus. A shorter window makes
// cache hits race real engine submissions, defeating the cache-first path.
const CACHE_CLASSIFY_WINDOW_MS = 1_500
const CACHE_ADMISSION_TIMEOUT_MS = 1_500
const CACHE_STALL_FALLBACK_MS = 1_500

type Attempt = { order: TranslateRunEngine[]; next: number; tried: Set<TranslateRunEngine>; errors: string[]; engineWork?: boolean; interrupted?: boolean }
type Active = { engine: TranslateRunEngine; controller: AbortController; work: Promise<void> }

export { followsOwnedStampChain } from './owned-stamps'

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
  let agents: TranslateAgentEntry[] = []
  let store: ReturnType<typeof openSharedCache> | undefined
  let cacheLane: CacheLane | undefined
  let resolveWait: (() => void) | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let leaseId = ''
  const active = new Map<number, Active>()
  const loads = new Map<TranslateRunEngine, { items: number; chars: number }>()
  const retries = new Map<number, Attempt>()
  const ready = new Map<number, CacheScanResult>()
  const completed: Completed[] = []
  const ownedFileTransitions = new Map<string, string>()
  const pendingBackfill = new Map<string, IndexedRecord>()
  const pendingProjections = new Set<string>()
  const recheckQueue: number[] = []
  let recheckAttempts = new Uint8Array(states.length)
  // Cache-first window bookkeeping. `CACHE_PENDING` is represented as UNKNOWN with
  // enteredAt set; `cacheInFlight` is a task already handed to the worker awaiting a result.
  const cachePending = new Set<number>()
  const cacheInFlight = new Set<number>()
  let cacheEnteredAt = new Float64Array(states.length)
  let cacheDeadline = new Float64Array(states.length)
  let lastCacheProgressAt = 0
  const counters = {
    cacheHit: 0,
    cacheMiss: 0,
    cachePartial: 0,
    cacheBypassed: 0,
    cacheCancelled: 0,
    cacheRecheck: 0,
    cacheRecheckMiss: 0,
    cacheAdmissionTimeout: 0,
    cacheClassifyTimeout: 0,
    cacheScanError: 0,
    engineSubmitted: 0,
    duplicateInFlight: 0,
  }
  const trace = (message: string) => (options.onTrace || initialTrace)?.(message)
  const cache = () => (store ??= openSharedCache())
  const notify = () => resolveWait?.()
  const cap = () => Math.min(40, Math.max(1, options.limit || 12))
  const nowMs = () => performance.now()

  function cacheWorkExhausted(): boolean {
    return !paused && !closed && cacheAvailable && cachePending.size === 0 && cacheInFlight.size === 0 && recheckQueue.length === 0 && scanCursor >= states.length
  }

  function inCacheWindow(id: number): boolean {
    return cachePending.has(id) || cacheInFlight.has(id) || cacheEnteredAt[id] !== 0 || cacheDeadline[id] !== 0
  }

  function canEngineClaimUnknown(): boolean {
    if (cacheUnavailable) return true
    return cachePending.size >= MAX_CACHE_PENDING && nowMs() - lastCacheProgressAt > CACHE_STALL_FALLBACK_MS
  }

  function finish(id: number, item: LiveTranslateItem, cacheMs = 0) {
    if (closed || states[id] === DONE || states[id] === FAILED) return
    if (item.engine !== 'cache:scan' && retries.get(id)?.engineWork) item = { ...item, engineWork: true }
    pendingCount--
    const success = item.zh != null && !item.error && item.status !== 'partial'
    if (!success && !paused && item.engineWork && !retries.get(id)?.interrupted) recordSeedFailure(contentRoot, item, progress)
    states[id] = success ? DONE : FAILED
    retries.delete(id)
    ready.delete(id)
    waitingCache.delete(id)
    cachePending.delete(id)
    cacheInFlight.delete(id)
    cacheEnteredAt[id] = 0
    cacheDeadline[id] = 0
    if (success) {
      pendingProjections.add(item.src)
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

  function releaseToEngine(id: number, reason: 'admission' | 'classify' | 'stall') {
    // A deadline grants engine eligibility; it does not cancel independent
    // cache work. In particular, queued items must still reach the scanner.
    if (!cacheAvailable) {
      cachePending.delete(id)
      cacheInFlight.delete(id)
    }
    cacheEnteredAt[id] = 0
    cacheDeadline[id] = 0
    if (states[id] === UNKNOWN) states[id] = MISS
    if (reason === 'admission') counters.cacheAdmissionTimeout++
    else if (reason === 'classify') counters.cacheClassifyTimeout++
    if (states[id] === MISS && !misses.includes(id)) misses.push(id)
  }

  function cacheFailed(error: string) {
    cacheAvailable = false
    cacheUnavailable = true
    const soft = error === 'CACHE_WORKER_MISSING' || /chaya-cache-worker|Cache worker missing/i.test(error)
    trace(soft ? 'Cache scan unavailable: worker not built — continuing with engines only (run pnpm build:translate)' : `Cache scan unavailable: ${error}`)
    for (const [id, item] of waitingCache) finish(id, item)
    for (const id of [...cachePending]) releaseToEngine(id, 'stall')
    for (const id of [...cacheInFlight]) releaseToEngine(id, 'stall')
    releaseRechecks()
    notify()
  }

  function valid(result: CacheScanResult): boolean {
    try {
      const currentStamp = gameTranslationFiles(contentRoot).stamp
      if (currentStamp !== result.stamp && !followsOwnedStampChain(result.stamp, currentStamp, ownedFileTransitions)) return false
      if (getGameCacheContext(contentRoot).authorityVersion !== result.authorityVersion) return false
      const shared = cache()
      const dependencies = [...result.plan.matches.filter((m) => !m.record.local).map((m) => m.record), ...(result.records || [])]
      return shared.version() === result.plan.corpusVersion && shared.current(dependencies)
    } catch (error) {
      trace(`Cache result rejected: reason=${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function rememberOwnedTransition(before: string, after: string) {
    if (before === after) return
    if (ownedFileTransitions.size >= 256) ownedFileTransitions.delete(ownedFileTransitions.keys().next().value!)
    ownedFileTransitions.set(before, after)
  }

  function rememberBackfill(records: IndexedRecord[] | undefined) {
    for (const record of records || []) pendingBackfill.set(`${record.from}:${record.to}:${record.id}:${record.revision}`, record)
  }

  function flushBackfill() {
    if (!store && !pendingProjections.size) return
    const writer = cache()
    try {
      if (pendingProjections.size) {
        writer.queueGameProjections(
          contentRoot,
          [...pendingProjections].map((src) => ({ src, pair: { from: detectCacheLang(src), to: 'zh' } }))
        )
        pendingProjections.clear()
      }
      if (pendingBackfill.size) {
        writer.queueBackfill(contentRoot, [...pendingBackfill.values()])
        pendingBackfill.clear()
      }
    } catch (error) {
      trace(`Cache backfill queue failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const before = gameTranslationFiles(contentRoot).stamp
    let flushed: { sharedOnly?: boolean } | undefined
    try {
      flushed = writer.flushBackfill(contentRoot)
    } catch (error) {
      trace(`Cache backfill flush failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const after = gameTranslationFiles(contentRoot).stamp
    if (flushed?.sharedOnly) rememberOwnedTransition(before, after)
    if (flushed?.sharedOnly && before !== after && cacheLane) cacheLane.stampAdvance(leaseId, before, after)
  }

  function onResult(result: CacheScanResult) {
    pendingCacheMs += result.elapsedMs
    lastCacheProgressAt = nowMs()
    const id = result.id
    cacheInFlight.delete(id)
    cacheDeadline[id] = 0
    if (paused || closed || result.src !== inventory.pending[id] || states[id] === DONE || states[id] === FAILED) return
    cacheSeen[id] = 1
    if (result.plan.status === 'full' && result.plan.zh != null) {
      if (valid(result)) {
        counters.cacheHit++
        rememberBackfill(result.records)
        finish(id, { src: result.src, zh: result.plan.zh, status: 'full', engine: 'cache:scan', plan: result.plan }, result.elapsedMs)
        if (active.has(id)) {
          counters.cacheCancelled++
          active.get(id)!.controller.abort(new Error('A valid cache result completed this translation task'))
        }
      } else {
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
        misses.push(id)
      }
      if (result.plan.status === 'partial' && !result.plan.limited && ready.size < 128) ready.set(id, result)
    }
    pump()
    scheduleDeadlineTimer()
  }

  function onBatchDone() {
    lastCacheProgressAt = nowMs()
    pump()
    scheduleDeadlineTimer()
    notify()
  }

  function onItemError(id: number, _error: string) {
    lastCacheProgressAt = nowMs()
    cacheInFlight.delete(id)
    cacheDeadline[id] = 0
    if (paused || closed || states[id] === DONE || states[id] === FAILED) return
    counters.cacheScanError++
    cacheSeen[id] = 1
    // A per-item scan error must not be faked as a cache miss; bounded-degrade to engine.
    if (waitingCache.has(id)) finish(id, waitingCache.get(id)!)
    releaseToEngine(id, 'classify')
    pump()
    scheduleDeadlineTimer()
  }

  function onStampAdvanced(before: string, after: string, applied: boolean) {
    if (applied) rememberOwnedTransition(before, after)
  }

  function hasPending() {
    return pendingCount > 0
  }

  function sensitive(id: number): boolean {
    if (!sensitiveFlags[id]) sensitiveFlags[id] = isSensitiveForCloud(inventory.pending[id]) ? 2 : 1
    return sensitiveFlags[id] === 2
  }
  function canFit(id: number, engine: TranslateRunEngine) {
    const budget = seedEngineBudget(engine, agents)
    const entries = [...loads].filter(([key]) => (budget ? key === engine : !key.startsWith('agent:')))
    if (!entries.some(([, load]) => load.items)) return true
    const chars = entries.reduce((sum, [, load]) => sum + load.chars, 0)
    return chars + charCount(inventory.pending[id]) <= (budget?.chars ?? options.maxChars ?? 3000)
  }

  const batchScope: AgentBatchScope = {
    waitForMore: () =>
      !paused &&
      !closed &&
      cacheAvailable &&
      !cacheWorkExhausted() &&
      completed.length < MAX_BUFFER &&
      [...loads].filter(([engine]) => engine.startsWith('agent:')).every(([, load]) => load.items < 4096),
  }
  function nextTask(engine: TranslateRunEngine) {
    return takeSeedEngineTask(engine, {
      states,
      misses,
      retries,
      deferred,
      cursors: freshCursors,
      maxPending: seedEngineBudget(engine, agents) ? 4096 : MAX_BUFFER,
      excluded: (id) => Boolean(options.exclude?.has(inventory.pending[id])),
      exclude: (id) => {
        if (states[id] === UNKNOWN || states[id] === MISS) {
          states[id] = FAILED
          pendingCount--
        }
      },
      canFit: (id) => canFit(id, engine),
      sensitive,
      inCacheWindow,
      canClaimUnknown: canEngineClaimUnknown,
    })
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
    const sourceChars = charCount(src)
    const prepared = ready.get(id)
    ready.delete(id)
    const plan: SentencePlan | undefined = prepared && valid(prepared) ? prepared.plan : undefined
    if (plan) rememberBackfill(prepared?.records)
    const attempt: Attempt = retries.get(id) || {
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
    const work = Promise.resolve().then(async () => {
      try {
        const result = await liveTranslateTexts([src], {
          contentRoot,
          engines: [engine],
          sharedCache: cache,
          cacheMode: plan ? undefined : 'bypass',
          preparedPlan: plan,
          local: { signal: controller.signal, batchScope },
          itemTimeoutMs: engine.startsWith('agent:') ? 5 * 60 * 1000 : 15000,
          onTrace: trace,
          onEngineDispatch: (actualEngine) => {
            attempt.engineWork = true
            counters.engineSubmitted++
            submittedEngines.add(actualEngine)
          },
          onDuplicateInFlight: () => {
            attempt.engineWork = true
            counters.duplicateInFlight++
          },
        })
        if (closed || ownGeneration !== generation || states[id] === DONE || states[id] === RECHECK) return
        const item = result.items[0] || { src, zh: null, error: 'No translation result returned' }
        attempt.engineWork ||= item.engineWork
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
        const load = loads.get(engine)!
        load.items--
        load.chars -= sourceChars
        if (!closed && ownGeneration === generation) {
          pump()
          if (!active.size) notify()
        }
      }
    })
    active.set(id, { engine, controller, work })
    const load = loads.get(engine) || { items: 0, chars: 0 }
    load.items++
    load.chars += sourceChars
    loads.set(engine, load)
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
    while (completed.length < MAX_BUFFER) {
      let dispatched = false
      for (const engine of engines) {
        const budget = seedEngineBudget(engine, agents)
        const ordinary = [...loads].filter(([key]) => !key.startsWith('agent:')).reduce((sum, [, load]) => sum + load.items, 0)
        if (!budget && (ordinary >= cap() || completed.length + ordinary >= MAX_BUFFER)) continue
        const count = loads.get(engine)?.items || 0
        if (count >= (budget?.items ?? engineCapacity(engine))) continue
        const id = nextTask(engine)
        if (id === undefined) continue
        dispatch(id, engine)
        dispatched = true
      }
      if (!dispatched) break
      if (dispatchedSinceYield >= 32) {
        pump()
        break
      }
    }
    if (!active.size) {
      for (let id = 0; id < states.length && completed.length < MAX_BUFFER; id++) {
        if (
          (states[id] === UNKNOWN || states[id] === MISS) &&
          !inCacheWindow(id) &&
          !options.exclude?.has(inventory.pending[id]) &&
          !engines.some((engine) => !sensitive(id) || engineAcceptsSensitive(engine))
        ) {
          failOrWait(id, { src: inventory.pending[id], zh: null, error: 'No eligible translation engines are enabled' })
        }
      }
      if (completed.length || !hasPending()) notify()
    }
  }

  function releaseExpiredCache() {
    if (paused || closed) return
    const now = nowMs()
    for (const id of [...cachePending]) {
      if (cacheEnteredAt[id] !== 0 && now - cacheEnteredAt[id] >= CACHE_ADMISSION_TIMEOUT_MS) releaseToEngine(id, 'admission')
    }
    for (const id of [...cacheInFlight]) {
      if (cacheDeadline[id] !== 0 && now >= cacheDeadline[id]) releaseToEngine(id, 'classify')
    }
    pump()
    scheduleDeadlineTimer()
    notify()
  }

  function scheduleDeadlineTimer() {
    if (deadlineTimer || paused || closed) return
    const now = nowMs()
    let earliest = Infinity
    for (const id of cachePending) if (cacheEnteredAt[id] !== 0) earliest = Math.min(earliest, cacheEnteredAt[id] + CACHE_ADMISSION_TIMEOUT_MS)
    for (const id of cacheInFlight) if (cacheDeadline[id] !== 0) earliest = Math.min(earliest, cacheDeadline[id])
    if (!Number.isFinite(earliest)) return
    const delay = Math.max(0, earliest - now)
    deadlineTimer = setTimeout(() => {
      deadlineTimer = undefined
      releaseExpiredCache()
    }, delay)
    deadlineTimer.unref?.()
  }

  function cacheNext(): CacheScanBatch[] {
    if (paused || closed) return []
    if (completed.length >= MAX_BUFFER) return []
    // Top up the cache-first window from the stable cursor.
    while (cachePending.size < MAX_CACHE_PENDING && scanCursor < states.length) {
      const id = scanCursor++
      if (!cacheSeen[id] && states[id] !== DONE && states[id] !== FAILED && states[id] !== RECHECK && !options.exclude?.has(inventory.pending[id])) {
        cachePending.add(id)
        cacheEnteredAt[id] = nowMs()
      }
    }
    const tasks: CacheScanBatch[] = []
    while (recheckQueue.length && tasks.length < CACHE_SHARD) {
      const id = recheckQueue.shift()!
      if (states[id] === RECHECK) {
        cacheInFlight.add(id)
        cacheDeadline[id] = nowMs() + CACHE_CLASSIFY_WINDOW_MS
        tasks.push({ id, src: inventory.pending[id] })
      }
    }
    for (const id of [...cachePending]) {
      if (tasks.length >= CACHE_SHARD) break
      if (states[id] === DONE || states[id] === FAILED || cacheSeen[id]) {
        cachePending.delete(id)
        cacheEnteredAt[id] = 0
        continue
      }
      cachePending.delete(id)
      cacheEnteredAt[id] = 0
      cacheInFlight.add(id)
      cacheDeadline[id] = nowMs() + CACHE_CLASSIFY_WINDOW_MS
      tasks.push({ id, src: inventory.pending[id] })
    }
    scheduleDeadlineTimer()
    return tasks
  }

  function start() {
    paused = false
    if (started) return
    started = true
    if (!leaseId) leaseId = randomUUID()
    for (let id = 0; id < states.length; id++) {
      if (states[id] === RECHECK && !recheckQueue.includes(id)) recheckQueue.push(id)
    }
    engines = getTranslateEngineSwitches(contentRoot).enabled
    if (cacheAvailable && !cacheLane) {
      try {
        cacheLane = startCacheLane({
          contentRoot,
          next: cacheNext,
          onResult,
          onBatchDone,
          onItemError,
          onStampAdvanced,
          onError: cacheFailed,
        })
        cacheLane.setLease(leaseId)
      } catch (error) {
        cacheFailed(error instanceof Error ? error.message : String(error))
      }
    }
    lastCacheProgressAt = nowMs()
    cacheLane?.wake()
    scheduleDeadlineTimer()
    pump()
  }

  async function drain() {
    paused = true
    started = false
    if (deadlineTimer) clearTimeout(deadlineTimer)
    deadlineTimer = undefined
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
      if (deadlineTimer) clearTimeout(deadlineTimer)
      deadlineTimer = undefined
      for (const [id, item] of waitingCache) finish(id, item)
      // The old lease may still finish in the worker, but its results are no
      // longer owned by this session. Requeue those tasks for the next lease.
      for (const id of [...cacheInFlight]) {
        cacheInFlight.delete(id)
        cacheDeadline[id] = 0
        if (states[id] === RECHECK && !recheckQueue.includes(id)) recheckQueue.push(id)
        else if (!cacheSeen[id] && states[id] !== DONE && states[id] !== FAILED) {
          cachePending.add(id)
          cacheEnteredAt[id] = nowMs()
        }
      }
      // Release the session lease but keep the long-lived worker for reuse.
      leaseId = ''
      cacheLane?.setLease('')
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
        cachePending.clear()
        cacheInFlight.clear()
        pendingBackfill.clear()
        cacheEnteredAt = new Float64Array(states.length)
        cacheDeadline = new Float64Array(states.length)
        lastCacheProgressAt = 0
        started = paused = false
        leaseId = ''
      }
      const switches = getTranslateEngineSwitches(contentRoot)
      engines = switches.enabled
      agents = switches.agents || []
      for (const [id, entry] of active)
        if (!engines.includes(entry.engine)) {
          const attempt = retries.get(id)
          if (attempt) attempt.interrupted = true
          entry.controller.abort(new Error('Translation engine was disabled'))
        }
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
      start()
      const window = await collectResultWindow(completed, {
        limit: cap(),
        onItem: opts.onItem,
        wake: () => cacheLane?.wake(),
        pump,
        cacheWorkExhausted,
        terminal: () => !active.size && (paused || !hasPending()),
        flush: () => paused || closed || !cacheAvailable,
        notify,
        wait: async () => {
          await new Promise<void>((resolve) => {
            resolveWait = resolve
          })
          resolveWait = undefined
        },
      })
      const { selected } = window
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
        cacheOnly: window.cacheOnly(),
        windowReason: window.reason,
        submittedEngines: submitted,
        cacheUnavailable: unavailable,
        performance: {
          completedChars: items.filter((item) => !unresolved.includes(item.src) && !isCacheResult(item)).reduce((sum, item) => sum + charCount(item.src), 0),
          cacheMs,
        },
      }
    },
  }
}
