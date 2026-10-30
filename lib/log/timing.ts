import type { LogLevel } from './types'

export type TimingEntry = { level: LogLevel; source: string; message: string; meta: Record<string, unknown>; ts: number }
export type TimingReporter = (entry: TimingEntry) => void

export function requestPath(value: string): string {
  try {
    return new URL(value, 'http://chaya.invalid').pathname
  } catch {
    return '(invalid-path)'
  }
}

/** Local monotonic time measures durations; timestamps only correlate events between peers. */
export function startClientOperation(report: TimingReporter | undefined, operation: string, meta: Record<string, unknown>, id?: string) {
  const startedAt = Date.now()
  const started = performance.now()
  const operationId = id || globalThis.crypto?.randomUUID?.() || `${startedAt.toString(36)}-${Math.random().toString(36).slice(2)}`
  const base = { ...meta, operation, operationId, startedAt }
  let ended = false
  const elapsedMs = () => Math.round((performance.now() - started) * 10) / 10
  const emit = (stage: string, details: Record<string, unknown>, level: LogLevel = 'debug') => {
    const duration = elapsedMs()
    try {
      report?.({ level, source: 'communication', message: `${operation}: ${stage} (${duration}ms)`, meta: { ...base, ...details, stage, elapsedMs: duration }, ts: Date.now() })
    } catch {
      // A disconnected log transport must not affect the operation.
    }
  }
  const end = (outcome: 'completed' | 'failed' | 'cancelled', details: Record<string, unknown> = {}) => {
    if (ended) return
    ended = true
    emit(outcome, { ...details, outcome, slow: elapsedMs() >= 1000, finishedAt: Date.now() }, outcome === 'failed' ? 'fail' : elapsedMs() >= 1000 ? 'warn' : 'debug')
  }
  emit('started', {})
  return {
    id: operationId,
    elapsedMs,
    mark: emit,
    end,
    run<T>(fn: () => T): T {
      return fn()
    },
    fail(error: unknown, details: Record<string, unknown> = {}) {
      const errorName = error && typeof error === 'object' && 'name' in error ? String(error.name) : 'UnknownError'
      end(errorName === 'AbortError' ? 'cancelled' : 'failed', {
        ...details,
        errorName,
      })
    },
  }
}
