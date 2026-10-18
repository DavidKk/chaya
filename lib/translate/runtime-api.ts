/** Translation operations shared by the UI and game plugin; paths identify operations, never arbitrary files. */
export type TranslationRequest = { path: string; method: string; body?: Record<string, unknown> }
export type TranslationResponse = { status: number; data: Record<string, unknown> }
export type TranslationRequestFn = (request: TranslationRequest, signal?: AbortSignal) => Promise<TranslationResponse>

export type TranslationRuntime = { request: TranslationRequestFn; dispose: () => void }

export function installedTranslationRuntime(): TranslationRuntime | undefined {
  return (globalThis as typeof globalThis & { __chayaTranslationRuntime?: TranslationRuntime }).__chayaTranslationRuntime
}

/** When the game is stopped, the local service performs the same operations against the game's content files. Browser mode must not use disk APIs. */
export const diskTranslationRequest: TranslationRequestFn = async (request, signal) => {
  const res = await fetch(request.path, {
    method: request.method,
    headers: request.body ? { 'Content-Type': 'application/json' } : undefined,
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal,
  })
  const data = (await res.json().catch(() => ({ ok: false, error: { message: `翻译请求失败（${res.status}）` } }))) as Record<string, unknown>
  return { status: res.status, data }
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
