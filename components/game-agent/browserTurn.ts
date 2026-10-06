import { executeRegisteredPageTool, listRegisteredPageTools } from '@/initializer/webmcp/register-page-tools'
import type { CompanionCharacter } from '@/lib/game-agent/companion'
import { collectSecretValues, redactSecrets, redactSecretText } from '@/lib/integration/tools/types'
import { appendBrowserLog } from '@/lib/log/link-log-store'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import { buildAskMessages, shouldOfferAgentTools } from '@/services/game-agent/prompt'
import type { GameAgentEvent, GameAgentMessage, OllamaTool } from '@/services/game-agent/types'

import type { BrowserAgentProfile } from './browserRequest'

const MAX_TOOL_STEPS = 8
const RESULT_LIMIT = 16_000

type BrowserSession = { id: string; messages: GameAgentMessage[] }

function id(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function clipped(value: unknown) {
  const raw = JSON.stringify(value)
  return raw.length <= RESULT_LIMIT ? raw : `${raw.slice(0, RESULT_LIMIT)}...`
}

function asTools(): OllamaTool[] {
  return listRegisteredPageTools().map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
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

  const start = (input: {
    profile: BrowserAgentProfile
    model: string
    prompt: string
    locale: string
    sessionId?: string
    newSession?: boolean
    surface?: 'companion'
    companionCharacter?: CompanionCharacter
    signal?: AbortSignal | null
  }) => {
    const known = !input.newSession && input.sessionId ? sessions.get(input.sessionId) : undefined
    const session = known || { id: id('session'), messages: [] }
    sessions.set(session.id, session)
    latestSessionId = session.id
    const turnId = id('turn')
    const controller = new AbortController()
    turns.set(turnId, controller)
    input.signal?.addEventListener('abort', () => controller.abort(input.signal?.reason), { once: true })

    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        const encoder = new TextEncoder()
        let closed = false
        const emit = (event: GameAgentEvent) => {
          if (closed) return
          streamController.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
          if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.stopped') {
            closed = true
            turns.delete(turnId)
            streamController.close()
          }
        }

        void (async () => {
          emit({ type: 'turn.started', turnId, sessionId: session.id })
          emit({ type: 'phase', phase: 'observing', step: 0, maxSteps: MAX_TOOL_STEPS })
          const messages = buildAskMessages({
            history: session.messages,
            prompt: input.prompt,
            locale: input.locale,
            surface: input.surface,
            companionCharacter: input.companionCharacter,
          })
          const tools = shouldOfferAgentTools(input.prompt) ? asTools() : []
          const credentials = new Set<string>()
          let answer = ''
          for (let step = 1; step <= MAX_TOOL_STEPS; step += 1) {
            emit({ type: 'phase', phase: 'thinking', step, maxSteps: MAX_TOOL_STEPS })
            const message = await streamOllamaChat(
              {
                endpoint: input.profile.endpoint,
                model: input.model,
                messages,
                tools,
                temperature: input.profile.temperature,
                keepAlive: input.profile.keepAlive,
                signal: controller.signal,
              },
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
              collectSecretValues(call.function.arguments, credentials)
              const callId = `${step}-${index}`
              const startedAt = Date.now()
              appendBrowserLog({
                level: 'info',
                source: 'ChayaAgent',
                message: `tool.started ${call.function.name}`,
                meta: { event: 'tool.started', callId, tool: call.function.name, args: redactSecrets(call.function.arguments), turnId, sessionId: session.id, model: input.model },
              })
              emit({ type: 'tool.started', callId, name: call.function.name })
              let result: unknown
              try {
                result = await executeRegisteredPageTool(call.function.name, call.function.arguments)
              } catch (error) {
                result = { ok: false, error: error instanceof Error ? error.message : String(error) }
              }
              const ok = toolSucceeded(result)
              appendBrowserLog({
                level: ok ? 'ok' : 'fail',
                source: 'ChayaAgent',
                message: `tool.completed ${call.function.name} ${ok ? 'ok' : 'failed'}`,
                meta: { event: 'tool.completed', callId, tool: call.function.name, ok, durationMs: Date.now() - startedAt, turnId, sessionId: session.id, model: input.model },
              })
              // eslint-disable-next-line no-console -- Edge has no server log store; keep Agent tool calls inspectable in DevTools.
              console.info('[ChayaAgent]', 'tool.completed', { tool: call.function.name, args: redactSecrets(call.function.arguments), ok })
              messages.push({ role: 'tool', tool_name: call.function.name, content: clipped(redactSecrets(result)) })
              emit({ type: 'tool.completed', callId, name: call.function.name, ok })
            }
          }
          if (!answer) {
            const final = await streamOllamaChat(
              {
                endpoint: input.profile.endpoint,
                model: input.model,
                messages: [...messages, { role: 'user', content: 'Briefly report what was verified and what remains incomplete. Do not call more tools.' }],
                temperature: 0,
                keepAlive: input.profile.keepAlive,
                signal: controller.signal,
              },
              () => {}
            )
            answer = final.content.trim() || '操作未完成：已达到工具调用步数上限。'
          }
          answer = redactSecretText(answer, credentials)
          session.messages.push({ role: 'user', content: redactSecretText(input.prompt, credentials) }, { role: 'assistant', content: answer })
          session.messages = session.messages.slice(-12)
          emit({ type: 'assistant.delta', text: answer })
          emit({ type: 'turn.completed', text: answer, reason: 'answered' })
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

  return { start, stop, latestSession: () => (latestSessionId ? sessions.get(latestSessionId) : undefined) }
}
