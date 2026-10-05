import type { GameAgentMessage, OllamaModel } from './types'

export const DEFAULT_GAME_AGENT_MODEL = 'gemma4:e2b-it-q4_K_M'
export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function listOllamaModels(endpoint = DEFAULT_OLLAMA_HOST, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<OllamaModel[]> {
  let response: Response
  try {
    response = await fetcher(`${endpoint.replace(/\/$/, '')}/api/tags`, { signal, cache: 'no-store' })
  } catch (error) {
    throw new Error(`无法连接 Ollama：${messageFrom(error)}`)
  }
  if (!response.ok) throw new Error(`Ollama 模型列表请求失败（HTTP ${response.status}）`)
  const body = (await response.json()) as { models?: Array<{ name?: unknown; size?: unknown; modified_at?: unknown }> }
  return (body.models ?? [])
    .filter((item) => typeof item.name === 'string' && item.name.trim())
    .map((item) => ({
      name: String(item.name),
      size: typeof item.size === 'number' ? item.size : undefined,
      modifiedAt: typeof item.modified_at === 'string' ? item.modified_at : undefined,
    }))
}

export function pickDefaultModel(models: OllamaModel[]): string {
  return models.some((model) => model.name === DEFAULT_GAME_AGENT_MODEL) ? DEFAULT_GAME_AGENT_MODEL : models[0]?.name || ''
}

export async function streamOllamaChat(
  input: { endpoint?: string; model: string; messages: GameAgentMessage[]; temperature?: number; keepAlive?: string; signal?: AbortSignal },
  onDelta: (text: string) => void,
  fetcher: typeof fetch = fetch
): Promise<string> {
  let response: Response
  try {
    response = await fetcher(`${(input.endpoint || DEFAULT_OLLAMA_HOST).replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        stream: true,
        think: false,
        messages: input.messages,
        options: { temperature: input.temperature ?? 0.2 },
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
    throw new Error(detail || `Ollama 请求失败（HTTP ${response.status}）`)
  }
  if (!response.body) throw new Error('Ollama 未返回可读取的响应流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  const parseLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let item: { message?: { content?: unknown }; error?: unknown }
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
  return full
}
