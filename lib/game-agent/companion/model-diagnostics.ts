/** Wall-clock milliseconds; provider-native inference timings remain on message.timing. */
export type CompanionModelMetrics = {
  totalMs: number
  contextMs?: number
  queueMs?: number
  startupMs?: number
  startupLoadMs?: number
  residency?: 'cold' | 'warm' | 'unknown'
  loadMs?: number
  generationMs?: number
  firstTokenMs?: number
}

export type CompanionModelStatus = {
  phase: 'loading' | 'ready'
  residency: 'cold' | 'warm' | 'unknown'
  startupMs?: number
  startupLoadMs?: number
}

export const COMPANION_MODEL_STARTUP_MS = 60_000
/** Route may warm the model before constructing a short-lived intent receipt. */
export const COMPANION_ROUTE_CALL_TIMEOUT_MS = 2 * COMPANION_MODEL_STARTUP_MS + 20_000

export function includeCompanionContext(metrics: CompanionModelMetrics | undefined, contextMs: number): CompanionModelMetrics | undefined {
  if (!metrics) return undefined
  return {
    ...metrics,
    totalMs: contextMs + metrics.totalMs,
    contextMs: contextMs + (metrics.contextMs ?? 0),
    firstTokenMs: metrics.firstTokenMs === undefined ? undefined : contextMs + metrics.firstTokenMs,
  }
}
