/** Translation engine definitions shared by the server, game plugin and web client. User-configured agent instances use agent:<id>; platform engines are Bing and Google. Fill jobs try agents before platform engines. */
export const TRANSLATE_ENGINE_IDS = ['bing', 'google', 'apple', 'bergamot'] as const
export type TranslateBuiltinId = (typeof TRANSLATE_ENGINE_IDS)[number]
export type TranslateEngineId = TranslateBuiltinId | `agent:${string}`
/** Local Ollama is used internally for play-mode latency checks and live dialogue, and is excluded from the engine list. */
export type TranslateRunEngine = TranslateEngineId | 'ollama'
export type TranslateEngineGroup = 'agent' | 'platform' | 'system'
export type TranslateEngineSwitches = Record<TranslateBuiltinId, boolean>

export const TRANSLATE_GROUP_ORDER: TranslateEngineGroup[] = ['agent', 'platform', 'system']
export const DEFAULT_ENGINE_ORDER: TranslateEngineId[] = [...TRANSLATE_ENGINE_IDS]
export const DEFAULT_ENGINE_SWITCHES: TranslateEngineSwitches = {
  bing: true,
  google: true,
  apple: false,
  bergamot: false,
}

/** An agent translation entry references an instance; an empty model uses its default model. */
export type TranslateAgentEntry = { id: string; profileId: string; model: string; enabled: boolean }
/** The agent instance and model for a single translation request. */
export type TranslateAiConfig = { profileId: string; model: string }

export const MAX_TRANSLATE_AGENTS = 20
const AGENT_PREFIX = 'agent:'
const ENTRY_ID = /^[a-z0-9_-]{1,40}$/i

export function agentEngineKey(entryId: string): TranslateEngineId {
  return `${AGENT_PREFIX}${entryId}`
}

export function agentEntryId(key: string): string | null {
  return key.startsWith(AGENT_PREFIX) ? key.slice(AGENT_PREFIX.length) : null
}

export function engineGroup(key: TranslateEngineId): TranslateEngineGroup {
  if (key === 'apple' || key === 'bergamot') return 'system'
  return isBuiltinEngineId(key) ? 'platform' : 'agent'
}

/** Exhaust the starting category, then try remaining categories in Agent/platform/system order.
 * The input is the eligible engine list; this never enables an engine or adds an unselected one.
 */
export function translationFallbackOrder(engines: readonly TranslateRunEngine[]): TranslateRunEngine[] {
  const unique = [...new Set(engines)]
  if (!unique.length) return []
  const groupOf = (engine: TranslateRunEngine): TranslateEngineGroup => (engine === 'ollama' ? 'system' : engineGroup(engine))
  const first = groupOf(unique[0])
  const groups = [first, ...TRANSLATE_GROUP_ORDER.filter((group) => group !== first)]
  return groups.flatMap((group) => unique.filter((engine) => groupOf(engine) === group))
}

/** Independent texts run concurrently; each callback owns its ordered fallback chain.
 * Drain every worker before rejecting so callers can safely close their stores in finally.
 */
export async function mapTranslationBatch<T, R>(texts: readonly T[], translate: (text: T) => Promise<R>, concurrency = 4): Promise<R[]> {
  const results: R[] = new Array(texts.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, Math.min(40, Math.floor(concurrency) || 1)), texts.length) }, async () => {
    while (cursor < texts.length) {
      const index = cursor++
      results[index] = await translate(texts[index])
    }
  })
  const settled = await Promise.allSettled(workers)
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return results
}

/** Public platforms reject sensitive text; users configure their agents and local models. */
export function engineAcceptsSensitive(key: TranslateRunEngine): boolean {
  return key === 'ollama' || engineGroup(key) === 'agent'
}

export function isBuiltinEngineId(v: unknown): v is TranslateBuiltinId {
  return typeof v === 'string' && (TRANSLATE_ENGINE_IDS as readonly string[]).includes(v)
}

function shortString(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, 200) : ''
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

export function normalizeAiConfig(raw: unknown): TranslateAiConfig {
  const src = asRecord(raw)
  return { profileId: shortString(src.profileId), model: shortString(src.model) }
}

function extractRawSwitches(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  if ('switches' in src && src.switches && typeof src.switches === 'object' && !Array.isArray(src.switches)) {
    return src.switches as Record<string, unknown>
  }
  if (TRANSLATE_ENGINE_IDS.some((id) => id in src)) {
    return src
  }
  return null
}

export function normalizeEngineSwitches(raw: unknown, base?: unknown): TranslateEngineSwitches {
  const src = asRecord(raw)
  const fallback = base ? normalizeEngineSwitches(base) : DEFAULT_ENGINE_SWITCHES
  return {
    bing: typeof src.bing === 'boolean' ? src.bing : fallback.bing,
    google: typeof src.google === 'boolean' ? src.google : fallback.google,
    apple: typeof src.apple === 'boolean' ? src.apple : fallback.apple,
    bergamot: typeof src.bergamot === 'boolean' ? src.bergamot : fallback.bergamot,
  }
}

export function normalizeAgentEntries(raw: unknown): TranslateAgentEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const usedProfiles = new Set<string>()
  const out: TranslateAgentEntry[] = []
  for (const item of raw) {
    const src = asRecord(item)
    const id = shortString(src.id)
    const profileId = shortString(src.profileId)
    if (!ENTRY_ID.test(id) || !profileId || seen.has(id) || usedProfiles.has(profileId)) continue
    seen.add(id)
    usedProfiles.add(profileId)
    out.push({ id, profileId, model: shortString(src.model), enabled: src.enabled !== false })
    if (out.length >= MAX_TRANSLATE_AGENTS) break
  }
  return out
}

/** Keep existing keys and append missing ones in default platform order and agent creation order. */
export function normalizeEngineOrder(raw: unknown, agents: TranslateAgentEntry[] = []): TranslateEngineId[] {
  const valid = new Set<string>([...TRANSLATE_ENGINE_IDS, ...agents.map((a) => agentEngineKey(a.id))])
  const seen = new Set<string>()
  const out: TranslateEngineId[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== 'string' || !valid.has(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item as TranslateEngineId)
  }
  for (const key of [...DEFAULT_ENGINE_ORDER, ...agents.map((a) => agentEngineKey(a.id))]) {
    if (!seen.has(key)) out.push(key)
  }
  return out
}

export type TranslateEngineState = {
  switches: TranslateEngineSwitches
  agents: TranslateAgentEntry[]
  order: TranslateEngineId[]
  /** Try enabled agents before enabled platforms, preserving each group's configured order. */
  enabled: TranslateEngineId[]
}

export type TranslateEnginePatch = {
  switches?: Partial<TranslateEngineSwitches>
  order?: unknown
  /** Replace the entire entry list. */
  agents?: unknown
}

function isOn(key: TranslateEngineId, switches: TranslateEngineSwitches, agents: TranslateAgentEntry[]): boolean {
  if (isBuiltinEngineId(key)) return switches[key]
  const id = agentEntryId(key)
  return !!agents.find((a) => a.id === id)?.enabled
}

/** Merge saved settings with a patch; all engines may be disabled and translation reports that state. */
export function mergeEngineState(raw: unknown, patch?: TranslateEnginePatch): TranslateEngineState {
  const src = asRecord(raw)
  const current = normalizeEngineSwitches(extractRawSwitches(raw))
  const switches = patch?.switches ? normalizeEngineSwitches(patch.switches, current) : current
  const agents = normalizeAgentEntries(patch?.agents !== undefined ? patch.agents : src.agents)
  const order = normalizeEngineOrder(patch?.order ?? src.order, agents)
  const enabled = TRANSLATE_GROUP_ORDER.flatMap((group) => order.filter((key) => engineGroup(key) === group && isOn(key, switches, agents)))
  return { switches, agents, order, enabled }
}

/** Persist flat platform switches with order and agents for compatibility with older files. */
export function engineStateFileBody(state: TranslateEngineState) {
  return { ...state.switches, order: state.order, agents: state.agents }
}

export function findAgentEntry(agents: TranslateAgentEntry[] | undefined, key: TranslateRunEngine): TranslateAgentEntry | null {
  const id = agentEntryId(key)
  return (id && agents?.find((a) => a.id === id)) || null
}

/** Tag agent translations with their instance ID so cache entries can be filtered by source. */
export function engineSourceTag(key: TranslateRunEngine, agents?: TranslateAgentEntry[]): string {
  const entry = findAgentEntry(agents, key)
  return entry ? `agent:${entry.profileId}` : key
}
