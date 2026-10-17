import { DYNAMIC_VARIABLE, isDynamicTemplate } from './dynamic-template'

export type SourceLanguage = 'ja' | 'en' | 'zh'
export type SourceLanguageOption = SourceLanguage | 'auto'
const KANA = /[\u3041-\u3096\u30A1-\u30FA\u31F0-\u31FF\uFF66-\uFF9D]/
const HAN = /[\u3400-\u9FFF]/
const LATIN = /[A-Za-z]/
const markupTags = ['br', 'span', 'div', 'p', 'b', 'i', 'img', 'ruby', 'rt'].map((tag) => [...tag].map((char) => `[${char}${char.toUpperCase()}]`).join('')).join('|')
export const TEXT_MARKUP_RE = new RegExp(`<\\/?(?:${markupTags})(?:\\s[^<>]*?)?\\s*\\/?>`, 'g')

/** Classify content after removing engine escapes; resource identifiers are never prose. */
export function sourceTextBody(value: string): string {
  return value
    .replace(TEXT_MARKUP_RE, ' ')
    .replace(/\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|%\d+|%[sdif]|\{[A-Za-z0-9_]+\}/g, ' ')
    .replace(DYNAMIC_VARIABLE, ' ')
    .replace(/_[A-Z][A-Z0-9_]+/g, ' ')
    .trim()
}

export function isSourceText(value: unknown, language: SourceLanguage | 'all' = 'all'): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text || /^(?:true|false|null|undefined|EV\d+|#[\da-f]{3,8})$/i.test(text)) return false
  if (/^(?:https?:\/\/|[a-z]:[\\/]|\/|(?:\.\.?[\\/])|(?:img|audio|movies|fonts|js|data|assets|images|sounds)[\\/])/i.test(text)) return false
  if (/\.(?:png|jpe?g|webp|gif|ogg|wav|mp3|m4a|mp4|webm|js|json|csv|txt|rpgmvp|rpgmvo)$/i.test(text)) return false
  if (/^[A-Za-z_]\w*\[\d+\]$/.test(text)) return false
  if (/^(?:HP|MP|TP|EXP|LV|FPS|ATK|DEF|MAT|MDF|AGI|LUK)\s*[:=]?\s*[\d.,/%+\s-]+$/i.test(text)) return false
  if (
    /^(?:(?:async\s+)?function\b|(?:if|for|while)\s*\(|(?:const|let|var)\s+[$\w]+\s*[=:;]|return\s+(?:['"`$({]|[A-Za-z_$][\w$]*[.(])|return\b[^\n]*;|\$[A-Za-z_]|\(?[\w,\s]*\)?\s*=>)/.test(
      text
    )
  )
    return false
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:[+*/-]=|=(?!=)|\+\+|--)/.test(text) || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\(/.test(text)) return false
  if (!isDynamicTemplate(text) && /^\S*_\S*$/.test(text)) return false
  const body = sourceTextBody(text)
  const kana = KANA.test(body)
  const han = HAN.test(body)
  const latin = LATIN.test(body)
  if (language === 'ja') return kana || han
  if (language === 'zh') return han && !kana
  if (language === 'en') return latin && !kana && !han
  return kana || han || latin
}

/** Use actual prose first: a translated game may retain its original System.locale. */
export function detectSourceLanguage(texts: Iterable<string>, locale = ''): SourceLanguage {
  const scores = { ja: 0, en: 0, zh: 0 }
  for (const text of texts) {
    if (!isSourceText(text)) continue
    const body = sourceTextBody(text)
    const weight = Math.min(body.length, 120)
    if (KANA.test(body)) scores.ja += weight
    else if (HAN.test(body)) scores.zh += weight
    else if (LATIN.test(body)) scores.en += weight
  }
  // Japanese names often consist solely of Han characters.
  if (scores.ja >= Math.max(1, scores.zh * 0.35) && scores.ja + scores.zh >= scores.en) return 'ja'
  if (scores.zh > scores.en) return 'zh'
  if (scores.en > 0) return 'en'
  return /^en/i.test(locale) ? 'en' : /^zh/i.test(locale) ? 'zh' : 'ja'
}
