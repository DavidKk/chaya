/**
 * Companion T3 short generation + semantic route over the shared resource queue.
 * No tools. Real streaming only when the provider emits deltas; otherwise whole-response.
 */

import { COMPANION_ROUTE_FORMAT, COMPANION_ROUTE_SYSTEM, parseCompanionRoute } from '@/lib/game-agent/companion/router'
import { isCliProvider, isOpenApiProvider } from '@/lib/game-agent/providers'
import type { RuntimeMessage } from '@/lib/game-agent/runtime'

import { completeAnthropicChat, usesAnthropicApi } from './anthropic-client'
import { completeWithCli } from './cli/complete.server'
import { inspectCompanionCapabilities, resolveCompanionThinking } from './companion-capabilities.server'
import { companionResourceKey, scheduleCompanionResource } from './companion-resource.server'
import {
  COMPANION_DEFAULT_BUDGETS,
  type CompanionChatMessage,
  type CompanionChatRequest,
  type CompanionChatResult,
  type CompanionGenerationMode,
  type CompanionModelBudgets,
  type CompanionModelEvent,
  CompanionModelFailure,
  type CompanionModelPriority,
  type CompanionModelPurpose,
  type CompanionProviderCapabilities,
  type CompanionRouteDecision,
  type CompanionRouteRequest,
  type CompanionRouteResult,
  type CompanionThinkingControl,
} from './companion-types.server'
import { completeGeminiChat, usesGeminiOpenAiCompat } from './gemini-client'
import { streamOllamaChat } from './ollama-client'
import { completeOpenAiChat, openApiGatewayRequestHeaders } from './openai-client'
import { ollamaFetch } from './proxy/agent-proxy'
import { readGameAgentToken } from './secrets'
import type { GameAgentProfile } from './settings'
import type { GameAgentMessage } from './types'

export type CompleteCompanionModelInput = {
  model: string
  messages: Array<Pick<GameAgentMessage, 'role' | 'content'> & { role: 'system' | 'user' | 'assistant' | 'tool'; tool_name?: string }>
  /** Prefer false for companion short turns. */
  think?: boolean
  signal: AbortSignal
  purpose: CompanionModelPurpose
  requestId: string
  /** Isolates CLI / conversation context; not mixed into the resourceKey. */
  conversationKey?: string
  format?: Record<string, unknown>
  /** Real deltas only. Whole-response providers never synthesize chunk events. */
  onDelta?: (text: string) => void
  onEvent?: (event: CompanionModelEvent) => void
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  firstTokenTimeoutMs?: number
  priority?: CompanionModelPriority
}

function purposePriority(purpose: CompanionModelPurpose): CompanionModelPriority {
  if (purpose === 'control') return 'control'
  if (purpose === 'companion-prepare') return 'background'
  return 'foreground'
}

function defaultBudgets(purpose: CompanionModelPurpose): CompanionModelBudgets {
  if (purpose === 'companion-route') return { contextChars: COMPANION_DEFAULT_BUDGETS.contextChars, ...COMPANION_DEFAULT_BUDGETS.route }
  if (purpose === 'companion-prepare') return { contextChars: COMPANION_DEFAULT_BUDGETS.contextChars, ...COMPANION_DEFAULT_BUDGETS.prepare }
  if (purpose === 'control') {
    return { contextChars: COMPANION_DEFAULT_BUDGETS.contextChars, maxOutputTokens: 384, totalTimeoutMs: 120_000 }
  }
  return { contextChars: COMPANION_DEFAULT_BUDGETS.contextChars, ...COMPANION_DEFAULT_BUDGETS.chat }
}

function clipText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  if (maxChars <= 1) return text.slice(0, Math.max(0, maxChars))
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

function trimMessages(messages: CompanionChatMessage[], contextChars: number): CompanionChatMessage[] {
  const budget = Math.max(0, contextChars)
  if (!messages.length || budget === 0) return []
  const source = messages.map((message) => ({ role: message.role, content: message.content }))
  const systemIndex = source.findIndex((message) => message.role === 'system')
  const system = systemIndex >= 0 ? source[systemIndex]! : null
  const rest = systemIndex >= 0 ? source.filter((_, index) => index !== systemIndex) : source

  // Reserve room for the newest user/assistant turn first, then fit system, then older turns.
  const newest = rest.length ? [{ ...rest[rest.length - 1]! }] : []
  if (newest[0] && newest[0].content.length > budget) newest[0].content = clipText(newest[0].content, budget)
  let used = newest.reduce((sum, message) => sum + message.content.length, 0)

  let systemMessage: CompanionChatMessage | null = null
  if (system) {
    const remaining = Math.max(0, budget - used)
    if (remaining > 0) {
      systemMessage = { role: 'system', content: clipText(system.content, remaining) }
      used += systemMessage.content.length
    }
  }

  const older: CompanionChatMessage[] = []
  for (let i = rest.length - 2; i >= 0; i--) {
    const item = rest[i]!
    const remaining = budget - used
    if (remaining <= 0) break
    if (item.content.length > remaining) {
      older.unshift({ role: item.role, content: clipText(item.content, remaining) })
      used = budget
      break
    }
    older.unshift({ ...item })
    used += item.content.length
  }
  return [...(systemMessage ? [systemMessage] : []), ...older, ...newest]
}

function withNoThinkHint(messages: CompanionChatMessage[], applyHint: boolean): CompanionChatMessage[] {
  if (!applyHint) return messages
  const cloned = messages.map((message) => ({ ...message }))
  const first = cloned.find((message) => message.role === 'system') || cloned[0]
  if (!first) return cloned
  if (!/^\/no_think\b/.test(first.content)) first.content = `/no_think\n${first.content}`
  return cloned
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'AbortError')
  )
}

function asFailure(error: unknown, requestId: string, resourceKey: string): CompanionModelFailure {
  if (error instanceof CompanionModelFailure) return error
  if (isAbortError(error)) {
    const message = error instanceof Error ? error.message : 'Request cancelled'
    if (/timeout/i.test(message)) {
      return new CompanionModelFailure({
        code: 'MODEL_TIMEOUT',
        message,
        retryable: true,
        requestId,
        resourceKey,
      })
    }
    return new CompanionModelFailure({
      code: 'CANCELLED',
      message,
      retryable: false,
      requestId,
      resourceKey,
    })
  }
  const message = error instanceof Error ? error.message : String(error)
  const timeout = /timeout|timed out|TimeoutError/i.test(message)
  return new CompanionModelFailure({
    code: timeout ? 'MODEL_TIMEOUT' : 'MODEL_UNAVAILABLE',
    message,
    retryable: timeout,
    requestId,
    resourceKey,
  })
}

async function invokeCompanionUpstream(
  profile: GameAgentProfile,
  input: {
    model: string
    messages: CompanionChatMessage[]
    think: boolean
    format?: Record<string, unknown>
    temperature?: number
    maxTokens?: number
    timeoutMs: number
    signal: AbortSignal
    conversationKey?: string
    onDelta?: (text: string) => void
  }
): Promise<{ mode: CompanionGenerationMode; message: GameAgentMessage }> {
  const token = readGameAgentToken(profile.id)
  const fetcher = ollamaFetch(profile)
  if (profile.provider === 'ollama') {
    const message = await streamOllamaChat(
      {
        endpoint: profile.endpoint,
        model: input.model,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        think: input.think,
        keepAlive: profile.keepAlive,
        timeoutMs: input.timeoutMs,
        token,
        signal: input.signal,
        ...(input.format ? { format: input.format } : {}),
      },
      (delta) => {
        input.onDelta?.(delta)
      },
      fetcher
    )
    return { mode: 'streaming', message }
  }

  // Whole-response paths: never invent deltas.
  if (isCliProvider(profile.provider)) {
    // conversationKey is host-level session identity; CLI complete already uses once-scope processes
    // and must not reuse tool-bearing companion warm sessions. Key is accepted for parent tracing.
    void input.conversationKey
    const message = await completeWithCli(
      { id: profile.id, provider: profile.provider, proxy: profile.proxy, proxyProtocols: profile.proxyProtocols, proxyHeaders: profile.proxyHeaders },
      {
        model: input.model,
        messages: input.messages as RuntimeMessage[],
        tools: [],
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      }
    )
    return { mode: 'whole', message: message as GameAgentMessage }
  }

  if (isOpenApiProvider(profile.provider)) {
    const common = {
      endpoint: profile.endpoint,
      model: input.model,
      messages: input.messages as GameAgentMessage[],
      temperature: input.temperature ?? profile.temperature,
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs,
      token,
      signal: input.signal,
    }
    if (profile.provider === 'cc' && usesAnthropicApi(profile.endpoint)) {
      return { mode: 'whole', message: await completeAnthropicChat(common, fetcher) }
    }
    if (profile.provider === 'gemini-api' && !usesGeminiOpenAiCompat(profile.endpoint)) {
      return { mode: 'whole', message: await completeGeminiChat({ ...common, proxyHeaders: profile.proxyHeaders }, fetcher) }
    }
    return {
      mode: 'whole',
      message: await completeOpenAiChat(
        {
          ...common,
          requestHeaders: openApiGatewayRequestHeaders(profile.provider, profile.endpoint, profile.proxyHeaders),
        },
        fetcher
      ),
    }
  }

  throw new CompanionModelFailure({
    code: 'CAPABILITY_UNSUPPORTED',
    message: `Unsupported companion provider: ${profile.provider}`,
    retryable: false,
  })
}

function emit(onEvent: ((event: CompanionModelEvent) => void) | undefined, event: CompanionModelEvent) {
  onEvent?.(event)
}

/**
 * Tool-free companion/control short completion with shared fair queue.
 * Parent `/api/game-agent/model` should call this for companion-* and may also use it for control.
 */
export async function completeCompanionModel(profile: GameAgentProfile, input: CompleteCompanionModelInput): Promise<GameAgentMessage> {
  const capabilities = inspectCompanionCapabilities(profile, input.model)
  const resourceKey = capabilities.resourceKey || companionResourceKey(profile, input.model)
  const priority = input.priority || purposePriority(input.purpose)
  const defaults = defaultBudgets(input.purpose)
  const budgets: CompanionModelBudgets = {
    contextChars: defaults.contextChars,
    maxOutputTokens: input.maxTokens ?? defaults.maxOutputTokens,
    totalTimeoutMs: input.timeoutMs ?? defaults.totalTimeoutMs,
    firstTokenTimeoutMs: input.firstTokenTimeoutMs ?? defaults.firstTokenTimeoutMs,
  }
  const thinking = resolveCompanionThinking(capabilities, input.think === true ? false : true)
  const messages = withNoThinkHint(
    trimMessages(
      input.messages
        .filter((message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ role: message.role as 'system' | 'user' | 'assistant', content: message.content })),
      budgets.contextChars
    ),
    thinking.mode === 'prompt_hint_only' && thinking.requested
  )

  emit(input.onEvent, { type: 'accepted', requestId: input.requestId, resourceKey, capabilities, conversationKey: input.conversationKey })

  const waitedFrom = Date.now()
  let partial = ''
  let deltaSeq = 0
  let firstTokenMs: number | undefined
  try {
    const result = await scheduleCompanionResource({
      resourceKey,
      requestId: input.requestId,
      priority,
      signal: input.signal,
      totalTimeoutMs: budgets.totalTimeoutMs,
      onQueued: (position) => emit(input.onEvent, { type: 'queued', requestId: input.requestId, resourceKey, position, priority }),
      run: async (slotSignal) => {
        const waitedMs = Date.now() - waitedFrom
        const remaining = Math.max(1, budgets.totalTimeoutMs - waitedMs)
        const timeoutSignal = AbortSignal.timeout(remaining)
        const combined = AbortSignal.any([slotSignal, timeoutSignal, input.signal].filter(Boolean) as AbortSignal[])
        emit(input.onEvent, {
          type: 'started',
          requestId: input.requestId,
          resourceKey,
          mode: capabilities.streaming ? 'streaming' : 'whole',
          thinking,
          waitedMs,
        })

        let firstTokenTimer: ReturnType<typeof setTimeout> | undefined
        const firstTokenController = new AbortController()
        if (capabilities.streaming && budgets.firstTokenTimeoutMs && budgets.firstTokenTimeoutMs > 0) {
          const firstRemaining = budgets.firstTokenTimeoutMs - waitedMs
          if (firstRemaining <= 0) {
            firstTokenController.abort(new DOMException('First token timeout', 'AbortError'))
          } else {
            firstTokenTimer = setTimeout(() => firstTokenController.abort(new DOMException('First token timeout', 'AbortError')), firstRemaining)
          }
        }
        const upstreamSignal = AbortSignal.any([combined, firstTokenController.signal])

        try {
          const upstream = await invokeCompanionUpstream(profile, {
            model: input.model,
            messages,
            // Ollama `think` enables reasoning. When disable was applied, force false; otherwise leave on only if caller asked.
            think: thinking.mode === 'supported' ? !thinking.requested : false,
            format: input.format,
            temperature: input.temperature ?? (input.purpose === 'companion-chat' ? profile.temperature : 0),
            maxTokens: budgets.maxOutputTokens,
            timeoutMs: remaining,
            signal: upstreamSignal,
            conversationKey: input.conversationKey,
            onDelta: (text) => {
              if (!text) return
              if (firstTokenMs === undefined) {
                // Includes queue wait — matches “from send” first-token budget.
                firstTokenMs = Date.now() - waitedFrom
                if (firstTokenTimer) clearTimeout(firstTokenTimer)
              }
              partial += text
              deltaSeq += 1
              input.onDelta?.(text)
              emit(input.onEvent, { type: 'delta', requestId: input.requestId, seq: deltaSeq, text })
            },
          })
          // Whole-response providers never synthesize onDelta chunks.
          return { waitedMs, message: upstream.message, mode: upstream.mode }
        } finally {
          if (firstTokenTimer) clearTimeout(firstTokenTimer)
        }
      },
    })

    const text = result.message.content || ''
    emit(input.onEvent, {
      type: 'completed',
      requestId: input.requestId,
      mode: result.mode,
      text,
      thought: result.message.thought,
      usage: result.message.usage,
      timing: result.message.timing,
      durationMs: Date.now() - waitedFrom,
      firstTokenMs,
      thinking,
    })
    return result.message
  } catch (error) {
    const failure = asFailure(error, input.requestId, resourceKey)
    if (failure.error.code === 'CANCELLED') {
      emit(input.onEvent, {
        type: 'cancelled',
        requestId: input.requestId,
        partialText: partial || undefined,
        cancelConfirmed: true,
      })
    } else {
      emit(input.onEvent, { type: 'failed', requestId: input.requestId, error: failure.error, partialText: partial || undefined })
    }
    throw failure
  }
}

export async function runCompanionChat(profile: GameAgentProfile, request: CompanionChatRequest): Promise<CompanionChatResult> {
  const started = Date.now()
  const capabilities = inspectCompanionCapabilities(profile, request.model)
  const thinking = resolveCompanionThinking(capabilities, request.disableThinking !== false)
  let waitedMs = 0
  const onEvent = (event: CompanionModelEvent) => {
    if (event.type === 'started') waitedMs = event.waitedMs
    request.onEvent?.(event)
  }
  const message = await completeCompanionModel(profile, {
    model: request.model,
    messages: request.messages,
    think: request.disableThinking === false,
    signal: request.signal || new AbortController().signal,
    purpose: 'companion-chat',
    requestId: request.requestId,
    format: request.responseSchema,
    onEvent,
    temperature: request.temperature,
    maxTokens: request.budgets?.maxOutputTokens,
    timeoutMs: request.budgets?.totalTimeoutMs,
    firstTokenTimeoutMs: request.budgets?.firstTokenTimeoutMs,
    priority: request.priority,
  })
  return {
    requestId: request.requestId,
    text: message.content || '',
    thought: message.thought,
    mode: capabilities.streaming ? 'streaming' : 'whole',
    capabilities,
    thinking,
    usage: message.usage,
    timing: message.timing,
    durationMs: Date.now() - started,
    waitedMs,
  }
}

function toRouteDecision(content: string, prompt: string): { decision: CompanionRouteDecision; structured: boolean } {
  const routed = parseCompanionRoute(content, prompt)
  if (routed.target === 'companion_chat') return { decision: { kind: 'chat', prompt: routed.prompt }, structured: true }
  if (routed.target === 'clarification') return { decision: { kind: 'clarification', question: routed.question }, structured: true }
  return {
    decision: {
      kind: 'control',
      goal: routed.goal,
      action: routed.action,
      shape: routed.shape,
      lifetime: routed.lifetime,
    },
    structured: true,
  }
}

/** Semantic route call: one short structured generation, no tools, whole-response OK. Reuses lib router prompt/schema/parse. */
export async function runCompanionRoute(profile: GameAgentProfile, request: CompanionRouteRequest): Promise<CompanionRouteResult> {
  const started = Date.now()
  const capabilities = inspectCompanionCapabilities(profile, request.model)
  const thinking = resolveCompanionThinking(capabilities, request.disableThinking !== false)
  let waitedMs = 0
  const onEvent = (event: CompanionModelEvent) => {
    if (event.type === 'started') waitedMs = event.waitedMs
    request.onEvent?.(event)
  }
  const user = JSON.stringify({
    request: request.text,
    ...(request.context ? { context: request.context.slice(0, 4_000) } : {}),
  })
  const message = await completeCompanionModel(profile, {
    model: request.model,
    messages: [
      { role: 'system', content: `/no_think\n${COMPANION_ROUTE_SYSTEM}` },
      { role: 'user', content: user },
    ],
    think: false,
    signal: request.signal || new AbortController().signal,
    purpose: 'companion-route',
    requestId: request.requestId,
    format: capabilities.structuredOutput === 'native' ? { ...COMPANION_ROUTE_FORMAT } : undefined,
    onEvent,
    temperature: 0,
    maxTokens: request.budgets?.maxOutputTokens ?? COMPANION_DEFAULT_BUDGETS.route.maxOutputTokens,
    timeoutMs: request.budgets?.totalTimeoutMs ?? COMPANION_DEFAULT_BUDGETS.route.totalTimeoutMs,
  })
  const raw = message.content || ''
  // parseCompanionRoute treats malformed output as clarification (never silent chat authorization).
  const looksStructured = (() => {
    try {
      JSON.parse(
        raw
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
      )
      return true
    } catch {
      return false
    }
  })()
  const parsed = toRouteDecision(raw, request.text)
  return {
    requestId: request.requestId,
    decision: parsed.decision,
    rawText: raw,
    structured: looksStructured,
    capabilities,
    thinking,
    durationMs: Date.now() - started,
    waitedMs,
  }
}

export function getCompanionModelCapabilities(profile: GameAgentProfile, model?: string): CompanionProviderCapabilities {
  return inspectCompanionCapabilities(profile, model)
}

export type { CompanionModelEvent, CompanionModelPurpose, CompanionProviderCapabilities, CompanionThinkingControl }
