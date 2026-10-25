/**
 * 跨语言轻量分词与 Token 抽取
 * 重点覆盖英语（EN）、日语（JA）和中文（ZH），并原生兼容俄语（RU）、韩语（KO）等其他多语言。
 * 基于原生 Intl.Segmenter 实现零依赖极速分词。
 */

import { sourceTextBody } from './source-text'

const KATAKANA_CHAR = /^[ァ-ヺーㇰ-ㇿｦ-ﾝ]+$/
const HANGUL_WORD = /^[가-힣]+$/
const HANGUL_PARTICLES = /(?:의|은|는|이|가|을|를|과|와|에|에서|로|으로|도|만)$/
const MAX_CACHE_SIZE = 50_000

interface IntlSegment {
  segment: string
  index: number
  input: string
  isWordLike?: boolean
}

interface IntlSegments {
  [Symbol.iterator](): IterableIterator<IntlSegment>
}

interface IntlSegmenterInstance {
  segment(input: string): IntlSegments
}

interface IntlSegmenterConstructor {
  new (locales?: string | string[], options?: { granularity?: 'grapheme' | 'word' | 'sentence' }): IntlSegmenterInstance
}

const SegmenterCtor = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? (Intl as unknown as { Segmenter: IntlSegmenterConstructor }).Segmenter : null

const segmenter: IntlSegmenterInstance | null = SegmenterCtor ? new SegmenterCtor('ja', { granularity: 'word' }) : null

/** 内存 Token 缓存：避免搜索过滤万级列表时对相同文本反复调用 Segmenter */
const tokenCache = new Map<string, string[]>()

/**
 * 文本标准化：
 * 1. 过滤 RPG 控制符与 HTML 标记（如 \C[1]、<br>）
 * 2. Unicode NFKC 归一化（全角字母/数字转半角）
 * 3. 转小写
 */
export function normalizeSearchText(text: string): string {
  if (!text) return ''
  const clean = sourceTextBody(text)
  return clean.normalize('NFKC').toLowerCase()
}

/**
 * 将文本拆分为关键词匹配所需的 Token 列表。
 * - 英语/俄语等西文字符：按词边界切分，英语去除所有格（如 Rei's -> Rei）。
 * - 日语：基于原生 ICU 词素切词，并自动合并连续片假名与长音符（避免将「レイカ」误切为「レ」+「イカ」）。
 * - 韩语：按词素切分并附带轻量助词剥离（如「레이의」附带词干「레이」）。
 * - 中文：切分出独立的汉字词组与单字。
 */
export function tokenizeSearchText(text: string): string[] {
  if (!text) return []
  const normalized = normalizeSearchText(text)
  if (!normalized) return []

  const cached = tokenCache.get(normalized)
  if (cached) return cached

  let tokens: string[]
  if (segmenter) {
    const raw: string[] = []
    for (const segment of segmenter.segment(normalized)) {
      if (segment.isWordLike) {
        const cleaned = segment.segment.replace(/['’]s$/i, '')
        if (cleaned) raw.push(cleaned)
      }
    }
    // 连续片假名合并（游戏外来语/角色名人名保护）
    const merged: string[] = []
    for (const token of raw) {
      if (merged.length > 0 && KATAKANA_CHAR.test(token) && KATAKANA_CHAR.test(merged[merged.length - 1])) {
        merged[merged.length - 1] += token
      } else {
        merged.push(token)
      }
    }
    // 韩语常见助词轻量剥离，辅助词干还原（例如「레이의」剥离助词「의」匹配「레이」）
    const withStems: string[] = []
    for (const token of merged) {
      withStems.push(token)
      if (token.length >= 3 && HANGUL_WORD.test(token)) {
        const stem = token.replace(HANGUL_PARTICLES, '')
        if (stem.length >= 2 && stem !== token && !withStems.includes(stem)) {
          withStems.push(stem)
        }
      }
    }
    tokens = withStems
  } else {
    // 环境不支持 Intl.Segmenter 时的通用降级
    tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  }

  if (tokenCache.size >= MAX_CACHE_SIZE) {
    tokenCache.clear()
  }
  tokenCache.set(normalized, tokens)
  return tokens
}
