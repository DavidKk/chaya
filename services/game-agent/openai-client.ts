import type { AgentTokenUsage } from '@/lib/game-agent/activity'
import { isOpenApiGatewayEndpoint, type OpenApiAgentProvider } from '@/lib/game-agent/providers'

import type { GameAgentMessage, OllamaModel, OllamaTool, OllamaToolCall } from './types'

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function baseUrl(endpoint: string) {
  return endpoint.replace(/\/$/, '')
}

/**
 * OpenAI-compatible fetch headers (web-scripts `buildAgentLlmFetchHeaders`).
 * Bearer only when a token is set; gateway / proxy headers merge on top and may override Authorization.
 */
export function buildOpenApiFetchHeaders(input: { token?: string; requestHeaders?: Record<string, string>; contentType?: string }): Record<string, string> {
  const headers: Record<string, string> = {}
  if (input.contentType) headers['Content-Type'] = input.contentType
  const token = input.token?.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  if (input.requestHeaders) {
    for (const [name, value] of Object.entries(input.requestHeaders)) {
      const key = name.trim()
      if (!key || value == null || value === '') continue
      headers[key] = value
    }
  }
  return headers
}

/** When the profile uses a custom OpenAPI base, attach `proxyHeaders` to the LLM request (gateway auth). */
export function openApiGatewayRequestHeaders(
  provider: OpenApiAgentProvider,
  endpoint: string,
  proxyHeaders: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!isOpenApiGatewayEndpoint(provider, endpoint)) return undefined
  if (!proxyHeaders || !Object.keys(proxyHeaders).length) return undefined
  return proxyHeaders
}

/** List models from an OpenAI-compatible `/v1/models` endpoint. */
export async function listOpenAiModels(
  endpoint: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  token?: string,
  requestHeaders?: Record<string, string>
): Promise<OllamaModel[]> {
  let response: Response
  try {
    response = await fetcher(`${baseUrl(endpoint)}/models`, {
      signal,
      cache: 'no-store',
      headers: buildOpenApiFetchHeaders({ token, requestHeaders }),
    })
  } catch (error) {
    throw new Error(`无法连接 OpenAPI 服务：${messageFrom(error)}`)
  }
  if (!response.ok) throw new Error(`OpenAPI 模型列表请求失败（HTTP ${response.status}）`)
  const body = (await response.json()) as { data?: Array<{ id?: unknown }> }
  const models = (body.data ?? [])
    .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
    .filter(Boolean)
    .map((name) => ({ name }))
  return models.sort((a, b) => a.name.localeCompare(b.name))
}

type OpenAiToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: string } }

function toOpenAiMessages(messages: GameAgentMessage[]) {
  let callSeq = 0
  const pendingIds: string[] = []
  return messages.map((message) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const tool_calls = message.tool_calls.map((call) => {
        const id = `call_${callSeq++}`
        pendingIds.push(id)
        return {
          id,
          type: 'function' as const,
          function: { name: call.function.name, arguments: JSON.stringify(call.function.arguments || {}) },
        }
      })
      return { role: 'assistant' as const, content: message.content || null, tool_calls }
    }
    if (message.role === 'tool') {
      const id = pendingIds.shift()
      return id
        ? { role: 'tool' as const, content: message.content, tool_call_id: id }
        : { role: 'user' as const, content: `Tool observation (${message.tool_name || 'state'}):\n${message.content}` }
    }
    return { role: message.role, content: message.content }
  })
}

function normalizeToolCall(raw: OpenAiToolCall): OllamaToolCall | null {
  const name = typeof raw.function?.name === 'string' ? raw.function.name.trim() : ''
  if (!name) return null
  const rawArgs = raw.function?.arguments
  if (typeof rawArgs === 'string' && rawArgs.trim()) {
    try {
      const parsed = JSON.parse(rawArgs) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { function: { name, arguments: parsed as Record<string, unknown> } }
    } catch {
      return { function: { name, arguments: {} } }
    }
  }
  return { function: { name, arguments: {} } }
}

/** One non-streaming OpenAI-compatible chat completion round (tools included). */
export async function completeOpenAiChat(
  input: {
    endpoint: string
    model: string
    messages: GameAgentMessage[]
    tools?: OllamaTool[]
    temperature?: number
    timeoutMs?: number
    token?: string
    requestHeaders?: Record<string, string>
    signal?: AbortSignal
  },
  fetcher: typeof fetch = fetch
): Promise<GameAgentMessage> {
  const requestSignal = input.timeoutMs
    ? input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)])
      : AbortSignal.timeout(input.timeoutMs)
    : input.signal
  let response: Response
  try {
    response = await fetcher(`${baseUrl(input.endpoint)}/chat/completions`, {
      method: 'POST',
      headers: buildOpenApiFetchHeaders({
        token: input.token,
        requestHeaders: input.requestHeaders,
        contentType: 'application/json',
      }),
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature ?? 0.2,
        messages: toOpenAiMessages(input.messages),
        ...(input.tools?.length
          ? {
              tools: input.tools.map((tool) => ({
                type: 'function',
                function: { name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters },
              })),
            }
          : {}),
      }),
      signal: requestSignal,
    })
  } catch (error) {
    if (requestSignal?.aborted) throw requestSignal.reason ?? new DOMException('Aborted', 'AbortError')
    throw new Error(`无法连接 OpenAPI 服务（${input.endpoint}）：${messageFrom(error)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `OpenAPI 请求失败（HTTP ${response.status}）`)
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: OpenAiToolCall[] } }>
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
  }
  const message = body.choices?.[0]?.message
  const content = typeof message?.content === 'string' ? message.content : ''
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls.map(normalizeToolCall).filter((call): call is OllamaToolCall => !!call) : []
  let usage: AgentTokenUsage | undefined
  if (body.usage) {
    const inputTokens = typeof body.usage.prompt_tokens === 'number' ? body.usage.prompt_tokens : undefined
    const outputTokens = typeof body.usage.completion_tokens === 'number' ? body.usage.completion_tokens : undefined
    const total = typeof body.usage.total_tokens === 'number' ? body.usage.total_tokens : (inputTokens || 0) + (outputTokens || 0)
    if (inputTokens !== undefined || outputTokens !== undefined) usage = { input: inputTokens, output: outputTokens, total }
  }
  return { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...(usage ? { usage } : {}) }
}
