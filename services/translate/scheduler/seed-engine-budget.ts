import { resolveEngineCapacitySettings, type TranslateAgentEntry, type TranslateRunEngine } from '@/lib/translate/engines'

/** Bounds source admission, independently of HTTP request concurrency and result-window size. */
export function seedEngineBudget(engine: TranslateRunEngine, agents: TranslateAgentEntry[], configs?: Parameters<typeof resolveEngineCapacitySettings>[1]) {
  if (!engine.startsWith('agent:')) return null
  const settings = resolveEngineCapacitySettings(engine, configs, agents)
  const concurrency = settings.allowConcurrency === false ? 1 : (settings.concurrencyLimit ?? 1)
  const maxChars = settings.maxConcurrentChars ?? 3000
  // Only reserve what this agent can actually run. A multi-thousand reservation pins the
  // inventory to a slow model and leaves Apple with a handful of one-line requests.
  const items = Math.min(48, Math.max(8, concurrency * 4))
  return { items, chars: maxChars * (concurrency + 1) }
}
