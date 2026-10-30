import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { isMainThread, parentPort, threadId } from 'node:worker_threads'

import type { LogLevel } from '@/lib/log'

import { appendLog } from './bus'

type Meta = Record<string, unknown>
type Context = { operationId: string }
type Options = { operationId?: string; start?: boolean; slowMs?: number; level?: LogLevel }
const context = new AsyncLocalStorage<Context>()

export function runtimeEvent(level: LogLevel, source: string, message: string, meta?: Meta, forward = false, ts = Date.now()) {
  try {
    const entry = { level, source, message, meta, ts }
    if (!isMainThread && parentPort && (forward || process.env.CHAYA_LOG_FORWARD_TO_PARENT === '1')) {
      parentPort.postMessage({ type: 'translation-log', entry })
    } else appendLog(entry)
  } catch {
    // Observability must never fail a request.
  }
}

export function operationId(value?: string | null): string {
  return value && /^[a-zA-Z0-9:_-]{1,100}$/.test(value) ? value : randomUUID()
}

/** Wall-clock timestamps correlate processes; monotonic durations measure work in each process. */
export function startOperation(source: string, operation: string, meta: Meta = {}, options: Options = {}) {
  const id = operationId(options.operationId)
  const startedAt = Date.now()
  const started = performance.now()
  const base = { ...meta, operation, operationId: id, parentId: context.getStore()?.operationId, pid: process.pid, threadId, startedAt }
  let ended = false
  const elapsedMs = () => Math.round((performance.now() - started) * 10) / 10
  const mark = (stage: string, details: Meta = {}) => runtimeEvent('debug', source, `${operation}: ${stage}`, { ...base, ...details, stage, elapsedMs: elapsedMs() })
  if (options.start !== false) mark('started')
  return {
    id,
    startedAt,
    elapsedMs,
    mark,
    run<T>(fn: () => T): T {
      return context.run({ operationId: id }, fn)
    },
    end(outcome: 'completed' | 'failed' | 'cancelled' = 'completed', details: Meta = {}) {
      if (ended) return
      ended = true
      const duration = elapsedMs()
      const slow = duration >= (options.slowMs ?? 1000)
      runtimeEvent(outcome === 'failed' ? 'fail' : slow ? 'warn' : (options.level ?? 'debug'), source, `${operation}: ${outcome} (${duration}ms)`, {
        ...base,
        ...details,
        outcome,
        elapsedMs: duration,
        slow,
        finishedAt: Date.now(),
      })
    },
    fail(error: unknown, details: Meta = {}) {
      const errorName = error && typeof error === 'object' && 'name' in error ? String(error.name) : 'UnknownError'
      this.end(errorName === 'AbortError' ? 'cancelled' : 'failed', {
        ...details,
        errorName,
        errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
      })
    },
  }
}

export type TimedOperation = ReturnType<typeof startOperation>

export async function measureOperation<T>(source: string, operation: string, meta: Meta, run: () => Promise<T> | T, options?: Options): Promise<T> {
  const timing = startOperation(source, operation, meta, options)
  return timing.run(async () => {
    try {
      const value = await run()
      timing.end()
      return value
    } catch (error) {
      timing.fail(error)
      throw error
    }
  })
}
