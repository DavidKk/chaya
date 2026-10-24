/** Shared transport limits include abandoned requests until the adapter actually settles. */
import { type EngineCapacitySettings, type TranslateRunEngine } from '@/lib/translate/engines'

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
  return 1
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
  if (lane.active >= engineConfiguredCapacity(engine, waiter.settings)) return false
  const maxChars = waiter.settings?.maxConcurrentChars
  if (typeof maxChars === 'number' && maxChars > 0 && lane.active > 0 && lane.activeChars + waiter.chars > maxChars) return false
  return true
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
  return new Promise<T>((resolve, reject) => {
    let started = false
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
        lane.activeChars += chars
        void Promise.resolve()
          .then(() => {
            signal?.throwIfAborted()
            return work()
          })
          .then(resolve, reject)
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
