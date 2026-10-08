const RESULT_RETENTION_MS = 10 * 60 * 1000

export type OperationIdentity = {
  requestId: string
  gameId: string
  generation: number
  deadlineAt: number
}

export type OperationState =
  | { state: 'idle' }
  | { state: 'running'; requestId: string; startedAt: number }
  | { state: 'completed'; requestId: string }
  | { state: 'failed' | 'cancelled' | 'disconnected' | 'unknown'; requestId: string; reason: string }

export class OperationDeadlineError extends Error {
  constructor(message = '操作已超过期限') {
    super(message)
    this.name = 'OperationDeadlineError'
  }
}

export class OperationTimeoutError extends Error {
  constructor(message = '操作超时') {
    super(message)
    this.name = 'OperationTimeoutError'
  }
}

export class OperationCapacityError extends Error {
  constructor(message = '近期写操作记录已满，请稍后重试') {
    super(message)
    this.name = 'OperationCapacityError'
  }
}

export function clampDeadline(deadlineAt: number, hardLimitMs: number, now = Date.now()): number {
  if (!Number.isFinite(deadlineAt)) return now + hardLimitMs
  return Math.min(deadlineAt, now + hardLimitMs)
}

/** A small generation fence: invalidate before switching game, source, or connection. */
export class OperationGeneration {
  private value = 0

  current(): number {
    return this.value
  }

  next(): number {
    this.value += 1
    return this.value
  }

  isCurrent(generation: number): boolean {
    return generation === this.value
  }
}

type RunOptions<T> = {
  identity: OperationIdentity
  hardLimitMs: number
  signal?: AbortSignal
  run: (signal: AbortSignal) => Promise<T>
  now?: () => number
}

/**
 * Enforces the caller deadline and the execution host's hard limit. Timeout aborts
 * cooperative work; callers must still reconcile authoritative state before
 * continuing a write queue when the underlying operation cannot be cancelled.
 */
export async function runRecoverableOperation<T>({ identity, hardLimitMs, signal, run, now = Date.now }: RunOptions<T>): Promise<T> {
  const startedAt = now()
  const deadlineAt = clampDeadline(identity.deadlineAt, hardLimitMs, startedAt)
  if (deadlineAt <= startedAt) throw new OperationDeadlineError()
  const abortReason = () => signal?.reason ?? new DOMException('操作已取消', 'AbortError')
  if (signal?.aborted) throw abortReason()

  const controller = new AbortController()
  let rejectCancellation: (reason: unknown) => void = () => {}
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject
  })
  const abort = () => {
    const reason = abortReason()
    controller.abort(reason)
    rejectCancellation(reason)
  }
  signal?.addEventListener('abort', abort, { once: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort(new OperationTimeoutError())
        reject(new OperationTimeoutError())
      },
      Math.max(0, deadlineAt - startedAt)
    )
  })

  try {
    return await Promise.race([run(controller.signal), timeout, cancellation])
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

type CacheEntry<T> = {
  promise: Promise<T>
  expiresAt: number
  pending: boolean
}

/** Executor-side idempotency cache for write operations. */
export class IdempotentWriteCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()

  constructor(
    private readonly maxEntries = 1000,
    private readonly now: () => number = Date.now
  ) {}

  size(): number {
    this.prune()
    return this.entries.size
  }

  run(identity: Pick<OperationIdentity, 'requestId' | 'deadlineAt'>, execute: () => Promise<T>): Promise<T> {
    const now = this.now()
    this.prune(now)
    const existing = this.entries.get(identity.requestId)
    if (existing) return existing.promise
    if (identity.deadlineAt <= now) return Promise.reject(new OperationDeadlineError())

    if (this.entries.size >= this.maxEntries) return Promise.reject(new OperationCapacityError())

    const entry: CacheEntry<T> = { promise: Promise.resolve(undefined as T), expiresAt: identity.deadlineAt + RESULT_RETENTION_MS, pending: true }
    entry.promise = Promise.resolve().then(execute)
    this.entries.set(identity.requestId, entry)
    void entry.promise.then(
      () => this.complete(entry, identity.deadlineAt),
      () => this.complete(entry, identity.deadlineAt)
    )
    return entry.promise
  }

  private complete(entry: CacheEntry<T>, deadlineAt: number): void {
    entry.pending = false
    entry.expiresAt = Math.max(deadlineAt + RESULT_RETENTION_MS, this.now() + RESULT_RETENTION_MS)
  }

  private prune(now = this.now()): void {
    for (const [requestId, entry] of this.entries) {
      if (!entry.pending && entry.expiresAt <= now) this.entries.delete(requestId)
    }
  }
}
