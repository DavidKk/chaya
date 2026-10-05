import { callAgentGame, resolveAgentGame } from '@/services/runtime/agent-bridge'

import { streamOllamaChat } from './ollama-client'
import { buildAskMessages } from './prompt'
import { finishTurn } from './session-store'
import type { GameAgentProfile } from './settings'
import type { GameAgentEvent, GameAgentSession, GameAgentTurn, StartTurnInput } from './types'

export async function runAskTurn(input: StartTurnInput, profile: GameAgentProfile, session: GameAgentSession, turn: GameAgentTurn, emit: (event: GameAgentEvent) => void) {
  try {
    emit({ type: 'phase', phase: 'observing', step: 0, maxSteps: 1 })
    const gameId = resolveAgentGame(input.gameId)
    const state = await callAgentGame(gameId, 'game.state', {})
    if (turn.abort.signal.aborted) throw turn.abort.signal.reason

    emit({ type: 'phase', phase: 'thinking', step: 1, maxSteps: 1 })
    const messages = buildAskMessages({ history: session.messages, prompt: input.prompt, locale: input.locale || 'zh-CN', gameId, state })
    const answer = await streamOllamaChat(
      { endpoint: profile.endpoint, model: input.model, messages, temperature: profile.temperature, keepAlive: profile.keepAlive, signal: turn.abort.signal },
      (text) => emit({ type: 'assistant.delta', text })
    )

    session.messages.push({ role: 'user', content: input.prompt }, { role: 'assistant', content: answer })
    session.messages = session.messages.slice(-12)
    finishTurn(turn, 'completed')
    emit({ type: 'turn.completed', text: answer, reason: 'answered' })
  } catch (error) {
    if (turn.abort.signal.aborted || turn.state === 'stopped') {
      finishTurn(turn, 'stopped')
      emit({ type: 'turn.stopped' })
      return
    }
    finishTurn(turn, 'failed')
    emit({ type: 'turn.failed', code: 'AGENT_TURN_FAILED', message: error instanceof Error ? error.message : String(error) })
  }
}
