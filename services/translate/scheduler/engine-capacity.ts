/** Shared transport limits include abandoned requests until the adapter actually settles. */
import { engineGroup, type TranslateRunEngine } from '@/lib/translate/engines'

export function engineCapacity(engine: TranslateRunEngine): number {
  return engineConfiguredCapacity(engine)
}

export function engineConfiguredCapacity(engine: TranslateRunEngine, customSettings?: { allowConcurrency?: boolean; concurrencyLimit?: number }): number {
  if (customSettings?.allowConcurrency === false) return 1
  if (typeof customSettings?.concurrencyLimit === 'number' && customSettings.concurrencyLimit > 0) {
    return Math.max(1, Math.min(40, Math.floor(customSettings.concurrencyLimit)))
  }
  if (engine === 'apple') return 40
  if (engine === 'bergamot' || engine === 'ollama') return 1
  return engineGroup(engine) === 'agent' ? 2 : 4
}

type Waiter = { run: () => void; cancel: () => void }
type Lane = { active: number; queue: Set<Waiter> }
const globalLanes = globalThis as typeof globalThis & { __chayaTranslationCapacity?: Map<string, Lane> }
const lanes = (globalLanes.__chayaTranslationCapacity ??= new Map<string, Lane>())

export function withEngineCapacity<T>(
  engine: TranslateRunEngine,
  identity: string,
  work: () => Promise<T>,
  signal?: AbortSignal,
  customSettings?: { allowConcurrency?: boolean; concurrencyLimit?: number }
): Promise<T> {
  const lane = lanes.get(identity) || { active: 0, queue: new Set<Waiter>() }
  lanes.set(identity, lane)
  return new Promise<T>((resolve, reject) => {
    let started = false
    const clear = () => signal?.removeEventListener('abort', waiter.cancel)
    const pump = () => {
      while (lane.active < engineConfiguredCapacity(engine, customSettings) && lane.queue.size) lane.queue.values().next().value!.run()
      if (!lane.active && !lane.queue.size) lanes.delete(identity)
    }
    const waiter: Waiter = {
      cancel: () => {
        if (started) return
        lane.queue.delete(waiter)
        clear()
        reject(signal?.reason || new Error('Translation request cancelled'))
        pump()
      },
      run: () => {
        lane.queue.delete(waiter)
        clear()
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        started = true
        lane.active++
        void Promise.resolve()
          .then(() => {
            signal?.throwIfAborted()
            return work()
          })
          .then(resolve, reject)
          .finally(() => {
            lane.active--
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
