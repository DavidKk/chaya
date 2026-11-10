import { resolveEngineCapacitySettings, type TranslateAgentEntry, type TranslateRunEngine } from '@/lib/translate/engines'

/** Bounds source admission, independently of HTTP request concurrency and result-window size. */
export function seedEngineBudget(engine: TranslateRunEngine, agents: TranslateAgentEntry[], configs?: Parameters<typeof resolveEngineCapacitySettings>[1]) {
  if (!engine.startsWith('agent:')) return null
  const settings = resolveEngineCapacitySettings(engine, configs, agents)
  const concurrency = settings.allowConcurrency === false ? 1 : (settings.concurrencyLimit ?? 1)
  const maxChars = settings.maxConcurrentChars ?? 3000
  return { items: 4096, chars: maxChars * (concurrency + 1) }
}
