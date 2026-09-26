/**
 * 疑似敏感台词检测（wordguard + 游戏向补充词）。
 * 命中则公网引擎不送，优先/仅走本机 Ollama，降低封禁风险。
 */

import { wordguard } from 'wordguard'

import { stripControlNoise } from './text-classify'

/**
 * wordguard 仅内置 ja/en；成人游戏常见词根与中文混排补进 words。
 * 短口语慎加，避免日常对话误伤。
 */
const EXTRA_WORDS = [
  /* ja 游戏向 */
  'レイプ',
  '強姦',
  '凌辱',
  '輪姦',
  '痴漢',
  '挿入',
  '射精',
  '中出し',
  '顔射',
  '口内射精',
  '膣内',
  'アナル',
  'ペニス',
  'チンポ',
  'ちんぽ',
  'まんこ',
  'おっぱい',
  '乳首',
  'クリトリス',
  'フェラ',
  'セックス',
  'エロい',
  '淫乱',
  '絶頂',
  '喘ぎ',
  '調教',
  '肉便器',
  '精液',
  '愛液',
  '潮吹',
  'オナニ',
  '自慰',
  '全裸',
  /* zh 混排 / 缓存回写 */
  '强奸',
  '凌辱',
  '轮奸',
  '痴汉',
  '强制爱',
  '插入',
  '射精',
  '中出',
  '颜射',
  '阴道',
  '肛门',
  '阴茎',
  '乳房',
  '奶子',
  '口交',
  '性爱',
  '淫乱',
  '高潮',
  '精液',
  '爱液',
  '潮吹',
  '自慰',
  '裸体',
  '脱光',
  '调教',
  '肉便器',
]

const filter = wordguard({
  languages: ['ja'],
  categories: ['sexual'],
  words: EXTRA_WORDS,
})

/** 装饰/口吻信号：心形密度、喘息符等（单独不足判敏感，参与加权） */
const DECO_SIGNAL = /[♡♥❤💕]|はぁ+|あっ+|んっ+|ぅぅ+|ァ+|ッ+/g

export type SensitiveHit = {
  sensitive: boolean
  score: number
  reasons: string[]
}

/**
 * 粗检：是否不宜送公网翻译。
 * wordguard 命中即敏感；仅有装饰信号时 score < 2，不拦。
 */
export function inspectSensitiveText(text: string): SensitiveHit {
  const raw = String(text ?? '')
  if (!raw.trim()) return { sensitive: false, score: 0, reasons: [] }

  const core = stripControlNoise(raw)
  let score = 0
  const reasons: string[] = []

  if (core) {
    const matches = filter.matchAll(core)
    if (matches.length) {
      score += Math.min(4, matches.length * 2)
      const labels = [...new Set(matches.map((m) => m.word))].slice(0, 4)
      reasons.push(`wg:${labels.join('|')}`)
    }
  }

  /* 装饰符在 strip 前取，否则 ♡ 会被剥掉 */
  const deco = raw.match(DECO_SIGNAL)
  if (deco && deco.length >= 2 && score > 0) {
    score += 1
    reasons.push('deco')
  } else if (deco && deco.length >= 4 && /[♡♥❤]/.test(raw) && raw.length <= 40) {
    score += 1
    reasons.push('deco-heavy')
  }

  return { sensitive: score >= 2, score, reasons }
}

export function isSensitiveForCloud(text: string): boolean {
  return inspectSensitiveText(text).sensitive
}

/** 引擎 tag 是否标记为 NSFW / 敏感跳过（如 `live:ollama:nsfw`、`skip:sensitive`） */
export function isNsfwTaggedEngine(engine: string | null | undefined): boolean {
  const e = String(engine || '')
  if (!e) return false
  return e.includes(':nsfw') || e === 'skip:sensitive' || e.endsWith(':sensitive')
}

/** 缓存行是否 NSFW：引擎 tag 或原文敏感检测 */
export function isNsfwCacheRow(src: string, engine?: string | null): boolean {
  return isNsfwTaggedEngine(engine) || isSensitiveForCloud(src)
}

/**
 * 公网分片前拆开：敏感条不得混入同片请求（一条拒收会拖死整片）。
 * 返回仍保持原相对顺序。
 */
export function partitionCloudSafeTexts(texts: string[]): { safe: string[]; sensitive: string[] } {
  const safe: string[] = []
  const sensitive: string[] = []
  for (const raw of texts) {
    const text = String(raw ?? '')
    if (!text) continue
    if (isSensitiveForCloud(text)) sensitive.push(text)
    else safe.push(text)
  }
  return { safe, sensitive }
}
