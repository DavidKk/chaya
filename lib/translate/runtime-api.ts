/** UI 与游戏插件之间的翻译操作；路径只是操作标识，不是任意文件路径。 */
export type TranslationRequest = { path: string; method: string; body?: Record<string, unknown> }
export type TranslationResponse = { status: number; data: Record<string, unknown> }
export type TranslationRequestFn = (request: TranslationRequest, signal?: AbortSignal) => Promise<TranslationResponse>

export type TranslationRuntime = { request: TranslationRequestFn; dispose: () => void }

export function installedTranslationRuntime(): TranslationRuntime | undefined {
  return (globalThis as typeof globalThis & { __chayaTranslationRuntime?: TranslationRuntime }).__chayaTranslationRuntime
}

/**
 * 本机服务、游戏未运行时：同一组操作直接走服务端磁盘接口（读写同一套游戏内容文件）。
 * 浏览器模式（无盘）不得使用。
 */
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

/** 保持共享 UI 的响应契约；浏览器模式绝不回退到 Web 服务器的磁盘接口。 */
export function createTranslationFetch(request: TranslationRequestFn) {
  return async (path: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    if (init?.body != null && typeof init.body !== 'string') throw new Error('翻译请求需使用 JSON')
    const result = await request({ path, method: init?.method || 'GET', body }, init?.signal ?? undefined)
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.data }
  }
}
