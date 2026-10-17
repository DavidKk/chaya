import { sanitizeAgentActivity } from '@/lib/game-agent/activity'
import { RECALL_TOOL_NAME, recallTurns, turnsFromMessages } from '@/lib/game-agent/recall'
import { collectSecretValues, redactSecrets, redactSecretText } from '@/lib/integration/tools/types'
import { appendLog } from '@/services/log'
import { listAgentGames } from '@/services/runtime/agent-bridge'

import { completeAgentModel } from './model-complete.server'
import { buildAskMessages } from './prompt'
import { finishTurn } from './session-store'
import type { GameAgentProfile } from './settings'
import { createGameAgentTools, executeGameAgentTool } from './tool-runtime.server'
import type { GameAgentEvent, GameAgentSession, GameAgentTurn, StartTurnInput } from './types'

/** Not sent to the model; kept for chaya_agent_recall. */
const SESSION_MESSAGE_LIMIT = 200

function logArgs(args: Record<string, unknown>) {
  const safe = redactSecrets(args)
  const text = JSON.stringify(safe)
  return text.length <= 2_000 ? safe : { clipped: `${text.slice(0, 2_000)}...` }
}

export async function runAskTurn(
  input: StartTurnInput,
  profile: GameAgentProfile,
  session: GameAgentSession,
  turn: GameAgentTurn,
  emit: (event: GameAgentEvent) => void,
  gameReadOnly = false
) {
  try {
    const requestedGameId = input.gameId === 'chaya-console' ? '' : input.gameId
    const gameId = requestedGameId && listAgentGames().some((game) => game.gameId === requestedGameId) ? requestedGameId : undefined
    if (turn.abort.signal.aborted) throw turn.abort.signal.reason

    const messages = buildAskMessages({
      prompt: input.prompt,
      locale: input.locale || 'zh-CN',
      gameId,
      surface: input.surface === 'companion' ? 'companion' : undefined,
      companionCharacter: input.companionCharacter as import('@/lib/game-agent/companion').CompanionCharacter | undefined,
    })
    const gameTools = createGameAgentTools(gameId, profile.gameCallTimeoutMs)
      .filter((tool) => !gameReadOnly || tool.readOnly || tool.definition.function.name.startsWith('chaya_agent_'))
      .map((tool) =>
        tool.definition.function.name === RECALL_TOOL_NAME
          ? { ...tool, run: async (args: Record<string, unknown>) => recallTurns(turnsFromMessages(session.messages, { id: session.id, at: 0 }), args) }
          : tool
      )
    const credentials = new Set<string>()
    const result = await runAgentTurn(
      {
        model: {
          complete: (runtimeMessages, runtimeTools, signal) => completeAgentModel(profile, { model: input.model, messages: runtimeMessages, tools: runtimeTools, signal }),
        },
        tools: {
          list: () =>
            gameTools.map((tool) => ({
              name: tool.definition.function.name,
              description: tool.definition.function.description,
              inputSchema: tool.definition.function.parameters,
            })),
          call: async (name, args, signal) => {
            collectSecretValues(args, credentials)
            const startedAt = Date.now()
            appendLog({
              level: 'info',
              source: 'ChayaAgent',
              message: `tool.started ${name}`,
              meta: { event: 'tool.started', tool: name, args: logArgs(args), turnId: turn.id, sessionId: session.id, gameId: gameId || null, model: input.model },
            })
            const toolResult =
              profile.gameCallTimeoutMs === undefined
                ? await executeGameAgentTool(gameTools, name, args, gameId, signal)
                : await executeGameAgentTool(gameTools, name, args, gameId, signal, profile.gameCallTimeoutMs)
            appendLog({
              level: toolResult.ok ? 'ok' : 'fail',
              source: 'ChayaAgent',
              message: `tool.completed ${name} ${toolResult.ok ? 'ok' : 'failed'}`,
              meta: {
                event: 'tool.completed',
                tool: name,
                ok: toolResult.ok,
                durationMs: Date.now() - startedAt,
                turnId: turn.id,
                sessionId: session.id,
                gameId: gameId || null,
                model: input.model,
              },
            })
            try {
              return JSON.parse(toolResult.content)
            } catch {
              return toolResult.content
            }
          },
        },
        store: {
          append: (next) => {
            session.messages.push(...(next.map((message) => ({ ...message, content: redactSecretText(message.content, credentials) })) as import('./types').GameAgentMessage[]))
            session.messages = session.messages.slice(-SESSION_MESSAGE_LIMIT)
          },
        },
        events: { emit: (event: RuntimeEvent) => emit(sanitizeAgentActivity(event, credentials) as GameAgentEvent) },
        clock: { now: Date.now },
      },
      capabilityConfig('ask'),
      {
        model: `${profile.provider}/${input.model}`,
        prompt: input.prompt,
        modelPrompt: String(messages.at(-1)?.content || input.prompt),
        storePrompt: input.prompt,
        history: messages.slice(0, -1) as RuntimeMessage[],
      },
      turn.abort.signal
    )
    const answer = redactSecretText(result.text, credentials)
    emit({ type: 'assistant.delta', text: answer })
    finishTurn(turn, 'completed')
    emit({ type: 'turn.completed', text: answer, reason: result.reason === 'limit' ? 'limit_reached' : 'answered' })
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
import { capabilityConfig, runAgentTurn, type RuntimeEvent, type RuntimeMessage } from '@/lib/game-agent/runtime'
