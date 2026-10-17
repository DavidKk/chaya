export type AgentCapability = 'play' | 'ask' | 'companion'
import type { AgentModelTiming, AgentThoughtSummary, AgentTokenUsage } from '@/lib/game-agent/activity'
import type { GameplayActivityEvent } from '@/lib/game-agent/gameplay-activity'

export type RuntimeMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_name?: string
  tool_calls?: RuntimeToolCall[]
  /** Model reasoning. Shown in the chat log; omitted when this message is sent back to the model. */
  thought?: string
  usage?: AgentTokenUsage
  timing?: AgentModelTiming
}
export type RuntimeToolCall = { id?: string; function: { name: string; arguments: Record<string, unknown> } }
export type RuntimeTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; groups?: string[] }
export type RuntimeEvent =
  | { type: 'phase'; phase: 'observing' | 'thinking' | 'acting' | 'verifying'; step: number; maxSteps: number }
  | { type: 'prompt.recorded'; role: 'system' | 'user'; content: string }
  | { type: 'model.requested'; model?: string; messageCount: number; contextChars?: number; startedAt?: number; contextDurationMs?: number }
  | { type: 'model.completed'; model?: string; text: string; thought?: string; usage?: AgentTokenUsage; timing?: AgentModelTiming; durationMs: number }
  | { type: 'thought.updated'; summary: AgentThoughtSummary }
  | { type: 'tool.started'; name: string; callId: string; stepId?: string; actionId?: string; input: Record<string, unknown>; startedAt: number }
  | { type: 'tool.completed'; name: string; callId: string; stepId?: string; actionId?: string; ok: boolean; output: unknown; durationMs: number }
  | GameplayActivityEvent

export type AgentHost = {
  model: { complete: (messages: RuntimeMessage[], tools: RuntimeTool[], signal: AbortSignal) => Promise<RuntimeMessage> }
  tools: { list: () => Promise<RuntimeTool[]> | RuntimeTool[]; call: (name: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown> }
  store: { append: (messages: RuntimeMessage[]) => Promise<void> | void }
  events: { emit: (event: RuntimeEvent) => void }
  clock: { now: () => number }
}

/** 不经模型、由游戏内宿主按固定步骤执行的托管目标 */
export type AgentRoutine =
  | { kind: 'chest'; mapId: number; eventId: number; x: number; y: number }
  | { kind: 'save'; slot: number }
  | { kind: 'load'; slot: number }
  | { kind: 'openScene'; scene: 'status' | 'equip' | 'skill' | 'item' | 'menu' | 'load' | 'save' }

export function parseAgentRoutine(value: unknown): AgentRoutine | null {
  const routine = value as Partial<AgentRoutine> | null
  if (!routine) return null
  if (routine.kind === 'save' || routine.kind === 'load') {
    const slot = Number((routine as { slot?: unknown }).slot)
    return Number.isInteger(slot) && slot >= 1 ? { kind: routine.kind, slot } : null
  }
  if (routine.kind === 'openScene') {
    const scene = (routine as { scene?: unknown }).scene
    return typeof scene === 'string' && ['status', 'equip', 'skill', 'item', 'menu', 'load', 'save'].includes(scene)
      ? { kind: 'openScene', scene: scene as Extract<AgentRoutine, { kind: 'openScene' }>['scene'] }
      : null
  }
  if (routine.kind !== 'chest') return null
  const numbers = [routine.mapId, routine.eventId, routine.x, routine.y]
  if (!numbers.every((item) => Number.isInteger(item) && (item as number) >= 0)) return null
  return { kind: 'chest', mapId: routine.mapId!, eventId: routine.eventId!, x: routine.x!, y: routine.y! }
}

export type RuntimeCapabilityConfig = {
  capability: AgentCapability
  maxSteps: number
  maxToolCalls: number
  allowTool: (tool: RuntimeTool) => boolean
}

export type TurnResult = { text: string; steps: number; toolCalls: number; reason: 'answered' | 'limit' | 'no_progress' | 'unsupported'; usage?: AgentTokenUsage }
