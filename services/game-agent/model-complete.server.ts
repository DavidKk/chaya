import { isCliProvider, isOpenApiProvider } from '@/lib/game-agent/providers'
import type { RuntimeMessage, RuntimeTool } from '@/lib/game-agent/runtime'

import { completeAnthropicChat, usesAnthropicApi } from './anthropic-client'
import { completeWithCli } from './cli/complete.server'
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

/** One model round for any agent type; `runAgentTurn` hosts call this instead of talking to Ollama directly. */
export function completeAgentModel(
  profile: GameAgentProfile,
  input: { model: string; messages: RuntimeMessage[]; tools: RuntimeTool[]; think?: boolean; format?: Record<string, unknown>; signal: AbortSignal }
): Promise<RuntimeMessage> {
  if (isCliProvider(profile.provider)) {
    return completeWithCli(
      { id: profile.id, provider: profile.provider, proxy: profile.proxy, proxyProtocols: profile.proxyProtocols, proxyHeaders: profile.proxyHeaders },
      { model: input.model, messages: input.messages, tools: input.tools, timeoutMs: profile.modelTimeoutMs, signal: input.signal }
    )
  }
  if (isOpenApiProvider(profile.provider)) {
    const token = readGameAgentToken(profile.id)
    const common = {
      endpoint: profile.endpoint,
      model: input.model,
      messages: input.messages as GameAgentMessage[],
      tools: asTools(input.tools),
      temperature: profile.temperature,
      timeoutMs: profile.modelTimeoutMs,
      token,
      signal: input.signal,
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
      temperature: profile.temperature,
      keepAlive: profile.keepAlive,
      timeoutMs: profile.modelTimeoutMs,
      think: input.think === true,
      ...(input.format ? { format: input.format } : {}),
      token: readGameAgentToken(profile.id),
      signal: input.signal,
    },
    () => undefined,
    ollamaFetch(profile)
  ) as Promise<RuntimeMessage>
}
