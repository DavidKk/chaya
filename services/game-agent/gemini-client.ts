import type { AgentTokenUsage } from '@/lib/game-agent/activity'
import { isOpenApiGatewayEndpoint } from '@/lib/game-agent/providers'

import type { GameAgentMessage, OllamaModel, OllamaTool, OllamaToolCall } from './types'

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Resolve Gemini Generative Language API base (web-scripts style).
 * - `https://host` / `https://host/api` → append `/v1beta`
 * - already ends with `/v1` | `/v1beta` | `/v1beta2` → keep
 */
export function resolveGeminiApiBase(endpoint: string): string {
  const root = endpoint.trim().replace(/\/+$/, '')
  if (!root) return root
  if (/\/openai$/i.test(root)) return root
  if (/\/v1(?:beta2?)?$/i.test(root)) return root
  return `${root}/v1beta`
}

/** `…/v1beta/openai` keeps the OpenAI-compatible client; otherwise Google native Gemini REST. */
export function usesGeminiOpenAiCompat(endpoint: string): boolean {
  return /\/openai$/i.test(endpoint.trim().replace(/\/+$/, ''))
}

/** Custom root ≠ official Google host → vercel-gemini-proxy style gateway. */
export function isGeminiProxyEndpoint(endpoint: string): boolean {
  return isOpenApiGatewayEndpoint('gemini-api', endpoint)
}

/**
 * Dual auth for Gemini Relay (透传 API Key + Proxy headers), matching web-scripts / vercel-gemini-proxy:
 * - Official: Gemini API Key required (`x-goog-api-key` + `?key=`)
 * - Proxy gateway: proxy headers (e.g. X-API-KEY, CF-Access-*); API Key optional (passthrough when set)
 * - Both may be sent together (CF/gateway auth + Gemini key passthrough)
 */
export function resolveGeminiRequestAuth(input: { endpoint: string; token?: string; proxyHeaders?: Record<string, string>; contentType?: string }): {
  headers: Record<string, string>
  apiKey: string
  proxy: boolean
} {
  const proxy = isGeminiProxyEndpoint(input.endpoint)
  const apiKey = input.token?.trim() || ''
  if (!proxy && !apiKey) {
    throw new Error('Gemini API Key is not configured. Official API requires a Key; or use proxy headers in Proxy mode.')
  }
  const headers: Record<string, string> = {}
  if (input.contentType) headers['Content-Type'] = input.contentType
  if (proxy && input.proxyHeaders) {
    for (const [name, value] of Object.entries(input.proxyHeaders)) {
      const key = name.trim()
      if (!key || value == null || value === '') continue
      headers[key] = value
    }
  }
  if (apiKey) headers['x-goog-api-key'] = apiKey
  return { headers, apiKey, proxy }
}

/** @deprecated Prefer {@link resolveGeminiRequestAuth} */
export function geminiGatewayRequestHeaders(endpoint: string, proxyHeaders: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!isGeminiProxyEndpoint(endpoint)) return undefined
  if (!proxyHeaders || !Object.keys(proxyHeaders).length) return undefined
  return proxyHeaders
}

function withGeminiKeyQuery(url: URL, apiKey: string) {
  if (apiKey) url.searchParams.set('key', apiKey)
  return url
}

type GeminiPart = {
  text?: string
  functionCall?: { name?: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

const GEMINI_PARAMETERS_STRIP = new Set([
  'additionalProperties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'examples',
  'default',
  'unevaluatedProperties',
  'patternProperties',
])

function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (GEMINI_PARAMETERS_STRIP.has(key)) continue
    out[key] = sanitizeSchema(child)
  }
  return out
}

function sanitizeParameters(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object', properties: {} }
  return sanitizeSchema(schema) as Record<string, unknown>
}

function functionResponsePayload(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>
  return { result: result ?? null }
}

/** Map Chaya/Ollama-shaped messages to Gemini `contents`. */
export function toGeminiContents(messages: GameAgentMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      contents.push({ role: 'user', parts: [{ text: `System:\n${message.content || ''}` }] })
      continue
    }
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content || '' }] })
      continue
    }
    if (message.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (message.content) parts.push({ text: message.content })
      for (const call of message.tool_calls || []) {
        parts.push({ functionCall: { name: call.function.name, args: call.function.arguments || {} } })
      }
      if (parts.length) contents.push({ role: 'model', parts })
      continue
    }
    if (message.role === 'tool') {
      let parsed: unknown = message.content
      try {
        parsed = JSON.parse(message.content)
      } catch {
        // keep raw string
      }
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: message.tool_name || 'tool',
              response: functionResponsePayload(parsed),
            },
          },
        ],
      })
    }
  }
  return contents
}

function normalizeModelId(name: string) {
  return name.replace(/^models\//, '').trim()
}

/** List models via Google Generative Language `GET {root}/models`. */
export async function listGeminiModels(
  endpoint: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  token?: string,
  proxyHeaders?: Record<string, string>
): Promise<OllamaModel[]> {
  const auth = resolveGeminiRequestAuth({ endpoint, token, proxyHeaders })
  const root = resolveGeminiApiBase(endpoint)
  const models: OllamaModel[] = []
  let pageToken = ''
  for (let page = 0; page < 10; page++) {
    const url = withGeminiKeyQuery(new URL(`${root}/models`), auth.apiKey)
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    let response: Response
    try {
      response = await fetcher(url.toString(), {
        signal,
        cache: 'no-store',
        headers: auth.headers,
      })
    } catch (error) {
      throw new Error(`Failed to connect to Gemini service: ${messageFrom(error)}`)
    }
    if (!response.ok) throw new Error(`Gemini model list request failed (HTTP ${response.status})`)
    const body = (await response.json()) as {
      models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>
      nextPageToken?: string
      error?: { message?: string }
      success?: boolean
      message?: string
    }
    if (body.error?.message) throw new Error(body.error.message)
    if (body.success === false && typeof body.message === 'string' && body.message.trim()) throw new Error(body.message.trim())
    for (const model of body.models || []) {
      const methods = model.supportedGenerationMethods || []
      if (methods.length && !methods.includes('generateContent')) continue
      const id = normalizeModelId(typeof model.name === 'string' ? model.name : '')
      if (!id) continue
      models.push({ name: id, ...(model.displayName ? { label: model.displayName } : {}) })
    }
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken.trim() : ''
    if (!pageToken) break
  }
  return models.sort((a, b) => a.name.localeCompare(b.name))
}

/** One non-streaming `generateContent` round (function calling included). */
export async function completeGeminiChat(
  input: {
    endpoint: string
    model: string
    messages: GameAgentMessage[]
    tools?: OllamaTool[]
    temperature?: number
    timeoutMs?: number
    token?: string
    proxyHeaders?: Record<string, string>
    signal?: AbortSignal
  },
  fetcher: typeof fetch = fetch
): Promise<GameAgentMessage> {
  const auth = resolveGeminiRequestAuth({
    endpoint: input.endpoint,
    token: input.token,
    proxyHeaders: input.proxyHeaders,
    contentType: 'application/json',
  })
  const requestSignal = input.timeoutMs
    ? input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)])
      : AbortSignal.timeout(input.timeoutMs)
    : input.signal
  const model = normalizeModelId(input.model)
  const url = withGeminiKeyQuery(new URL(`${resolveGeminiApiBase(input.endpoint)}/models/${encodeURIComponent(model)}:generateContent`), auth.apiKey)
  const body: Record<string, unknown> = {
    contents: toGeminiContents(input.messages),
    generationConfig: {
      temperature: input.temperature ?? 0.2,
      maxOutputTokens: 16384,
    },
  }
  if (input.tools?.length) {
    body.tools = [
      {
        functionDeclarations: input.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: sanitizeParameters(tool.function.parameters),
        })),
      },
    ]
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
  }
  let response: Response
  try {
    response = await fetcher(url.toString(), {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify(body),
      signal: requestSignal,
    })
  } catch (error) {
    if (requestSignal?.aborted) throw requestSignal.reason ?? new DOMException('Aborted', 'AbortError')
    throw new Error(`Failed to connect to Gemini service (${input.endpoint}): ${messageFrom(error)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `Gemini request failed (HTTP ${response.status})`)
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>
    promptFeedback?: { blockReason?: string }
    error?: { message?: string }
    success?: boolean
    message?: string
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  if (data.error?.message) throw new Error(data.error.message)
  if (data.success === false && typeof data.message === 'string' && data.message.trim()) throw new Error(data.message.trim())
  const parts = data.candidates?.[0]?.content?.parts || []
  const textParts: string[] = []
  const toolCalls: OllamaToolCall[] = []
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text) textParts.push(part.text)
    const name = typeof part.functionCall?.name === 'string' ? part.functionCall.name.trim() : ''
    if (name) {
      toolCalls.push({
        function: {
          name,
          arguments: part.functionCall?.args && typeof part.functionCall.args === 'object' ? part.functionCall.args : {},
        },
      })
    }
  }
  const content = textParts.join('\n')
  if (!content && !toolCalls.length) {
    const block = data.promptFeedback?.blockReason
    if (block) throw new Error(`Gemini rejected the request (${block})`)
    throw new Error(`Gemini returned empty response (finishReason=${data.candidates?.[0]?.finishReason || 'none'})`)
  }
  let usage: AgentTokenUsage | undefined
  if (data.usageMetadata) {
    const inputTokens = typeof data.usageMetadata.promptTokenCount === 'number' ? data.usageMetadata.promptTokenCount : undefined
    const outputTokens = typeof data.usageMetadata.candidatesTokenCount === 'number' ? data.usageMetadata.candidatesTokenCount : undefined
    const total = typeof data.usageMetadata.totalTokenCount === 'number' ? data.usageMetadata.totalTokenCount : (inputTokens || 0) + (outputTokens || 0)
    if (inputTokens !== undefined || outputTokens !== undefined) usage = { input: inputTokens, output: outputTokens, total }
  }
  return { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...(usage ? { usage } : {}) }
}
