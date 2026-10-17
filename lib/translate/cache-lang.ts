import { sourceTextBody } from '@/lib/translate/source-text'

/** Languages stored on shared-cache rows. Catalog filters and pair badges use these. */
export const CACHE_LANGS = ['ja', 'en', 'zh', 'ko'] as const
export type CacheLang = (typeof CACHE_LANGS)[number]

export const DEFAULT_CACHE_SRC_LANG: CacheLang = 'ja'
export const DEFAULT_CACHE_TGT_LANG: CacheLang = 'zh'

const KANA = /[\u3041-\u3096\u30A1-\u30FA\u31F0-\u31FF\uFF66-\uFF9D]/
const HAN = /[\u3400-\u9FFF]/
const LATIN = /[A-Za-z]/
const HANGUL = /[\uAC00-\uD7A3]/

export function parseCacheLang(raw: string | null | undefined): CacheLang | '' {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  return (CACHE_LANGS as readonly string[]).includes(value) ? (value as CacheLang) : ''
}

export function normalizeCacheLang(raw: string | null | undefined, fallback: CacheLang): CacheLang {
  return parseCacheLang(raw) || fallback
}

/**
 * Guess source language for catalog rows.
 * Han-only text defaults to Japanese (RPG Maker heritage); pass an explicit `from` for 中→*.
 */
export function detectCacheLang(text: string, fallback: CacheLang = DEFAULT_CACHE_SRC_LANG): CacheLang {
  const body = sourceTextBody(String(text || ''))
  if (!body) return fallback
  if (HANGUL.test(body)) return 'ko'
  if (KANA.test(body)) return 'ja'
  if (LATIN.test(body) && !HAN.test(body) && !KANA.test(body)) return 'en'
  if (HAN.test(body)) return fallback
  return fallback
}

/** Guess target language for migration / display. Han defaults to Chinese. */
export function detectCacheTargetLang(text: string, fallback: CacheLang = DEFAULT_CACHE_TGT_LANG): CacheLang {
  const body = sourceTextBody(String(text || ''))
  if (!body) return fallback
  if (HANGUL.test(body)) return 'ko'
  if (KANA.test(body)) return 'ja'
  if (LATIN.test(body) && !HAN.test(body) && !KANA.test(body)) return 'en'
  if (HAN.test(body)) return 'zh'
  return fallback
}

export type CacheLangPair = { from: CacheLang; to: CacheLang }

export function resolveCacheLangPair(opts?: { from?: string | null; to?: string | null; src?: string }): CacheLangPair {
  const from = parseCacheLang(opts?.from) || (opts?.src != null ? detectCacheLang(opts.src) : DEFAULT_CACHE_SRC_LANG)
  const to = parseCacheLang(opts?.to) || DEFAULT_CACHE_TGT_LANG
  return { from, to }
}
