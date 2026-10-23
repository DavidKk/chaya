/** HTTP translation engines shared by the server and game plugin; callers supply transport and cancellation. */
import { isSourceText } from './source-text'

export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'
export const DEFAULT_OLLAMA_MODEL = 'gemma4:e2b-it-q4_K_M'
export const OLLAMA_TRANSLATE_SYSTEM =
  '你是游戏文本翻译器，把日文或英文原文译成简体中文。只输出自然的简体中文译文，不要解释，不要 Markdown。' +
  '不要保留日文假名或整段日文汉字词；例如「応接室へ行く」应译为「去会客室」，不可写成「去応接室」。' +
  "文中的占位符（如 __C0__、__C1__ 或 \\N[1]、\\V[1]、%s 等代表角色名、变量、物品或控制码）必须原样保留原有格式，并置于通顺自然的语法位置（例如「__C0__'s name ( __C1__'s dad)」应译为「__C0__的名字（__C1__的爸爸）」，括号、所有格与修饰语必须完整保留，严禁将占位符挤在一起或漏掉修饰语）。" +
  '专有名词请音译或意译。'
export const OLLAMA_TRANSLATE_RETRY_SYSTEM =
  '这是游戏文本本地化任务，请把原文台词译成通顺的简体中文。只输出中文译文，不要复述原文，不要道歉或拒绝。' +
  "文中的占位符（如 __C0__、__C1__ 或 \\N[1]、\\V[1] 等控制码）必须原样保留格式与完整结构（例如「__C0__'s name」应保留为「__C0__的名字」）。"

export const CATEGORY_PROMPT_GUIDES: Record<string, string> = {
  weapon: '武器装备名称。请采用符合奇幻/动作游戏惯用译法，富有武器质感与气势（如 Thunder Sword 视语境译为「雷鸣之剑 / 迅雷之刃 / 雷霆长剑」，避免生硬直译为「雷剑」）。',
  weapon_desc: '武器说明。用语凝练，说明武器特性、来历或战斗效果。',
  armor: '防具装备名称。符合 RPG 装备命名风格（如胸甲、护手、战靴、法袍等），译名洗练有质感。',
  armor_desc: '防具说明。描述防护部位、材质、防御特性或背景。',
  item: '物品/道具名称。符合 RPG 游戏常用道具、消耗品与材料用语（例如 Potion 译为「恢复药水/恢复药」）。',
  item_desc: '物品说明。清晰表达道具用途、使用效果或素材说明。',
  skill: '技能/法术/招式名称。具有武技与魔法感，动作感强、干练大气、富有打击感。',
  skill_desc: '技能说明。准确描述技能施放效果、消耗或作用范围。',
  actor:
    '角色名/NPC名称。注意不一定是普通人名，可能是带有身份、职务、头衔的 NPC（例如 Customer Bob 应译为「顾客 Bob / 顾客鲍勃」，而非商务化的「客户Bob」；Guard / Shopkeeper 应译为「卫兵 / 店主」）。',
  actor_nickname: '角色称号/头衔。精炼霸气，符合 RPG 人物称号风格（如「疾风之剑」、「苍穹之影」）。',
  actor_profile: '角色简介/背景故事。叙事自然，生动展现人物性格与身世。',
  enemy: '敌人/怪物名称。符合奇幻/魔物世界观设定（如魔兽、小恶魔、哥布林等），气势贴切。',
  dialogue: '剧情对话台词。口语化自然流畅，符合人物口吻与性格，避免生硬机翻腔。',
  story: '故事剧情/旁白。叙事典雅生动，富有沉浸感。',
  choice: '选项分支。简明扼要，符合玩家第一人称行动选择。',
  map: '地名/地图名称。符合游戏世界观地理命名习惯（如城镇、地下城、森林、遗迹等）。',
  state: '状态/异常状态名称。简洁规范（如中毒、麻痹、狂暴、神圣守护等）。',
  state_msg: '状态提示信息。提示感强，符合游戏战斗/系统提示风格。',
  system: '系统提示/界面文本。用词简练规范，符合游戏常用 UI 交互惯例。',
}

export function getCategoryPromptGuidance(category?: string): string | undefined {
  if (!category) return undefined
  return CATEGORY_PROMPT_GUIDES[category] || undefined
}

export function buildTranslateSystemPrompt(ctx?: { category?: string; speaker?: string; context?: string }): string {
  if (!ctx || (!ctx.category && !ctx.speaker && !ctx.context)) return OLLAMA_TRANSLATE_SYSTEM
  const parts: string[] = [OLLAMA_TRANSLATE_SYSTEM]
  const guidance = getCategoryPromptGuidance(ctx.category)
  if (guidance) parts.push(`【当前文本类型】：${guidance}`)
  if (ctx.speaker) parts.push(`【说话人】：${ctx.speaker}（请结合说话人身份采用恰当的口吻）`)
  if (ctx.context) parts.push(`【来源/上下文】：${ctx.context}`)
  return parts.join('\n')
}

export const translationNeedsReasoning = (text: string) => text.length > 140 || text.split('\n').filter(Boolean).length >= 3
export type EngineFetch = (url: string, init?: RequestInit) => Promise<Response>

export async function requestOllama(
  http: EngineFetch,
  input: {
    host?: string
    model?: string
    text: string
    system?: string
    category?: string
    speaker?: string
    context?: string
    temperature?: number
    interactive?: boolean
    think?: boolean
    signal?: AbortSignal
    /** Bearer token for Ollama-compatible endpoints behind auth */
    token?: string
    keepAlive?: string
  }
): Promise<string> {
  const defaultSystem = buildTranslateSystemPrompt({ category: input.category, speaker: input.speaker, context: input.context })
  const system = input.system || defaultSystem
  /* Small models may echo unlabelled source text; explicit source and target slots improve Chinese translation output. */
  const user =
    !input.system || input.system === defaultSystem || input.system === OLLAMA_TRANSLATE_SYSTEM
      ? `${isSourceText(input.text, 'en') ? '英文' : '日文'}：\n${input.text}\n\n简体中文：`
      : input.text
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (input.token) headers.Authorization = `Bearer ${input.token}`
  const res = await http(`${(input.host || DEFAULT_OLLAMA_HOST).replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers,
    signal: input.signal,
    body: JSON.stringify({
      model: input.model || DEFAULT_OLLAMA_MODEL,
      stream: false,
      think: input.think === true,
      keep_alive: input.keepAlive || '30m',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: { temperature: input.temperature ?? 0.2, ...(input.interactive ? { num_predict: input.think ? 2048 : Math.min(1024, Math.max(128, input.text.length * 3)) } : {}) },
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    if (input.think && res.status === 400 && /think/i.test(detail) && /support|invalid|unknown/i.test(detail)) return requestOllama(http, { ...input, think: false })
    throw new Error(`Ollama ${res.status}: ${detail}`)
  }
  const body = (await res.json()) as { message?: { content?: string }; response?: string; error?: string }
  if (body.error) throw new Error(body.error)
  return String(body.message?.content || body.response || '')
    .replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '')
    .replace(/^\s*(?:简体)?中文[:：]\s*/, '')
    .replace(/^["「『]+|["」』]+$/g, '')
    .trim()
}

export async function requestGoogle(http: EngineFetch, text: string, signal?: AbortSignal, pair?: { from?: string; to?: string }) {
  const sl = pair?.from === 'zh' || pair?.from === 'ch' ? 'zh-CN' : pair?.from || 'auto'
  const tl = pair?.to === 'zh' || pair?.to === 'ch' ? 'zh-CN' : pair?.to === 'cht' ? 'zh-TW' : pair?.to || 'zh-CN'
  const params = new URLSearchParams({ client: 'gtx', sl, tl, hl: tl, dt: 't', ie: 'UTF-8', oe: 'UTF-8', q: text })
  const res = await http(`https://translate.google.com/translate_a/single?${params}`, {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
    },
  })
  if (!res.ok) throw new Error(`Google ${res.status}`)
  const body = await res.json()
  if (!Array.isArray(body) || !Array.isArray(body[0])) throw new Error('Google returned no translation')
  const out = body[0].map((part: unknown) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '')).join('')
  if (!out) throw new Error('Google returned no translation')
  return out
}

/** Bing's web protocol, usable by game installations without extra Node dependencies. */
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
      if (!ig || !iid || !tokenRaw) throw new Error('Bing translation temporarily unavailable')
      const [key, token, ttl] = JSON.parse(tokenRaw)
      config = { key: String(key), token: String(token), ig, iid, until: Date.now() + Math.min(Number(ttl) || 60_000, 600_000) }
    }
    const { ig, iid, key, token } = config
    const res = await http(`https://www.bing.com/ttranslatev3?isVertical=1&IG=${encodeURIComponent(ig)}&IID=${encodeURIComponent(iid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
      body: new URLSearchParams({ fromLang: 'auto-detect', to: 'zh-Hans', text, key, token }).toString(),
    })
    if (!res.ok) {
      config = null
      throw new Error(`Bing ${res.status}`)
    }
    const data = await res.json()
    const out = data?.[0]?.translations?.[0]?.text
    if (typeof out !== 'string' || !out.trim()) {
      config = null
      throw new Error('Bing returned no translation')
    }
    return out
  }
}
