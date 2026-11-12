import { resolveEngineCapacitySettings, type TranslateAgentEntry, type TranslateRunEngine } from '@/lib/translate/engines'

/** Bounds source admission, independently of HTTP request concurrency and result-window size. */
export function seedEngineBudget(
  engine: TranslateRunEngine,
  agents: TranslateAgentEntry[],
  configs?: Parameters<typeof resolveEngineCapacitySettings>[1],
  options?: { shareWithApple?: boolean }
) {
  if (!engine.startsWith('agent:')) return null
  const settings = resolveEngineCapacitySettings(engine, configs, agents)
  const concurrency = settings.allowConcurrency === false ? 1 : (settings.concurrencyLimit ?? 1)
  const maxChars = settings.maxConcurrentChars ?? 3000
  // Character budget is what fills one packed request. When Apple is also enabled, keep the
  // item reservation small so a slow agent cannot pin the rest of the inventory.
  const items = options?.shareWithApple ? Math.min(48, Math.max(8, concurrency * 4)) : 4096
  return { items, chars: maxChars * (concurrency + 1) }
}
