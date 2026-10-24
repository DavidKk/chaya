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

export type TranslateEngineSettings = {
  id?: string
  enabled?: boolean
  allowConcurrency?: boolean
  concurrencyLimit?: number
  maxConcurrentChars?: number
}

export const DEFAULT_ENGINE_SETTINGS: Record<TranslateBuiltinId, Required<TranslateEngineSettings>> = {
  bing: { id: '', enabled: true, allowConcurrency: true, concurrencyLimit: 4, maxConcurrentChars: 3000 },
  google: { id: '', enabled: true, allowConcurrency: true, concurrencyLimit: 4, maxConcurrentChars: 3000 },
  apple: { id: '', enabled: false, allowConcurrency: true, concurrencyLimit: 40, maxConcurrentChars: 40000 },
  bergamot: { id: '', enabled: false, allowConcurrency: false, concurrencyLimit: 1, maxConcurrentChars: 3000 },
}

/** An agent translation entry references an instance; an empty model uses its default model. */
export type TranslateAgentEntry = {
  id: string
  profileId: string
  model: string
  enabled: boolean
  allowConcurrency?: boolean
  concurrencyLimit?: number
  maxConcurrentChars?: number
}
/** The agent instance and model for a single translation request. */
export type TranslateAiConfig = { profileId: string; model: string }

export const MAX_TRANSLATE_AGENTS = 20
const AGENT_PREFIX = 'agent:'
const ENTRY_ID = /^[a-z0-9_-]{1,40}$/i

export function newEngineEntryId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function isEngineEntryId(v: unknown): v is string {
  return typeof v === 'string' && ENTRY_ID.test(v)
}

export function parseEngineEntryId(raw: string): string | null {
  try {
    raw = decodeURIComponent(raw)
  } catch {
    /* keep raw */
  }
  return isEngineEntryId(raw) ? raw : null
}

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

export function isTranslateEngineId(v: unknown): v is TranslateEngineId {
  if (isBuiltinEngineId(v)) return true
  if (typeof v !== 'string') return false
  const id = agentEntryId(v)
  return !!id && ENTRY_ID.test(id)
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
    const allowConcurrency = typeof src.allowConcurrency === 'boolean' ? src.allowConcurrency : undefined
    const concurrencyLimit =
      typeof src.concurrencyLimit === 'number' && Number.isFinite(src.concurrencyLimit) ? Math.max(1, Math.min(40, Math.floor(src.concurrencyLimit))) : undefined
    const maxConcurrentChars =
      typeof src.maxConcurrentChars === 'number' && Number.isFinite(src.maxConcurrentChars) ? Math.max(500, Math.min(40000, Math.floor(src.maxConcurrentChars))) : undefined
    out.push({
      id,
      profileId,
      model: shortString(src.model),
      enabled: src.enabled !== false,
      ...(allowConcurrency !== undefined ? { allowConcurrency } : {}),
      ...(concurrencyLimit !== undefined ? { concurrencyLimit } : {}),
      ...(maxConcurrentChars !== undefined ? { maxConcurrentChars } : {}),
    })
    if (out.length >= MAX_TRANSLATE_AGENTS) break
  }
  return out
}

export function normalizeEngineConfigs(raw: unknown, switches: TranslateEngineSwitches): Record<TranslateBuiltinId, Required<TranslateEngineSettings>> {
  const src = asRecord(raw)
  const out = {} as Record<TranslateBuiltinId, Required<TranslateEngineSettings>>
  const used = new Set<string>()
  for (const id of TRANSLATE_ENGINE_IDS) {
    const fallback = DEFAULT_ENGINE_SETTINGS[id]
    const item = asRecord(src[id])
    const enabled = switches[id] ?? fallback.enabled
    const allowConcurrency = typeof item.allowConcurrency === 'boolean' ? item.allowConcurrency : fallback.allowConcurrency
    const concurrencyLimit =
      typeof item.concurrencyLimit === 'number' && Number.isFinite(item.concurrencyLimit) ? Math.max(1, Math.min(40, Math.floor(item.concurrencyLimit))) : fallback.concurrencyLimit
    const maxConcurrentChars =
      typeof item.maxConcurrentChars === 'number' && Number.isFinite(item.maxConcurrentChars)
        ? Math.max(500, Math.min(40000, Math.floor(item.maxConcurrentChars)))
        : fallback.maxConcurrentChars
    let entryId = shortString(item.id)
    if (!ENTRY_ID.test(entryId) || used.has(entryId) || isBuiltinEngineId(entryId)) entryId = ''
    if (entryId) used.add(entryId)
    out[id] = { id: entryId, enabled, allowConcurrency, concurrencyLimit, maxConcurrentChars }
  }
  return out
}

export function assignMissingEngineEntryIds(configs: Record<TranslateBuiltinId, Required<TranslateEngineSettings>>): {
  configs: Record<TranslateBuiltinId, Required<TranslateEngineSettings>>
  changed: boolean
} {
  const used = new Set(TRANSLATE_ENGINE_IDS.map((id) => configs[id].id).filter((id) => isEngineEntryId(id) && !isBuiltinEngineId(id)))
  let changed = false
  const next = { ...configs }
  for (const id of TRANSLATE_ENGINE_IDS) {
    const current = configs[id].id
    if (isEngineEntryId(current) && !isBuiltinEngineId(current)) continue
    let entryId = ''
    do {
      entryId = newEngineEntryId()
    } while (used.has(entryId) || isBuiltinEngineId(entryId))
    used.add(entryId)
    next[id] = { ...configs[id], id: entryId }
    changed = true
  }
  return { configs: next, changed }
}

export function builtinEngineByEntryId(configs: Record<TranslateBuiltinId, TranslateEngineSettings> | undefined, entryId: string): TranslateBuiltinId | null {
  if (!configs) return null
  for (const id of TRANSLATE_ENGINE_IDS) {
    if (configs[id]?.id === entryId) return id
  }
  return isBuiltinEngineId(entryId) ? entryId : null
}

export function engineRouteId(key: TranslateEngineId, configs?: Record<TranslateBuiltinId, TranslateEngineSettings>, agents?: TranslateAgentEntry[]): string {
  if (isBuiltinEngineId(key)) {
    const id = configs?.[key]?.id
    return id && isEngineEntryId(id) && !isBuiltinEngineId(id) ? id : ''
  }
  return agentEntryId(key) || findAgentEntry(agents, key)?.id || ''
}

export function resolveEngineRouteId(raw: string, configs?: Record<TranslateBuiltinId, TranslateEngineSettings>, agents?: TranslateAgentEntry[]): TranslateEngineId | null {
  try {
    raw = decodeURIComponent(raw)
  } catch {
    /* keep raw */
  }
  if (isTranslateEngineId(raw)) return raw
  if (!isEngineEntryId(raw)) return null
  const builtin = builtinEngineByEntryId(configs, raw)
  if (builtin) return builtin
  if (agents?.some((a) => a.id === raw)) return agentEngineKey(raw)
  return null
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
  configs: Record<TranslateBuiltinId, Required<TranslateEngineSettings>>
}

export type TranslateEnginePatch = {
  switches?: Partial<TranslateEngineSwitches>
  order?: unknown
  /** Replace the entire entry list. */
  agents?: unknown
  configs?: Partial<Record<string, TranslateEngineSettings>>
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
  const switchesPatch = { ...(patch?.switches || {}) }
  if (patch?.configs) {
    for (const [key, cfg] of Object.entries(patch.configs)) {
      if (isBuiltinEngineId(key) && typeof cfg?.enabled === 'boolean') {
        switchesPatch[key] = cfg.enabled
      }
    }
  }
  const switches = Object.keys(switchesPatch).length > 0 ? normalizeEngineSwitches(switchesPatch, current) : current
  const agents = normalizeAgentEntries(patch?.agents !== undefined ? patch.agents : src.agents)
  const order = normalizeEngineOrder(patch?.order ?? src.order, agents)
  const configSrc = patch?.configs
    ? Object.fromEntries(TRANSLATE_ENGINE_IDS.map((id) => [id, { ...asRecord(asRecord(src.configs)[id]), ...asRecord(asRecord(patch.configs)[id]) }]))
    : src.configs
  const configs = normalizeEngineConfigs(configSrc, switches)
  for (const id of TRANSLATE_ENGINE_IDS) {
    configs[id].enabled = switches[id]
  }
  const enabled = TRANSLATE_GROUP_ORDER.flatMap((group) => order.filter((key) => engineGroup(key) === group && isOn(key, switches, agents)))
  return { switches, agents, order, enabled, configs }
}

/** Persist flat platform switches with order and agents for compatibility with older files. */
export function engineStateFileBody(state: TranslateEngineState) {
  return { ...state.switches, order: state.order, agents: state.agents, configs: state.configs }
}

export function findAgentEntry(agents: TranslateAgentEntry[] | undefined, key: TranslateRunEngine): TranslateAgentEntry | null {
  const id = agentEntryId(key)
  return (id && agents?.find((a) => a.id === id)) || null
}

/** Settings that gate in-flight request count / character budget for an engine lane. */
export type EngineCapacitySettings = {
  allowConcurrency?: boolean
  concurrencyLimit?: number
  maxConcurrentChars?: number
}

export function resolveEngineCapacitySettings(
  engine: TranslateRunEngine,
  configs?: Partial<Record<TranslateBuiltinId, TranslateEngineSettings>>,
  agents?: TranslateAgentEntry[]
): EngineCapacitySettings {
  if (engine === 'ollama') return { allowConcurrency: false, concurrencyLimit: 1 }
  if (isBuiltinEngineId(engine)) {
    const cfg = configs?.[engine]
    return {
      allowConcurrency: cfg?.allowConcurrency,
      concurrencyLimit: cfg?.concurrencyLimit,
      maxConcurrentChars: cfg?.maxConcurrentChars,
    }
  }
  const entry = findAgentEntry(agents, engine)
  if (!entry) return {}
  return {
    allowConcurrency: entry.allowConcurrency,
    concurrencyLimit: entry.concurrencyLimit,
    maxConcurrentChars: entry.maxConcurrentChars,
  }
}

/** Tag agent translations with their instance ID so cache entries can be filtered by source. */
export function engineSourceTag(key: TranslateRunEngine, agents?: TranslateAgentEntry[]): string {
  const entry = findAgentEntry(agents, key)
  return entry ? `agent:${entry.profileId}` : key
}
