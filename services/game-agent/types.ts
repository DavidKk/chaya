export type GameAgentMode = 'ask' | 'play'

export type OllamaModel = { name: string; size?: number; modifiedAt?: string }

export type GameAgentMessage = { role: 'user' | 'assistant' | 'system'; content: string }

export type GameAgentSession = {
  id: string
  gameId: string
  model: string
  profileId: string
  messages: GameAgentMessage[]
  activeTurnId: string | null
  updatedAt: number
}

export type GameAgentTurn = {
  id: string
  sessionId: string
  gameId: string
  abort: AbortController
  state: 'running' | 'completed' | 'stopped' | 'failed'
  startedAt: number
}

export type GameAgentEvent =
  | { type: 'turn.started'; turnId: string; sessionId: string }
  | { type: 'phase'; phase: 'observing' | 'thinking'; step: number; maxSteps: number }
  | { type: 'assistant.delta'; text: string }
  | { type: 'turn.completed'; text: string; reason: 'answered' }
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
}
