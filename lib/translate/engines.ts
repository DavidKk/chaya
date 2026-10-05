/**
 * 翻译引擎定义：服务端、游戏插件与 Web 共用。分两组：
 * - agent：大模型翻译，全部由用户添加 Agent 实例条目（`agent:<id>`）
 * - platform：真正的机器翻译平台（Bing / Google）
 * 补译时先按顺序试 Agent 组，再试平台组。
 */
export const TRANSLATE_ENGINE_IDS = ['bing', 'google'] as const
export type TranslateBuiltinId = (typeof TRANSLATE_ENGINE_IDS)[number]
export type TranslateEngineId = TranslateBuiltinId | `agent:${string}`
/** 本机 Ollama 只供游玩测速 / 实时对话内部直连，不出现在引擎列表 */
export type TranslateRunEngine = TranslateEngineId | 'ollama'
export type TranslateEngineGroup = 'agent' | 'platform'
export type TranslateEngineSwitches = Record<TranslateBuiltinId, boolean>

export const TRANSLATE_GROUP_ORDER: TranslateEngineGroup[] = ['agent', 'platform']
export const DEFAULT_ENGINE_ORDER: TranslateEngineId[] = [...TRANSLATE_ENGINE_IDS]
export const DEFAULT_ENGINE_SWITCHES: TranslateEngineSwitches = { bing: true, google: true }

/** 一条 Agent 翻译条目：引用 Agent 实例；model 空串表示用实例默认模型 */
export type TranslateAgentEntry = { id: string; profileId: string; model: string; enabled: boolean }
/** 单次 Agent 翻译请求用的实例与模型 */
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

/** 公网平台不接收敏感文本；Agent 与本机模型由用户自己配置 */
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

/** 只保留现存 key，缺的补到末尾（内置按默认顺序，Agent 按添加顺序） */
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
  /** 实际尝试顺序：先 Agent 组再平台组，组内按 order，只含已开启 */
  enabled: TranslateEngineId[]
}

export type TranslateEnginePatch = {
  switches?: Partial<TranslateEngineSwitches>
  order?: unknown
  /** 整表替换 */
  agents?: unknown
}

function isOn(key: TranslateEngineId, switches: TranslateEngineSwitches, agents: TranslateAgentEntry[]): boolean {
  if (isBuiltinEngineId(key)) return switches[key]
  const id = agentEntryId(key)
  return !!agents.find((a) => a.id === id)?.enabled
}

/** 合并磁盘内容与补丁；允许全部关闭（翻译时提示未开启平台） */
export function mergeEngineState(raw: unknown, patch?: TranslateEnginePatch): TranslateEngineState {
  const src = asRecord(raw)
  const current = normalizeEngineSwitches(src)
  const switches = patch?.switches ? normalizeEngineSwitches({ ...current, ...patch.switches }) : current
  const agents = normalizeAgentEntries(patch?.agents !== undefined ? patch.agents : src.agents)
  const order = normalizeEngineOrder(patch?.order ?? src.order, agents)
  const enabled = TRANSLATE_GROUP_ORDER.flatMap((group) => order.filter((key) => engineGroup(key) === group && isOn(key, switches, agents)))
  return { switches, agents, order, enabled }
}

/** 写盘内容：内置开关平铺 + order + agents（与旧文件兼容） */
export function engineStateFileBody(state: TranslateEngineState) {
  return { ...state.switches, order: state.order, agents: state.agents }
}

export function findAgentEntry(agents: TranslateAgentEntry[] | undefined, key: TranslateRunEngine): TranslateAgentEntry | null {
  const id = agentEntryId(key)
  return (id && agents?.find((a) => a.id === id)) || null
}

/** 译文来源标记：Agent 条目记实例 id，便于翻译库按来源筛选 */
export function engineSourceTag(key: TranslateRunEngine, agents?: TranslateAgentEntry[]): string {
  const entry = findAgentEntry(agents, key)
  return entry ? `agent:${entry.profileId}` : key
}
