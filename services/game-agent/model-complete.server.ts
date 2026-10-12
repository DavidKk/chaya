import { isCliProvider } from '@/lib/game-agent/providers'
import type { RuntimeMessage, RuntimeTool } from '@/lib/game-agent/runtime'

import { completeWithCli } from './cli/complete.server'
import { streamOllamaChat } from './ollama-client'
import { ollamaFetch } from './proxy/agent-proxy'
import { readGameAgentToken } from './secrets'
import type { GameAgentProfile } from './settings'
import type { GameAgentMessage } from './types'

/** One model round for any agent type; `runAgentTurn` hosts call this instead of talking to Ollama directly. */
export function completeAgentModel(
  profile: GameAgentProfile,
  input: { model: string; messages: RuntimeMessage[]; tools: RuntimeTool[]; think?: boolean; format?: Record<string, unknown>; signal: AbortSignal }
): Promise<RuntimeMessage> {
  if (isCliProvider(profile.provider)) {
    return completeWithCli(
      { id: profile.id, provider: profile.provider, proxy: profile.proxy },
      { model: input.model, messages: input.messages, tools: input.tools, timeoutMs: profile.modelTimeoutMs, signal: input.signal }
    )
  }
  return streamOllamaChat(
    {
      endpoint: profile.endpoint,
      model: input.model,
      messages: input.messages as GameAgentMessage[],
      tools: input.tools.map((tool) => ({
        type: 'function' as const,
        function: { name: tool.name, description: tool.description || '', parameters: tool.inputSchema || { type: 'object', properties: {} } },
      })),
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
