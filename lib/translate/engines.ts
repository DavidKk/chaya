/** Translation engine definitions shared by the server, game plugin and web client. User-configured agent instances use agent:<id>; platform engines are Bing and Google. Fill jobs try agents before platform engines. */
export const TRANSLATE_ENGINE_IDS = ['bing', 'google'] as const
export type TranslateBuiltinId = (typeof TRANSLATE_ENGINE_IDS)[number]
export type TranslateEngineId = TranslateBuiltinId | `agent:${string}`
/** Local Ollama is used internally for play-mode latency checks and live dialogue, and is excluded from the engine list. */
export type TranslateRunEngine = TranslateEngineId | 'ollama'
export type TranslateEngineGroup = 'agent' | 'platform'
export type TranslateEngineSwitches = Record<TranslateBuiltinId, boolean>

export const TRANSLATE_GROUP_ORDER: TranslateEngineGroup[] = ['agent', 'platform']
export const DEFAULT_ENGINE_ORDER: TranslateEngineId[] = [...TRANSLATE_ENGINE_IDS]
export const DEFAULT_ENGINE_SWITCHES: TranslateEngineSwitches = { bing: true, google: true }

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
  return isBuiltinEngineId(key) ? 'platform' : 'agent'
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

export function normalizeEngineSwitches(raw: unknown): TranslateEngineSwitches {
  const src = asRecord(raw)
  return { bing: src.bing !== false, google: src.google !== false }
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
  const current = normalizeEngineSwitches(src)
  const switches = patch?.switches ? normalizeEngineSwitches({ ...current, ...patch.switches }) : current
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
