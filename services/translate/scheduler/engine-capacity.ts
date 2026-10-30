/** Shared transport limits include abandoned requests until the adapter actually settles. */
import { type EngineCapacitySettings, engineGroup, type TranslateRunEngine } from '@/lib/translate/engines'
import { startOperation } from '@/services/log/operation'

export type CapacityRequestSettings = EngineCapacitySettings & {
  /** Character weight of this request; used with maxConcurrentChars. */
  chars?: number
}

export function engineCapacity(engine: TranslateRunEngine): number {
  return engineConfiguredCapacity(engine)
}

export function engineConfiguredCapacity(engine: TranslateRunEngine, customSettings?: EngineCapacitySettings): number {
  if (customSettings?.allowConcurrency === false) return 1
  if (typeof customSettings?.concurrencyLimit === 'number' && customSettings.concurrencyLimit > 0) {
    return Math.max(1, Math.min(40, Math.floor(customSettings.concurrencyLimit)))
  }
  if (engine === 'apple') return 40
  if (engine === 'bergamot' || engine === 'ollama') return 1
  return engineGroup(engine) === 'agent' ? 1 : 4
}

type Waiter = { run: () => void; cancel: () => void; chars: number; settings?: CapacityRequestSettings }
type Lane = { active: number; activeChars: number; queue: Set<Waiter> }
const globalLanes = globalThis as typeof globalThis & { __chayaTranslationCapacity?: Map<string, Lane> }
const lanes = (globalLanes.__chayaTranslationCapacity ??= new Map<string, Lane>())

function requestChars(settings?: CapacityRequestSettings) {
  const chars = settings?.chars
  return typeof chars === 'number' && Number.isFinite(chars) && chars > 0 ? Math.floor(chars) : 1
}

function canDispatch(lane: Lane, engine: TranslateRunEngine, waiter: Waiter) {
  // Character limits apply to each packed request, independently of transport concurrency.
  return lane.active < engineConfiguredCapacity(engine, waiter.settings)
}

export function withEngineCapacity<T>(
  engine: TranslateRunEngine,
  identity: string,
  work: () => Promise<T>,
  signal?: AbortSignal,
  customSettings?: CapacityRequestSettings
): Promise<T> {
  const lane = lanes.get(identity) || { active: 0, activeChars: 0, queue: new Set<Waiter>() }
  lanes.set(identity, lane)
  const chars = requestChars(customSettings)
  const timing = startOperation('translate', 'engine.capacity', { engine, lane: identity, sourceChars: chars, queued: lane.queue.size }, { start: false })
  return new Promise<T>((resolve, reject) => {
    let started = false
    let queueMs = 0
    let executing = 0
    const clear = () => signal?.removeEventListener('abort', waiter.cancel)
    const pump = () => {
      while (lane.queue.size) {
        const next = lane.queue.values().next().value!
        if (!canDispatch(lane, engine, next)) break
        next.run()
      }
      if (!lane.active && !lane.queue.size) lanes.delete(identity)
    }
    const waiter: Waiter = {
      chars,
      settings: customSettings,
      cancel: () => {
        if (started) return
        lane.queue.delete(waiter)
        clear()
        timing.end('cancelled', { phase: 'queued', queueMs: timing.elapsedMs(), executeMs: 0 })
        reject(signal?.reason || new Error('Translation request cancelled'))
        pump()
      },
      run: () => {
        lane.queue.delete(waiter)
        clear()
        if (signal?.aborted) {
          timing.end('cancelled', { phase: 'before-execution', queueMs: timing.elapsedMs(), executeMs: 0 })
          reject(signal.reason)
          return
        }
        started = true
        lane.active++
        lane.activeChars += chars
        void Promise.resolve()
          .then(() => {
            signal?.throwIfAborted()
            queueMs = timing.elapsedMs()
            executing = performance.now()
            return timing.run(work)
          })
          .then(
            (value) => {
              timing.end(signal?.aborted ? 'cancelled' : 'completed', { queueMs, executeMs: Math.round((performance.now() - executing) * 10) / 10 })
              resolve(value)
            },
            (error) => {
              const details = { queueMs: executing ? queueMs : timing.elapsedMs(), executeMs: executing ? Math.round((performance.now() - executing) * 10) / 10 : 0 }
              if (signal?.aborted) timing.end('cancelled', details)
              else timing.fail(error, details)
              reject(error)
            }
          )
          .finally(() => {
            lane.active--
            lane.activeChars = Math.max(0, lane.activeChars - chars)
            pump()
          })
      },
    }
    lane.queue.add(waiter)
    signal?.addEventListener('abort', waiter.cancel, { once: true })
    if (signal?.aborted) waiter.cancel()
    else pump()
  })
}
