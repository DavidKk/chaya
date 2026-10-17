import { executeRegisteredPageTool, listRegisteredPageTools } from '@/initializer/webmcp/register-page-tools'
import { browserAgentTraceArchive } from '@/lib/browser/agent-trace-store'
import { sanitizeAgentActivity } from '@/lib/game-agent/activity'
import { RECALL_TOOL_DESCRIPTION, RECALL_TOOL_NAME, RECALL_TOOL_PROPERTIES, recallTurns, turnsFromMessages } from '@/lib/game-agent/recall'
import { type AgentTask, capabilityConfig, runAgentTurn, type RuntimeEvent, type RuntimeMessage, type RuntimeTool } from '@/lib/game-agent/runtime'
import { collectSecretValues, redactSecrets, redactSecretText } from '@/lib/integration/tools/types'
import { appendBrowserLog } from '@/lib/log/link-log-store'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import { buildAskMessages } from '@/services/game-agent/prompt'
import type { GameAgentEvent, GameAgentMessage } from '@/services/game-agent/types'

import type { BrowserAgentProfile } from './browserRequest'

type BrowserSession = { id: string; messages: GameAgentMessage[] }

/** Not sent to the model; kept for chaya_agent_recall. */
const SESSION_MESSAGE_LIMIT = 200

const RECALL_TOOL: RuntimeTool = { name: RECALL_TOOL_NAME, description: RECALL_TOOL_DESCRIPTION, inputSchema: { type: 'object', properties: RECALL_TOOL_PROPERTIES } }

function id(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function asTools(): RuntimeTool[] {
  return listRegisteredPageTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

function toolSucceeded(result: unknown) {
  return !(result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false)
}

export function createBrowserAgentRuntime() {
  const sessions = new Map<string, BrowserSession>()
  const turns = new Map<string, AbortController>()
  let latestSessionId = ''

  const stop = (turnId: string) => {
    const controller = turns.get(turnId)
    if (!controller) return false
    controller.abort(new DOMException('Stopped', 'AbortError'))
    turns.delete(turnId)
    return true
  }

  const stopAll = () => {
    const ids = [...turns.keys()]
    for (const turnId of ids) stop(turnId)
    return ids.length
  }

  const start = (input: {
    profile: BrowserAgentProfile
    gameId?: string
    model: string
    prompt: string
    locale: string
    surface?: 'companion'
    companionCharacter?: import('@/lib/game-agent/companion').CompanionCharacter
    sessionId?: string
    newSession?: boolean
    signal?: AbortSignal | null
  }) => {
    const known = !input.newSession && input.sessionId ? sessions.get(input.sessionId) : undefined
    const session = known || { id: id('session'), messages: [] }
    sessions.set(session.id, session)
    latestSessionId = session.id
    const turnId = id('turn')
    const traceTask: AgentTask = {
      id: turnId,
      gameId: input.gameId || 'cloud-game',
      conversationId: session.id,
      capability: 'companion' as const,
      profileId: input.profile.id,
      model: input.model,
      locale: input.locale,
      surface: input.surface,
      state: 'running' as const,
      goal: input.prompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastSeq: 0,
      events: [],
      messages: [],
      persistence: 'durable' as const,
    }
    const controller = new AbortController()
    turns.set(turnId, controller)
    input.signal?.addEventListener('abort', () => controller.abort(input.signal?.reason), { once: true })

    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        const encoder = new TextEncoder()
        let closed = false
        const emit = (event: GameAgentEvent) => {
          if (closed) return
          const traceEvent = { seq: ++traceTask.lastSeq, type: event.type, at: Date.now(), data: event }
          traceTask.updatedAt = traceEvent.at
          if (event.type === 'turn.completed') traceTask.state = 'completed'
          else if (event.type === 'turn.failed') traceTask.state = 'failed'
          else if (event.type === 'turn.stopped') traceTask.state = 'stopped'
          void browserAgentTraceArchive.append(traceTask, traceEvent)
          streamController.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
          if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.stopped') {
            closed = true
            turns.delete(turnId)
            streamController.close()
          }
        }

        void (async () => {
          emit({ type: 'turn.started', turnId, sessionId: session.id })
          const messages = buildAskMessages({
            prompt: input.prompt,
            locale: input.locale,
            gameId: input.gameId || undefined,
            surface: input.surface,
            companionCharacter: input.companionCharacter,
          })
          const credentials = new Set<string>()
          const runtimeTools = [...asTools(), RECALL_TOOL]
          const result = await runAgentTurn(
            {
              model: {
                complete: async (runtimeMessages, tools, signal) =>
                  (await streamOllamaChat(
                    {
                      endpoint: input.profile.endpoint,
                      model: input.model,
                      messages: runtimeMessages as GameAgentMessage[],
                      tools: tools.map((tool) => ({
                        type: 'function' as const,
                        function: { name: tool.name, description: tool.description || '', parameters: tool.inputSchema || {} },
                      })),
                      temperature: input.profile.temperature,
                      keepAlive: input.profile.keepAlive,
                      timeoutMs: input.profile.modelTimeoutMs,
                      signal,
                    },
                    () => {}
                  )) as RuntimeMessage,
              },
              tools: {
                list: () => runtimeTools,
                call: async (name, args) => {
                  collectSecretValues(args, credentials)
                  const callId = `${Date.now()}-${name}`
                  const startedAt = Date.now()
                  appendBrowserLog({
                    level: 'info',
                    source: 'ChayaAgent',
                    message: `tool.started ${name}`,
                    meta: { event: 'tool.started', callId, tool: name, args: redactSecrets(args), turnId, sessionId: session.id, model: input.model },
                  })
                  const value =
                    name === RECALL_TOOL_NAME ? recallTurns(turnsFromMessages(session.messages, { id: session.id, at: 0 }), args) : await executeRegisteredPageTool(name, args)
                  const ok = toolSucceeded(value)
                  appendBrowserLog({
                    level: ok ? 'ok' : 'fail',
                    source: 'ChayaAgent',
                    message: `tool.completed ${name} ${ok ? 'ok' : 'failed'}`,
                    meta: { event: 'tool.completed', callId, tool: name, ok, durationMs: Date.now() - startedAt, turnId, sessionId: session.id, model: input.model },
                  })
                  return redactSecrets(value)
                },
              },
              store: {
                append: (next) => {
                  session.messages.push(...(next.map((message) => ({ ...message, content: redactSecretText(message.content, credentials) })) as GameAgentMessage[]))
                  session.messages = session.messages.slice(-SESSION_MESSAGE_LIMIT)
                },
              },
              events: { emit: (event: RuntimeEvent) => emit(sanitizeAgentActivity(event, credentials) as GameAgentEvent) },
              clock: { now: Date.now },
            },
            capabilityConfig('ask'),
            {
              model: `${input.profile.provider}/${input.model}`,
              prompt: input.prompt,
              modelPrompt: String(messages.at(-1)?.content || input.prompt),
              storePrompt: input.prompt,
              history: messages.slice(0, -1) as RuntimeMessage[],
            },
            controller.signal
          )
          let answer = result.text
          answer = redactSecretText(answer, credentials)
          emit({ type: 'assistant.delta', text: answer })
          emit({ type: 'turn.completed', text: answer, reason: result.reason === 'limit' ? 'limit_reached' : 'answered' })
        })().catch((error: unknown) => {
          if (controller.signal.aborted) emit({ type: 'turn.stopped' })
          else emit({ type: 'turn.failed', code: 'AGENT_TURN_FAILED', message: error instanceof Error ? error.message : String(error) })
        })
      },
      cancel() {
        stop(turnId)
      },
    })
    return new Response(stream, { headers: { 'Cache-Control': 'no-cache, no-transform', 'Content-Type': 'text/event-stream; charset=utf-8' } })
  }

  return { start, stop, stopAll, latestSession: () => (latestSessionId ? sessions.get(latestSessionId) : undefined) }
}
