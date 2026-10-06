export type GameAgentMode = 'ask' | 'play'

export type OllamaModel = { name: string; size?: number; modifiedAt?: string; capabilities?: string[] }

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
  | { type: 'approval.required'; question: string }
  | { type: 'history.gap'; fromSeq: number }
  | { type: 'tool.started'; callId: string; name: string }
  | { type: 'tool.completed'; callId: string; name: string; ok: boolean }
  | { type: 'assistant.delta'; text: string }
  | { type: 'turn.completed'; text: string; reason: 'answered' | 'verified' | 'limit_reached' }
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
  surface?: 'companion'
  companionCharacter?: import('@/lib/game-agent/companion').CompanionCharacter
}
