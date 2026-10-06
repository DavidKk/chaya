import { AGENT_INPUT_KEYS, type AgentInputKey, type AgentParams, type AgentReactionCue } from '@/lib/runtime/agent-protocol'

type Scope = { battleInstanceId: string | null; mapId: number | null; manualInputEpoch: number }
type Arm = AgentParams<'input.reaction.arm'> & { startedAt: number; manualInputEpoch: number; seen: Set<string> }
type QteSource = (() => unknown) & { lastResult?: { id: string; result: string } }

function source(): QteSource | undefined {
  if (typeof window === 'undefined') return (globalThis as typeof globalThis & { ChayaAgentQteSource?: QteSource }).ChayaAgentQteSource
  return (window as Window & { ChayaAgentQteSource?: QteSource }).ChayaAgentQteSource
}

let active: Arm | null = null
let frame = 0
let getScope: (() => Scope) | null = null
let press: ((key: AgentInputKey) => Promise<unknown>) | null = null
let lastReaction: { id: string; key: AgentInputKey; latencyMs: number | null } | null = null

export function currentReactionCue(): AgentReactionCue | null {
  const current = source()
  if (typeof current !== 'function') return null
  try {
    const value = current()
    if (!value || typeof value !== 'object') return null
    const item = value as Partial<AgentReactionCue>
    return typeof item.id === 'string' && AGENT_INPUT_KEYS.includes(item.key as AgentInputKey) && Number.isFinite(item.expiresAt) ? (item as AgentReactionCue) : null
  } catch {
    return null
  }
}

function tick() {
  frame = requestAnimationFrame(tick)
  const policy = active
  if (!policy || !getScope || !press) return
  const scope = getScope()
  if (
    Date.now() - policy.startedAt >= policy.ttlMs ||
    scope.battleInstanceId !== policy.battleInstanceId ||
    (policy.mapId != null && scope.mapId !== policy.mapId) ||
    scope.manualInputEpoch !== policy.manualInputEpoch
  ) {
    active = null
    return
  }
  const observation = currentReactionCue()
  if (!observation || !policy.allowedKeys.includes(observation.key) || observation.expiresAt <= Date.now() || policy.seen.has(observation.id)) return
  policy.seen.add(observation.id)
  lastReaction = { id: observation.id, key: observation.key, latencyMs: Number.isFinite(observation.startedAt) ? Date.now() - observation.startedAt! : null }
  void press(observation.key).catch(() => {})
}

export function startReactionMonitor(scope: () => Scope, send: (key: AgentInputKey) => Promise<unknown>): () => void {
  getScope = scope
  press = send
  frame = requestAnimationFrame(tick)
  return () => {
    active = null
    cancelAnimationFrame(frame)
    getScope = null
    press = null
  }
}

export function reactionAvailable(): boolean {
  return typeof source() === 'function'
}

export function reactionResult() {
  return lastReaction
}

export function reactionOutcome() {
  const result = source()?.lastResult
  return result && typeof result.id === 'string' && ['success', 'missed'].includes(result.result) ? result : null
}

export function armReaction(params: AgentParams<'input.reaction.arm'>) {
  if (!getScope || !press || !reactionAvailable()) throw new Error('当前游戏没有可读取的快速反应信号')
  const scope = getScope()
  if (scope.battleInstanceId !== params.battleInstanceId || (params.mapId != null && scope.mapId !== params.mapId)) throw new Error('SCOPE_CHANGED')
  if (!Array.isArray(params.allowedKeys) || !Number.isFinite(params.ttlMs) || params.ttlMs <= 0) throw new Error('快速反应参数无效')
  const allowedKeys = params.allowedKeys.filter((key) => ['ok', 'cancel', 'shift', 'up', 'down', 'left', 'right'].includes(key))
  if (!allowedKeys.length || allowedKeys.length !== params.allowedKeys.length) throw new Error('没有允许的快速反应按键')
  lastReaction = null
  active = { ...params, allowedKeys, ttlMs: Math.min(300_000, Math.max(1, params.ttlMs)), startedAt: Date.now(), manualInputEpoch: scope.manualInputEpoch, seen: new Set() }
  return { armed: true }
}

export function stopReaction() {
  active = null
  return { armed: false }
}
