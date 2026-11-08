import { isCliProvider, isOpenApiProvider } from '@/lib/game-agent/providers'
import type { RuntimeMessage, RuntimeTool } from '@/lib/game-agent/runtime'

import { completeAnthropicChat, usesAnthropicApi } from './anthropic-client'
import { completeWithCli } from './cli/complete.server'
import { companionResourceKey, scheduleCompanionResource } from './companion-resource.server'
import { completeGeminiChat, usesGeminiOpenAiCompat } from './gemini-client'
import { streamOllamaChat } from './ollama-client'
import { completeOpenAiChat, openApiGatewayRequestHeaders } from './openai-client'
import { ollamaFetch } from './proxy/agent-proxy'
import { readGameAgentToken } from './secrets'
import type { GameAgentProfile } from './settings'
import type { GameAgentMessage } from './types'

function asTools(tools: RuntimeTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description || '', parameters: tool.inputSchema || { type: 'object', properties: {} } },
  }))
}

/** Upstream call without the shared companion/control resource queue. */
export function rawCompleteAgentModel(
  profile: GameAgentProfile,
  input: {
    model: string
    messages: RuntimeMessage[]
    tools: RuntimeTool[]
    think?: boolean
    format?: Record<string, unknown>
    signal: AbortSignal
    temperature?: number
    maxTokens?: number
    timeoutMs?: number
  }
): Promise<RuntimeMessage> {
  if (isCliProvider(profile.provider)) {
    return completeWithCli(
      { id: profile.id, provider: profile.provider, proxy: profile.proxy, proxyProtocols: profile.proxyProtocols, proxyHeaders: profile.proxyHeaders },
      { model: input.model, messages: input.messages, tools: input.tools, timeoutMs: input.timeoutMs ?? profile.modelTimeoutMs, signal: input.signal }
    )
  }
  if (isOpenApiProvider(profile.provider)) {
    const token = readGameAgentToken(profile.id)
    const common = {
      endpoint: profile.endpoint,
      model: input.model,
      messages: input.messages as GameAgentMessage[],
      tools: asTools(input.tools),
      temperature: input.temperature ?? profile.temperature,
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs ?? profile.modelTimeoutMs,
      token,
      signal: input.signal,
      format: input.format,
    }
    if (profile.provider === 'cc' && usesAnthropicApi(profile.endpoint)) return completeAnthropicChat(common, ollamaFetch(profile)) as Promise<RuntimeMessage>
    if (profile.provider === 'gemini-api' && !usesGeminiOpenAiCompat(profile.endpoint)) {
      return completeGeminiChat({ ...common, proxyHeaders: profile.proxyHeaders }, ollamaFetch(profile)) as Promise<RuntimeMessage>
    }
    return completeOpenAiChat(
      {
        ...common,
        requestHeaders: openApiGatewayRequestHeaders(profile.provider, profile.endpoint, profile.proxyHeaders),
      },
      ollamaFetch(profile)
    ) as Promise<RuntimeMessage>
  }
  return streamOllamaChat(
    {
      endpoint: profile.endpoint,
      model: input.model,
      messages: input.messages as GameAgentMessage[],
      tools: asTools(input.tools),
      temperature: input.temperature ?? profile.temperature,
      maxTokens: input.maxTokens,
      keepAlive: profile.keepAlive,
      timeoutMs: input.timeoutMs ?? profile.modelTimeoutMs,
      think: input.think === true,
      ...(input.format ? { format: input.format } : {}),
      token: readGameAgentToken(profile.id),
      signal: input.signal,
    },
    () => undefined,
    ollamaFetch(profile)
  ) as Promise<RuntimeMessage>
}

let managedRequestSeq = 0

/**
 * One model round for managed / ask turns.
 * Shares the companion resource queue (control priority) so chat and control cannot bypass each other.
 * Callers that already hold a companion queue slot must use `rawCompleteAgentModel` instead.
 */
export function completeAgentModel(
  profile: GameAgentProfile,
  input: {
    model: string
    messages: RuntimeMessage[]
    tools: RuntimeTool[]
    think?: boolean
    format?: Record<string, unknown>
    signal: AbortSignal
    requestId?: string
    temperature?: number
    maxTokens?: number
    timeoutMs?: number
  }
): Promise<RuntimeMessage> {
  const requestId = input.requestId || `managed:${profile.id}:${++managedRequestSeq}`
  const resourceKey = companionResourceKey(profile, input.model)
  return scheduleCompanionResource({
    resourceKey,
    requestId,
    priority: 'control',
    signal: input.signal,
    totalTimeoutMs: input.timeoutMs ?? profile.modelTimeoutMs,
    run: (slotSignal) =>
      rawCompleteAgentModel(profile, {
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        think: input.think,
        format: input.format,
        signal: slotSignal,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
      }),
  })
}
