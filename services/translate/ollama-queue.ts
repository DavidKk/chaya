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
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const cancel = () => {
      const index = queue.indexOf(task)
      if (index >= 0) queue.splice(index, 1)
      reject(signal?.reason)
    }
    const task: Task<T> = {
      interactive: opts.interactive === true,
      concurrency: opts.concurrency ?? 1,
      lane: opts.lane || DEFAULT_LANE,
      signal,
      resolve,
      reject,
      run: async () => {
        try {
          resolve(await run())
        } catch (error) {
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
