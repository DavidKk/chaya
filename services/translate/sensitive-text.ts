/** Detect potentially sensitive dialogue with wordguard and game-specific additions. Avoid public engines on a match and prefer local Ollama to reduce provider blocking. */

import { wordguard } from 'wordguard'

import { stripControlNoise } from './text-classify'

/** wordguard includes Japanese and English only; add game-specific roots and mixed Chinese terms. Avoid broad short expressions that would flag ordinary dialogue. */
const EXTRA_WORDS = [
  /* Japanese game-specific terms. */
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
  /* Mixed Chinese text and cache writes. */
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

/** Decorative and tone signals, such as heart density and vocalizations, contribute to the score but are insufficient alone. */
const DECO_SIGNAL = /[♡♥❤💕]|はぁ+|あっ+|んっ+|ぅぅ+|ァ+|ッ+/g

export type SensitiveHit = {
  sensitive: boolean
  score: number
  reasons: string[]
}

/** Check whether text should avoid public translation. wordguard matches are decisive; low decoration-only scores do not block requests. */
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

  /* Read decorative signals before stripping removes them. */
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

/** Determine whether an engine tag marks NSFW content or a sensitive-text skip, such as live:ollama:nsfw or skip:sensitive. */
export function isNsfwTaggedEngine(engine: string | null | undefined): boolean {
  const e = String(engine || '')
  if (!e) return false
  return e.includes(':nsfw') || e === 'skip:sensitive' || e.endsWith(':sensitive')
}

/** Determine whether a cache row is NSFW using its engine tag or source text. */
export function isNsfwCacheRow(src: string, engine?: string | null): boolean {
  return isNsfwTaggedEngine(engine) || isSensitiveForCloud(src)
}

/** Separate sensitive rows before public-engine batching so one rejected row cannot fail an entire batch. Preserve relative order. */
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
