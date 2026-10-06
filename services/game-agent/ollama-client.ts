import type { GameAgentMessage, OllamaModel, OllamaTool, OllamaToolCall } from './types'

export const DEFAULT_GAME_AGENT_MODEL = 'qwen3:4b'
export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function authorizationHeaders(token?: string) {
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

export async function listOllamaModels(endpoint = DEFAULT_OLLAMA_HOST, fetcher: typeof fetch = fetch, signal?: AbortSignal, token?: string): Promise<OllamaModel[]> {
  let response: Response
  try {
    response = await fetcher(`${endpoint.replace(/\/$/, '')}/api/tags`, { signal, cache: 'no-store', headers: authorizationHeaders(token) })
  } catch (error) {
    throw new Error(`无法连接 Ollama：${messageFrom(error)}`)
  }
  if (!response.ok) throw new Error(`Ollama 模型列表请求失败（HTTP ${response.status}）`)
  const body = (await response.json()) as { models?: Array<{ name?: unknown; size?: unknown; modified_at?: unknown; capabilities?: unknown }> }
  return (body.models ?? [])
    .filter((item) => typeof item.name === 'string' && item.name.trim())
    .map((item) => ({
      name: String(item.name),
      size: typeof item.size === 'number' ? item.size : undefined,
      modifiedAt: typeof item.modified_at === 'string' ? item.modified_at : undefined,
      capabilities: Array.isArray(item.capabilities) ? item.capabilities.filter((value): value is string => typeof value === 'string') : undefined,
    }))
}

export async function readOllamaModelCapabilities(
  model: string,
  endpoint = DEFAULT_OLLAMA_HOST,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  token?: string
): Promise<string[]> {
  const response = await fetcher(`${endpoint.replace(/\/$/, '')}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders(token) },
    body: JSON.stringify({ model }),
    signal,
  })
  if (!response.ok) throw new Error(`Ollama 模型详情请求失败（HTTP ${response.status}）`)
  const body = (await response.json()) as { capabilities?: unknown }
  return Array.isArray(body.capabilities) ? body.capabilities.filter((value): value is string => typeof value === 'string') : []
}

export function pickDefaultModel(models: OllamaModel[]): string {
  return models.some((model) => model.name === DEFAULT_GAME_AGENT_MODEL) ? DEFAULT_GAME_AGENT_MODEL : models[0]?.name || ''
}

export function pickAvailableModel(models: OllamaModel[], preferred?: string): string {
  return preferred && models.some((model) => model.name === preferred) ? preferred : pickDefaultModel(models)
}

export async function streamOllamaChat(
  input: {
    endpoint?: string
    model: string
    messages: GameAgentMessage[]
    tools?: OllamaTool[]
    format?: 'json' | Record<string, unknown>
    temperature?: number
    maxTokens?: number
    think?: boolean
    keepAlive?: string
    token?: string
    signal?: AbortSignal
  },
  onDelta: (text: string) => void,
  fetcher: typeof fetch = fetch
): Promise<GameAgentMessage> {
  let response: Response
  try {
    response = await fetcher(`${(input.endpoint || DEFAULT_OLLAMA_HOST).replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authorizationHeaders(input.token) },
      body: JSON.stringify({
        model: input.model,
        stream: true,
        think: input.think === true,
        messages: input.think ? input.messages.map((message) => ({ ...message, content: message.content.replace(/^\/no_think\s*\n/, '') })) : input.messages,
        ...(input.tools?.length ? { tools: input.tools } : {}),
        ...(input.format ? { format: input.format } : {}),
        options: {
          temperature: input.temperature ?? 0.2,
          num_ctx: 16_384,
          ...(input.maxTokens || input.think ? { num_predict: input.think ? Math.max(input.maxTokens || 0, 2048) : input.maxTokens } : {}),
        },
        keep_alive: input.keepAlive || '10m',
      }),
      signal: input.signal,
    })
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? new DOMException('Aborted', 'AbortError')
    throw new Error(`Ollama 请求失败：${messageFrom(error)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (input.think && response.status === 400 && /think/i.test(detail) && /support|invalid|unknown/i.test(detail))
      return streamOllamaChat({ ...input, think: false }, onDelta, fetcher)
    throw new Error(detail || `Ollama 请求失败（HTTP ${response.status}）`)
  }
  if (!response.body) throw new Error('Ollama 未返回可读取的响应流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  const toolCalls: OllamaToolCall[] = []

  const normalizeToolCall = (raw: unknown): OllamaToolCall | null => {
    const fn = raw && typeof raw === 'object' ? (raw as { function?: unknown }).function : null
    if (!fn || typeof fn !== 'object') return null
    const name = typeof (fn as { name?: unknown }).name === 'string' ? (fn as { name: string }).name.trim() : ''
    if (!name) return null
    const rawArgs = (fn as { arguments?: unknown }).arguments
    if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) return { function: { name, arguments: rawArgs as Record<string, unknown> } }
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

  const parseLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let item: { message?: { content?: unknown; tool_calls?: unknown }; error?: unknown }
    try {
      item = JSON.parse(trimmed) as typeof item
    } catch {
      throw new Error('Ollama 返回了无效的 NDJSON')
    }
    if (typeof item.error === 'string' && item.error) throw new Error(item.error)
    const delta = typeof item.message?.content === 'string' ? item.message.content : ''
    if (delta) {
      full += delta
      onDelta(delta)
    }
    if (Array.isArray(item.message?.tool_calls)) {
      for (const raw of item.message.tool_calls) {
        const call = normalizeToolCall(raw)
        if (call) toolCalls.push(call)
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) parseLine(line)
  }
  buffer += decoder.decode()
  if (buffer.trim()) parseLine(buffer)
  return { role: 'assistant', content: full, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }
}
