import { requestPath, startClientOperation } from '@/lib/log/timing'
import type { TranslationRequestFn, TranslationRuntime } from '@/lib/translate/runtime-api'
import { createBrowserTimingReporter } from '@/services/log/browser'

type OverlayConfig = {
  apiBase?: string
  contentRoot?: string
  launchToken?: string
  linkToken?: string
  roomId?: string
}

export function createRgssTimingReporter(config: OverlayConfig = readRgssOverlayConfig()) {
  return createBrowserTimingReporter(async (entries) => {
    await fetch(`${String(config.apiBase || '').replace(/\/+$/, '')}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.launchToken ? { 'X-Chaya-Launch-Token': config.launchToken } : {}) },
      body: JSON.stringify({ entries }),
      signal: AbortSignal.timeout(5000),
    })
  })
}

/** Read overlay boot params from native inject or the page query string. */
export function readRgssOverlayConfig(): OverlayConfig {
  if (typeof window === 'undefined') return {}
  try {
    const injected = (window as Window & { __CHAYA_RGSS_CONFIG__?: Record<string, string> }).__CHAYA_RGSS_CONFIG__
    const params = new URLSearchParams(window.location.search)
    const read = (key: string) => injected?.[key] || params.get(key) || undefined
    return {
      apiBase: read('apiBase') || window.location.origin,
      contentRoot: read('contentRoot'),
      launchToken: read('launchToken'),
      linkToken: read('linkToken'),
      roomId: read('roomId'),
    }
  } catch {
    return { apiBase: window.location.origin }
  }
}

/**
 * RGSS WebView has no NW.js ChayaTranslate plugin. Route the shared translate UI
 * through the local Chaya service (same path SubtitleOverlay already uses).
 */
export function createRgssServiceTranslationRequest(config: OverlayConfig = readRgssOverlayConfig()): TranslationRequestFn {
  const apiBase = String(config.apiBase || '').replace(/\/+$/, '')
  const contentRoot = config.contentRoot?.trim() || ''
  const launchToken = config.launchToken?.trim() || ''
  const report = createRgssTimingReporter(config)

  return async (request, signal) => {
    const path = request.path.startsWith('http') ? request.path : `${apiBase}${request.path.startsWith('/') ? '' : '/'}${request.path}`
    const headers: Record<string, string> = {}
    if (launchToken) headers['X-Chaya-Launch-Token'] = launchToken

    const method = request.method || 'GET'
    const write = method !== 'GET' && method !== 'HEAD'
    let body: string | undefined
    if (request.body != null || (write && contentRoot)) {
      const payload: Record<string, unknown> = { ...(request.body || {}) }
      if (contentRoot && payload.contentRoot == null) payload.contentRoot = contentRoot
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(payload)
    }

    const pathname = requestPath(path)
    const timing =
      pathname === '/api/logs' || pathname.startsWith('/api/logs/')
        ? undefined
        : startClientOperation(report, 'translation.http', { method, path: pathname, transport: 'rgss', parentId: request.requestId })
    if (timing) headers['X-Chaya-Request-Id'] = timing.id
    let headersMs = 0
    try {
      const res = await fetch(path, { method, headers, body, signal })
      headersMs = timing?.elapsedMs() ?? 0
      let decodeFailed = false
      const data = (await res.json().catch(() => {
        decodeFailed = true
        return { ok: false, error: { message: `翻译请求失败（${res.status}）` } }
      })) as Record<string, unknown>
      timing?.end(res.ok && !decodeFailed ? 'completed' : 'failed', {
        status: res.status,
        headersMs,
        bodyMs: Math.round((timing.elapsedMs() - headersMs) * 10) / 10,
        serverRequestId: res.headers.get('x-chaya-request-id'),
        serverTiming: res.headers.get('server-timing'),
        decodeFailed,
      })
      return { status: res.status, data }
    } catch (error) {
      timing?.end(signal?.aborted ? 'cancelled' : 'failed', { headersMs, errorName: error instanceof Error ? error.name : 'UnknownError' })
      throw error
    }
  }
}

export function installRgssOverlayTranslationRuntime(config: OverlayConfig = readRgssOverlayConfig()): () => void {
  const host = globalThis as typeof globalThis & { __chayaTranslationRuntime?: TranslationRuntime }
  const previous = host.__chayaTranslationRuntime
  const runtime: TranslationRuntime = {
    request: createRgssServiceTranslationRequest(config),
    dispose: () => {},
  }
  host.__chayaTranslationRuntime = runtime
  return () => {
    if (host.__chayaTranslationRuntime === runtime) host.__chayaTranslationRuntime = previous
  }
}
