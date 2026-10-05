import { appendLog } from '@/services/log'
import { callAgentGame, listAgentGames } from '@/services/runtime/agent-bridge'

import { streamOllamaChat } from './ollama-client'
import { buildAskMessages } from './prompt'
import { finishTurn } from './session-store'
import type { GameAgentProfile } from './settings'
import { createGameAgentTools, executeGameAgentTool } from './tool-runtime.server'
import type { GameAgentEvent, GameAgentSession, GameAgentTurn, StartTurnInput } from './types'

const MAX_TOOL_STEPS = 8

function logArgs(args: Record<string, unknown>) {
  const text = JSON.stringify(args)
  return text.length <= 2_000 ? args : { clipped: `${text.slice(0, 2_000)}...` }
}

export async function runAskTurn(input: StartTurnInput, profile: GameAgentProfile, session: GameAgentSession, turn: GameAgentTurn, emit: (event: GameAgentEvent) => void) {
  try {
    emit({ type: 'phase', phase: 'observing', step: 0, maxSteps: MAX_TOOL_STEPS })
    const requestedGameId = input.gameId === 'chaya-console' ? '' : input.gameId
    const gameId = requestedGameId && listAgentGames().some((game) => game.gameId === requestedGameId) ? requestedGameId : undefined
    const state = gameId ? await callAgentGame(gameId, 'game.state', {}) : undefined
    if (turn.abort.signal.aborted) throw turn.abort.signal.reason

    const messages = buildAskMessages({ history: session.messages, prompt: input.prompt, locale: input.locale || 'zh-CN', gameId, state })
    const gameTools = createGameAgentTools(gameId)
    const tools = gameTools.map((tool) => tool.definition)
    let answer = ''

    for (let step = 1; step <= MAX_TOOL_STEPS; step += 1) {
      emit({ type: 'phase', phase: 'thinking', step, maxSteps: MAX_TOOL_STEPS })
      const message = await streamOllamaChat(
        { endpoint: profile.endpoint, model: input.model, messages, tools, temperature: profile.temperature, keepAlive: profile.keepAlive, signal: turn.abort.signal },
        () => {}
      )
      messages.push(message)
      if (!message.tool_calls?.length) {
        answer = message.content.trim()
        if (answer) break
        messages.push({ role: 'user', content: 'Give a concise final answer based only on the tool results above. Do not claim unverified success.' })
        continue
      }
      for (const [index, call] of message.tool_calls.entries()) {
        if (turn.abort.signal.aborted) throw turn.abort.signal.reason
        const callId = `${step}-${index}`
        const startedAt = Date.now()
        appendLog({
          level: 'info',
          source: 'ChayaAgent',
          message: `tool.started ${call.function.name}`,
          meta: {
            event: 'tool.started',
            callId,
            tool: call.function.name,
            args: logArgs(call.function.arguments),
            turnId: turn.id,
            sessionId: session.id,
            gameId: gameId || null,
            model: input.model,
          },
        })
        emit({ type: 'tool.started', callId, name: call.function.name })
        const result = await executeGameAgentTool(gameTools, call.function.name, call.function.arguments, gameId, turn.abort.signal)
        messages.push({ role: 'tool', tool_name: call.function.name, content: result.content })
        emit({ type: 'tool.completed', callId, name: call.function.name, ok: result.ok })
        appendLog({
          level: result.ok ? 'ok' : 'fail',
          source: 'ChayaAgent',
          message: `tool.completed ${call.function.name} ${result.ok ? 'ok' : 'failed'}`,
          meta: {
            event: 'tool.completed',
            callId,
            tool: call.function.name,
            ok: result.ok,
            durationMs: Date.now() - startedAt,
            turnId: turn.id,
            sessionId: session.id,
            gameId: gameId || null,
            model: input.model,
          },
        })
      }
    }

    if (!answer) {
      messages.push({ role: 'user', content: 'The tool step limit was reached. Briefly report what was verified and what remains incomplete. Do not call more tools.' })
      const final = await streamOllamaChat(
        { endpoint: profile.endpoint, model: input.model, messages, temperature: 0, keepAlive: profile.keepAlive, signal: turn.abort.signal },
        () => {}
      )
      answer = final.content.trim() || '操作未完成：已达到工具调用步数上限。'
    }

    emit({ type: 'assistant.delta', text: answer })

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
