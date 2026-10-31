import { COMPANION_MODEL_STARTUP_MS, type CompanionModelStatus } from '@/lib/game-agent/companion/model-diagnostics'

/** No idle eviction for companion models; never unload on completion or cancellation. */
export const COMPANION_KEEP_ALIVE = -1
export const COMPANION_CONTEXT_LENGTH = 16_384

/** Probe the actual daemon on every lease: another client or a daemon restart may evict the model. */
export async function prepareCompanionOllama(input: {
  endpoint: string
  model: string
  token?: string
  signal: AbortSignal
  fetcher?: typeof fetch
  onStatus?: (status: CompanionModelStatus) => void
}): Promise<{ residency: CompanionModelStatus['residency']; startupMs: number; startupLoadMs?: number }> {
  const started = Date.now()
  const fetcher = input.fetcher ?? fetch
  const base = input.endpoint.replace(/\/$/, '')
  const headers = input.token ? { Authorization: `Bearer ${input.token}` } : undefined
  let residency: CompanionModelStatus['residency'] = 'unknown'
  let startupLoadMs: number | undefined
  try {
    const response = await fetcher(`${base}/api/ps`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(1_000)]),
    })
    if (response.ok) {
      const body = (await response.json()) as { models?: Array<{ name?: string; model?: string; context_length?: number }> }
      if (Array.isArray(body.models)) {
        const canonical = (name: string) => (name.slice(name.lastIndexOf('/') + 1).includes(':') ? name : `${name}:latest`)
        const loaded = body.models.find((item) => [item.name, item.model].some((name) => typeof name === 'string' && canonical(name) === canonical(input.model)))
        // A changed context size can require reloading an already resident model.
        residency = loaded && (loaded.context_length === undefined || loaded.context_length === COMPANION_CONTEXT_LENGTH) ? 'warm' : 'cold'
      }
    }
  } catch {
    input.signal.throwIfAborted()
    // Proxies and older daemons may not expose /api/ps. Do not infer a cold start.
  }
  if (residency === 'cold') {
    input.onStatus?.({ phase: 'loading', residency })
    const response = await fetcher(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model: input.model,
        messages: [],
        stream: false,
        keep_alive: COMPANION_KEEP_ALIVE,
        options: { num_ctx: COMPANION_CONTEXT_LENGTH },
      }),
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(COMPANION_MODEL_STARTUP_MS)]),
    })
    if (!response.ok) throw new Error(`Companion model loading failed (HTTP ${response.status})`)
    const body = (await response.json()) as { error?: string; load_duration?: number }
    if (body.error) throw new Error(body.error)
    if (typeof body.load_duration === 'number' && Number.isFinite(body.load_duration) && body.load_duration >= 0) startupLoadMs = body.load_duration / 1_000_000
  }
  input.signal.throwIfAborted()
  const result = { residency, startupMs: Date.now() - started, ...(startupLoadMs === undefined ? {} : { startupLoadMs }) }
  input.onStatus?.({ phase: 'ready', ...result })
  return result
}
