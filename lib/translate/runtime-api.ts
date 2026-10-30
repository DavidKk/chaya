import { requestPath, startClientOperation } from '@/lib/log/timing'
import { reportBrowserTiming } from '@/services/log/browser'

/** Translation operations shared by the UI and game plugin; paths identify operations, never arbitrary files. */
export type TranslationRequest = { path: string; method: string; body?: Record<string, unknown>; requestId?: string }
export type TranslationResponse = { status: number; data: Record<string, unknown> }
export type TranslationRequestFn = (request: TranslationRequest, signal?: AbortSignal) => Promise<TranslationResponse>

export type TranslationRuntime = { request: TranslationRequestFn; dispose: () => void }

export type SeedProgress = {
  contentRoot: string
  hasSeed: boolean
  total: number
  done: number
  missing: number
  needCount: number
  skipCount: number
  needChars: number
  skipChars: number
  missingChars: number
  doneChars: number
  failedCount?: number
  failedChars?: number
  lines: number
  batchSize: number
  batchesLeft: number
}

export type BatchExecutionSource = 'cache' | 'apple' | 'agent' | 'platform' | 'bergamot' | 'ollama' | 'unknown'

export type TranslationFailureLog = {
  source: string
  error: string
}

export type TranslationWindowReason = 'capacity' | 'cache-drained' | 'engine-result' | 'finished' | 'interrupted' | 'timeout'
export type TranslationAgentRequestLog = { items: number; chars: number; engine?: BatchExecutionSource }

export type TranslationBatchLog = {
  batch: number
  success: number
  total: number
  failed: number
  chars: number
  cacheHits: number
  submittedSources: BatchExecutionSource[]
  finalSources: BatchExecutionSource[]
  cacheUnavailable: boolean
  windowReason?: TranslationWindowReason
}

export function installedTranslationRuntime(): TranslationRuntime | undefined {
  return (globalThis as typeof globalThis & { __chayaTranslationRuntime?: TranslationRuntime }).__chayaTranslationRuntime
}

/** When the game is stopped, the local service performs the same operations against the game's content files. Browser mode must not use disk APIs. */
export const diskTranslationRequest: TranslationRequestFn = async (request, signal) => {
  const timing = startClientOperation(reportBrowserTiming, 'translation.http', { path: requestPath(request.path), method: request.method }, request.requestId)
  let headersMs = 0
  try {
    const res = await fetch(request.path, {
      method: request.method,
      headers: { ...(request.body ? { 'Content-Type': 'application/json' } : {}), 'X-Chaya-Request-Id': timing.id },
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal,
    })
    headersMs = timing.elapsedMs()
    const serverRequestId = res.headers.get('x-chaya-request-id')
    const serverTiming = res.headers.get('server-timing')
    let decodeFailed = false
    const data = (await res.json().catch(() => {
      decodeFailed = true
      return { ok: false, error: { message: `翻译请求失败（${res.status}）` } }
    })) as Record<string, unknown>
    timing.end(res.ok && !decodeFailed ? 'completed' : 'failed', {
      status: res.status,
      headersMs,
      bodyMs: Math.round((timing.elapsedMs() - headersMs) * 10) / 10,
      serverRequestId,
      serverTiming,
      decodeFailed,
    })
    return { status: res.status, data }
  } catch (error) {
    timing.end(signal?.aborted ? 'cancelled' : 'failed', { headersMs, errorName: error instanceof Error ? error.name : 'UnknownError' })
    throw error
  }
}

/** Preserve the shared UI response contract; browser mode must never fall back to the web server's disk APIs. */
export function createTranslationFetch(request: TranslationRequestFn) {
  return async (path: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    if (init?.body != null && typeof init.body !== 'string') throw new Error('Translation request must be JSON')
    const result = await request({ path, method: init?.method || 'GET', body }, init?.signal ?? undefined)
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.data }
  }
}
