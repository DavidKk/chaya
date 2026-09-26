/** HTTP 翻译引擎：服务端与游戏插件共用；调用方提供传输与取消信号。 */
export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'
export const DEFAULT_OLLAMA_MODEL = 'gemma4:e2b-it-q4_K_M'
export const OLLAMA_TRANSLATE_SYSTEM =
  '你是日→简体中文游戏文本翻译器。只输出自然的简体中文译文，不要解释，不要 Markdown。不要保留日文假名或整段日文汉字词；例如「応接室へ行く」应译为「去会客室」，不可写成「去応接室」。文中的 __C0__ __C1__ 等占位符必须原样保留。专有名词请音译或意译。'
export type EngineFetch = (url: string, init?: RequestInit) => Promise<Response>

export async function requestOllama(
  http: EngineFetch,
  input: { host?: string; model?: string; text: string; system?: string; temperature?: number; interactive?: boolean; signal?: AbortSignal }
) {
  const res = await http(`${input.host || DEFAULT_OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      model: input.model || DEFAULT_OLLAMA_MODEL,
      stream: false,
      think: false,
      keep_alive: '30m',
      messages: [
        { role: 'system', content: input.system || OLLAMA_TRANSLATE_SYSTEM },
        { role: 'user', content: input.text },
      ],
      options: { temperature: input.temperature ?? 0.2, ...(input.interactive ? { num_predict: Math.min(1024, Math.max(128, input.text.length * 3)) } : {}) },
    }),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
  const body = (await res.json()) as { message?: { content?: string }; response?: string; error?: string }
  if (body.error) throw new Error(body.error)
  return String(body.message?.content || body.response || '')
    .replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '')
    .replace(/^["「『]+|["」』]+$/g, '')
    .trim()
}

export async function requestGoogle(http: EngineFetch, text: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ client: 'gtx', sl: 'ja', tl: 'zh-CN', hl: 'zh-CN', dt: 't', ie: 'UTF-8', oe: 'UTF-8', q: text })
  const res = await http(`https://translate.google.com/translate_a/single?${params}`, {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
    },
  })
  if (!res.ok) throw new Error(`Google ${res.status}`)
  const body = await res.json()
  if (!Array.isArray(body) || !Array.isArray(body[0])) throw new Error('Google 未返回译文')
  const out = body[0].map((part: unknown) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '')).join('')
  if (!out) throw new Error('Google 未返回译文')
  return out
}

/** Bing 官方网页协议；游戏安装包无需额外安装 Node 依赖。 */
export function createBingTranslator(http: EngineFetch) {
  let config: { key: string; token: string; ig: string; iid: string; until: number } | null = null
  return async (text: string, signal?: AbortSignal) => {
    if (!config || config.until <= Date.now()) {
      const res = await http('https://www.bing.com/translator', { signal })
      if (!res.ok) throw new Error(`Bing ${res.status}`)
      const html = await res.text()
      const ig = html.match(/IG:"([^"]+)"/)?.[1]
      const iid = html.match(/data-iid="([^"]+)"/)?.[1]
      const tokenRaw = html.match(/params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/)?.[1]
      if (!ig || !iid || !tokenRaw) throw new Error('Bing 暂不可用')
      const [key, token, ttl] = JSON.parse(tokenRaw)
      config = { key: String(key), token: String(token), ig, iid, until: Date.now() + Math.min(Number(ttl) || 60_000, 600_000) }
    }
    const { ig, iid, key, token } = config
    const res = await http(`https://www.bing.com/ttranslatev3?isVertical=1&IG=${encodeURIComponent(ig)}&IID=${encodeURIComponent(iid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
      body: new URLSearchParams({ fromLang: 'ja', to: 'zh-Hans', text, key, token }).toString(),
    })
    if (!res.ok) {
      config = null
      throw new Error(`Bing ${res.status}`)
    }
    const data = await res.json()
    const out = data?.[0]?.translations?.[0]?.text
    if (typeof out !== 'string' || !out.trim()) {
      config = null
      throw new Error('Bing 未返回译文')
    }
    return out
  }
}
