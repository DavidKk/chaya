import { startClientOperation } from '@/lib/log/timing'
import { reportBrowserTiming } from '@/services/log/browser'

/** Serialize inference per lane with a configurable concurrency budget; prioritize interactive requests over background work and drop cancelled tasks. */
type Task<T = unknown> = {
  interactive: boolean
  concurrency: number
  lane: string
  signal?: AbortSignal
  run: () => Promise<void>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export type ScheduleOllamaOptions = {
  interactive?: boolean
  concurrency?: number
  /** Distinct endpoints/models may translate concurrently; the default lane stays serial for compatibility. */
  lane?: string
  signal?: AbortSignal
  /** Hosts provide their own logger without importing Node APIs into the game bundle. */
  startTiming?: (meta: Record<string, unknown>) => ReturnType<typeof startClientOperation>
}

const DEFAULT_LANE = 'ollama'
const queue: Task<any>[] = []
const active = new Map<string, number>()

function laneCapacity(task: Task<any>): number {
  return Math.max(1, Math.min(40, Math.floor(task.concurrency) || 1))
}

function drain() {
  // Prefer the first runnable interactive task, then the first runnable background task.
  let index = -1
  for (let i = 0; i < queue.length; i++) {
    const task = queue[i]
    if ((active.get(task.lane) || 0) >= laneCapacity(task)) continue
    if (task.interactive) {
      index = i
      break
    }
    if (index === -1) index = i
  }
  if (index === -1) return
  const next = queue.splice(index, 1)[0]
  if (next.signal?.aborted) {
    next.reject(next.signal.reason)
    drain()
    return
  }
  active.set(next.lane, (active.get(next.lane) || 0) + 1)
  void next.run().finally(() => {
    const remaining = (active.get(next.lane) || 1) - 1
    if (remaining > 0) active.set(next.lane, remaining)
    else active.delete(next.lane)
    drain()
  })
}

export function scheduleOllama<T>(run: () => Promise<T>, interactive?: boolean, signal?: AbortSignal): Promise<T>
export function scheduleOllama<T>(run: () => Promise<T>, options?: ScheduleOllamaOptions): Promise<T>
export function scheduleOllama<T>(run: () => Promise<T>, options: boolean | ScheduleOllamaOptions = false, legacySignal?: AbortSignal): Promise<T> {
  const opts: ScheduleOllamaOptions = typeof options === 'boolean' ? { interactive: options, signal: legacySignal } : options
  const signal = opts.signal
  const lane = opts.lane || DEFAULT_LANE
  const meta = { lane, concurrency: opts.concurrency ?? 1, interactive: opts.interactive === true, queued: queue.length }
  const timing = opts.startTiming?.(meta) ?? startClientOperation(reportBrowserTiming, 'agent.inference', meta)
  let queueMs = 0
  let started: number | undefined
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      timing.end('cancelled', { phase: 'before-queue' })
      return reject(signal.reason)
    }
    const cancel = () => {
      const index = queue.indexOf(task)
      if (index >= 0) queue.splice(index, 1)
      if (started === undefined) {
        timing.end('cancelled', { phase: 'queued', queueMs: timing.elapsedMs(), executeMs: 0 })
        signal?.removeEventListener('abort', cancel)
      } else timing.mark('cancellation-requested', { queueMs })
      reject(signal?.reason)
    }
    const task: Task<T> = {
      interactive: opts.interactive === true,
      concurrency: opts.concurrency ?? 1,
      lane,
      signal,
      resolve,
      reject,
      run: async () => {
        queueMs = timing.elapsedMs()
        started = performance.now()
        timing.mark('execution-started', { queueMs, active: active.get(lane) })
        try {
          const value = await timing.run(run)
          timing.end(signal?.aborted ? 'cancelled' : 'completed', { queueMs, executeMs: Math.round((performance.now() - started) * 10) / 10 })
          resolve(value)
        } catch (error) {
          if (signal?.aborted) timing.end('cancelled', { queueMs, executeMs: Math.round((performance.now() - started) * 10) / 10 })
          else timing.fail(error, { queueMs, executeMs: Math.round((performance.now() - started) * 10) / 10 })
          reject(error)
        } finally {
          signal?.removeEventListener('abort', cancel)
        }
      },
    }
    signal?.addEventListener('abort', cancel, { once: true })
    queue.push(task)
    drain()
  })
}
