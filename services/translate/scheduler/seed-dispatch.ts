import type { TranslateAgentEntry, TranslateEngineState, TranslateRunEngine } from '@/lib/translate/engines'
import { engineAcceptsSensitive, resolveEngineCapacitySettings, translationFallbackOrder } from '@/lib/translate/engines'
import type { SentencePlan } from '@/lib/translate/sentence-plan'

import type { AgentBatchScope } from '../agent-translate'
import type { LiveTranslateItem } from '../live-translate'
import { liveTranslateTexts } from '../live-translate'
import { openSharedCache } from '../shared-cache'
import type { IndexedRecord } from '../shared-cache/match-index'
import { charCount } from '../text-classify'
import type { CacheScanResult } from './cache-scan'
import { engineConfiguredCapacity } from './engine-capacity'
import { seedEngineBudget } from './seed-engine-budget'
import { DONE, MISS, RECHECK, RUNNING } from './seed-engine-queue'

export type SeedAttempt = {
  order: TranslateRunEngine[]
  next: number
  tried: Set<TranslateRunEngine>
  errors: string[]
  engineWork?: boolean
  interrupted?: boolean
}

type SeedDispatchDeps = {
  contentRoot: string
  pending: () => string[]
  states: Uint8Array
  loads: Map<TranslateRunEngine, { items: number; chars: number }>
  ready: Map<number, CacheScanResult>
  retries: Map<number, SeedAttempt>
  active: Map<number, { engine: TranslateRunEngine; controller: AbortController; work: Promise<void> }>
  completedCount: () => number
  engines: () => TranslateRunEngine[]
  agents: () => TranslateAgentEntry[]
  configs: () => TranslateEngineState['configs'] | undefined
  cache: () => ReturnType<typeof openSharedCache>
  batchScope: AgentBatchScope
  counters: { cacheBypassed: number; engineSubmitted: number; duplicateInFlight: number }
  submittedEngines: Set<TranslateRunEngine>
  generation: () => number
  closed: () => boolean
  paused: () => boolean
  cap: () => number
  maxBuffer: () => number
  trace: (message: string) => void
  nextTask: (engine: TranslateRunEngine) => number | undefined
  valid: (result: CacheScanResult) => boolean
  rememberBackfill: (records: IndexedRecord[] | undefined) => void
  finish: (id: number, item: LiveTranslateItem) => void
  failOrWait: (id: number, item: LiveTranslateItem) => void
  refreshAttempt: (attempt: SeedAttempt, id: number) => void
  sensitive: (id: number) => boolean
  pump: () => void
  notify: () => void
  addYield: (count: number) => void
}

/** Claim the lines already waiting and translate them as one Apple segment. */
export function createSeedDispatcher(deps: SeedDispatchDeps) {
  function noteLoad(current: number, engine: TranslateRunEngine) {
    const load = deps.loads.get(engine) || { items: 0, chars: 0 }
    load.items++
    load.chars += charCount(deps.pending()[current])
    deps.loads.set(engine, load)
  }

  function takeAppleSegment(first: number): number[] {
    const ids = [first]
    noteLoad(first, 'apple')
    deps.states[first] = RUNNING
    const budget = seedEngineBudget('apple', deps.agents(), deps.configs())
    const slots = budget?.items ?? engineConfiguredCapacity('apple', resolveEngineCapacitySettings('apple', deps.configs(), deps.agents()))
    while (ids.length < 40) {
      const load = deps.loads.get('apple')
      if ((load?.items || 0) >= slots || (load?.chars || 0) >= 40_000) break
      const next = deps.nextTask('apple')
      if (next === undefined) break
      ids.push(next)
      noteLoad(next, 'apple')
      deps.states[next] = RUNNING
    }
    return ids
  }

  function dispatch(id: number, engine: TranslateRunEngine) {
    const ids = engine === 'apple' ? takeAppleSegment(id) : [id]
    if (engine !== 'apple') noteLoad(id, engine)
    deps.addYield(ids.length)
    const plans = ids.map((current) => {
      const prepared = deps.ready.get(current)
      deps.ready.delete(current)
      const plan: SentencePlan | undefined = prepared && deps.valid(prepared) ? prepared.plan : undefined
      if (plan) deps.rememberBackfill(prepared?.records)
      return plan
    })
    const engines = deps.engines()
    for (let index = 0; index < ids.length; index++) {
      const current = ids[index]
      const attempt: SeedAttempt = deps.retries.get(current) || {
        order: translationFallbackOrder([engine, ...engines.filter((value) => value !== engine && (!deps.sensitive(current) || engineAcceptsSensitive(value)))]),
        next: 0,
        tried: new Set<TranslateRunEngine>(),
        errors: [],
      }
      deps.retries.set(current, attempt)
      deps.states[current] = RUNNING
      if (!plans[index]) deps.counters.cacheBypassed++
    }
    const controller = new AbortController()
    const ownGeneration = deps.generation()
    const singlePlan = ids.length === 1 ? plans[0] : undefined
    const released = new Set<number>()
    const work = Promise.resolve().then(async () => {
      const settle = (current: number, item: LiveTranslateItem) => {
        if (deps.closed() || deps.generation() !== ownGeneration || deps.states[current] === DONE || deps.states[current] === RECHECK) return
        const attempt = deps.retries.get(current)
        if (!attempt) return
        attempt.engineWork ||= item.engineWork
        if (item.zh != null && !item.error && item.status !== 'partial') deps.finish(current, item)
        else {
          attempt.errors.push(item.error || 'Translation failed')
          attempt.tried.add(engine)
          deps.refreshAttempt(attempt, current)
          deps.retries.delete(current)
          deps.retries.set(current, attempt)
          if (!deps.paused() && attempt.next < attempt.order.length) deps.states[current] = MISS
          else deps.failOrWait(current, { src: deps.pending()[current], zh: null, error: attempt.errors.join('; ') })
        }
      }
      // One slow or failed line must not keep the rest of the segment's slots.
      const release = (current: number) => {
        if (released.has(current)) return
        released.add(current)
        deps.active.delete(current)
        const load = deps.loads.get(engine)
        if (load) {
          load.items = Math.max(0, load.items - 1)
          load.chars = Math.max(0, load.chars - charCount(deps.pending()[current]))
        }
      }
      const settleSrc = (src: string, item: LiveTranslateItem) => {
        let changed = false
        for (const current of ids) {
          if (released.has(current) || deps.pending()[current] !== src) continue
          settle(current, item)
          release(current)
          changed = true
        }
        if (changed && !deps.closed() && deps.generation() === ownGeneration) deps.pump()
      }
      try {
        const result = await liveTranslateTexts(
          ids.map((current) => deps.pending()[current]),
          {
            contentRoot: deps.contentRoot,
            engines: [engine],
            sharedCache: deps.cache,
            cacheMode: singlePlan ? undefined : 'bypass',
            preparedPlan: singlePlan,
            local: { signal: controller.signal, batchScope: deps.batchScope },
            itemTimeoutMs: engine.startsWith('agent:') ? 5 * 60 * 1000 : 15000,
            onTrace: deps.trace,
            onItem: (item) => {
              if (item.src) settleSrc(item.src, item)
            },
            onEngineDispatch: (actualEngine) => {
              for (const current of ids) {
                const attempt = deps.retries.get(current)
                if (attempt) attempt.engineWork = true
              }
              deps.counters.engineSubmitted++
              deps.submittedEngines.add(actualEngine)
            },
            onDuplicateInFlight: () => {
              for (const current of ids) {
                const attempt = deps.retries.get(current)
                if (attempt) attempt.engineWork = true
              }
              deps.counters.duplicateInFlight++
            },
          }
        )
        for (const current of ids) {
          if (released.has(current)) continue
          const src = deps.pending()[current]
          settleSrc(src, result.items.find((item) => item.src === src) || { src, zh: null, error: 'No translation result returned' })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        for (const current of ids) {
          if (released.has(current)) continue
          settleSrc(deps.pending()[current], { src: deps.pending()[current], zh: null, error: message })
        }
      } finally {
        for (const current of ids) release(current)
        if (!deps.closed() && deps.generation() === ownGeneration) {
          deps.pump()
          if (!deps.active.size) deps.notify()
        }
      }
    })
    for (const current of ids) deps.active.set(current, { engine, controller, work })
  }

  return { dispatch }
}
