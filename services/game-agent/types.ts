export type GameAgentMode = 'ask' | 'play'

/** `name` is the id sent back to the provider; `label` is the display name when the id is not readable (CLI types). */
export type OllamaModel = { name: string; label?: string; size?: number; modifiedAt?: string; capabilities?: string[] }

export type OllamaToolCall = {
  function: { name: string; arguments: Record<string, unknown> }
}

export type OllamaTool = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type GameAgentMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: string[]
  tool_calls?: OllamaToolCall[]
  tool_name?: string
  usage?: import('@/lib/game-agent/activity').AgentTokenUsage
}

export type GameAgentSession = {
  id: string
  gameId: string
  model: string
  profileId: string
  messages: GameAgentMessage[]
  activeTurnId: string | null
  lastTurnId?: string
  updatedAt: number
}

export type GameAgentTurn = {
  id: string
  sessionId: string
  gameId: string
  abort: AbortController
  state: 'running' | 'waiting_user' | 'completed' | 'stopped' | 'failed'
  startedAt: number
  goal?: string
  phase?: string
  question?: string
  lastSeq: number
  events: SequencedGameAgentEvent[]
  listeners: Set<(event: SequencedGameAgentEvent) => void>
  reply?: string
  replyId?: string
  resume?: () => void
}

export type SequencedGameAgentEvent = GameAgentEvent & { seq: number }

export type GameAgentEvent =
  | { type: 'turn.started'; turnId: string; sessionId: string }
  | { type: 'phase'; phase: 'observing' | 'thinking' | 'acting' | 'verifying' | 'waiting_user'; step: number; maxSteps: number }
  | { type: 'goal.updated'; summary: string }
  | { type: 'approval.required'; question: string; card?: import('@/lib/game-agent/player-card').PlayerCard }
  | { type: 'card.shown'; card: import('@/lib/game-agent/player-card').PlayerCard }
  | { type: 'user.replied'; text: string }
  | { type: 'history.gap'; fromSeq: number }
  | { type: 'prompt.recorded'; role: 'system' | 'user'; content: string }
  | { type: 'model.requested'; model?: string; messageCount: number; contextChars?: number }
  | { type: 'model.completed'; model?: string; text: string; usage?: import('@/lib/game-agent/activity').AgentTokenUsage; durationMs: number }
  | { type: 'thought.updated'; summary: import('@/lib/game-agent/activity').AgentThoughtSummary }
  | { type: 'tool.started'; callId: string; name: string; input?: Record<string, unknown>; startedAt?: number }
  | { type: 'tool.completed'; callId: string; name: string; ok: boolean; output?: unknown; durationMs?: number }
  | { type: 'progress.updated'; summary: string; cycle: number; reason?: string; steps?: number; toolCalls?: number }
  | { type: 'assistant.delta'; text: string }
  /** `brief`: one-line result for the companion chat, built from structured parts instead of parsing `text`. */
  | { type: 'turn.completed'; text: string; brief?: string; reason: 'answered' | 'verified' | 'limit_reached' }
  | { type: 'turn.stopped' }
  | { type: 'turn.failed'; code: string; message: string }

export type StartTurnInput = {
  gameId: string
  sessionId?: string
  newSession?: boolean
  model: string
  profileId: string
  mode: GameAgentMode
  prompt: string
  locale?: string
  surface?: string
  companionCharacter?: string
}
