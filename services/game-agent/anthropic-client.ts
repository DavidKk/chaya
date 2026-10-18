import type { GameAgentMessage, OllamaModel, OllamaTool } from './types'

type Input = {
  endpoint: string
  model: string
  messages: GameAgentMessage[]
  tools?: OllamaTool[]
  token?: string
  timeoutMs?: number
  signal?: AbortSignal
  requestHeaders?: Record<string, string>
}

/** Custom gateways retain the existing OpenAI-compatible contract. */
export function usesAnthropicApi(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === 'api.anthropic.com'
  } catch {
    return false
  }
}

function headers(token?: string, extra?: Record<string, string>) {
  return { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(token?.trim() ? { 'x-api-key': token.trim() } : {}), ...extra }
}

export async function listAnthropicModels(endpoint: string, fetcher: typeof fetch = fetch, signal?: AbortSignal, token?: string): Promise<OllamaModel[]> {
  const models: OllamaModel[] = []
  let after = ''
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${endpoint.replace(/\/+$/, '')}/models`)
    url.searchParams.set('limit', '1000')
    if (after) url.searchParams.set('after_id', after)
    const response = await fetcher(url.toString(), { headers: headers(token), signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`Claude model list request failed (HTTP ${response.status})`)
    const body = (await response.json()) as { data?: Array<{ id: string; display_name?: string }>; has_more?: boolean; last_id?: string }
    for (const item of body.data || []) if (typeof item.id === 'string') models.push({ name: item.id, ...(item.display_name ? { label: item.display_name } : {}) })
    if (!body.has_more || !body.last_id || body.last_id === after) break
    after = body.last_id
  }
  return models
}

export async function completeAnthropicChat(input: Input, fetcher: typeof fetch = fetch): Promise<GameAgentMessage> {
  const pending: string[] = []
  let seq = 0
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = []
  const system: string[] = []
  for (const message of input.messages) {
    if (message.role === 'system') {
      system.push(message.content)
      continue
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const content: unknown[] = []
    if (message.role === 'tool') {
      const id = pending.shift()
      content.push(
        id ? { type: 'tool_result', tool_use_id: id, content: message.content } : { type: 'text', text: `Tool observation (${message.tool_name || 'state'}):\n${message.content}` }
      )
    } else {
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const call of message.tool_calls || []) {
        const id = `tool_${seq++}`
        pending.push(id)
        content.push({ type: 'tool_use', id, name: call.function.name, input: call.function.arguments || {} })
      }
    }
    if (!content.length) continue
    const previous = messages.at(-1)
    if (previous?.role === role) previous.content.push(...content)
    else messages.push({ role, content })
  }
  const signal = input.timeoutMs ? AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(input.timeoutMs)]) : input.signal
  const response = await fetcher(`${input.endpoint.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers: headers(input.token, input.requestHeaders),
    signal,
    body: JSON.stringify({
      model: input.model,
      max_tokens: 8192,
      messages,
      ...(system.length ? { system: system.join('\n\n') } : {}),
      ...(input.tools?.length
        ? { tools: input.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })) }
        : {}),
    }),
  })
  if (!response.ok) throw new Error((await response.text().catch(() => '')) || `Claude 请求失败（HTTP ${response.status}）`)
  const body = (await response.json()) as {
    content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const content = (body.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
  const toolCalls = (body.content || [])
    .filter((block) => block.type === 'tool_use' && block.name)
    .map((block) => ({ function: { name: block.name!, arguments: block.input || {} } }))
  if (!content && !toolCalls.length) throw new Error('Claude returned empty response')
  return {
    role: 'assistant',
    content,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    ...(body.usage ? { usage: { input: body.usage.input_tokens, output: body.usage.output_tokens, total: (body.usage.input_tokens || 0) + (body.usage.output_tokens || 0) } } : {}),
  }
}
