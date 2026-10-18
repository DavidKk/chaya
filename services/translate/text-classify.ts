import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
/** Translation eligibility and RM/script shell protection. Preserve controls, placeholders, decorations and choice conditions, sending only the body for translation. */
import { isDynamicTemplate, validDynamicTranslation } from '@/lib/translate/dynamic-template'
import { translationRubyChunks, translationSegmentContent } from '@/lib/translate/segments'
import { SENTENCE_TOKEN_SOURCE } from '@/lib/translate/sentence-units'
import { isSourceText, TEXT_MARKUP_RE } from '@/lib/translate/source-text'

// Detect kana letters only; middle dots, prolonged sound marks and width variants of punctuation may remain in Chinese translations.
const JAPANESE = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FD-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]/
const HAN = /[\u4e00-\u9fff]/

export function containsJapaneseText(text: string): boolean {
  return JAPANESE.test(String(text ?? ''))
}

function retainsJapaneseHanPhrase(src: string, zh: string): boolean {
  if (!containsJapaneseText(src)) return false
  // Shared Han words are valid Chinese. Only flag retained Japanese-specific forms.
  const japaneseForms = /[応駅図広気帰転戦楽読売発変実対観関験険]/
  return (src.match(/[\u4e00-\u9fff]{3,}/g) || []).some((phrase) => japaneseForms.test(phrase) && zh.includes(phrase))
}

/** Mask non-translatable tokens: RM controls, script markers, percent placeholders, brace slots and decorative symbols. Use ASCII __C0__ slots; numeric RM templates are defined in lib/translate/rm-escape. */
const ENGINE_TOKEN =
  /\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|%[0-9]+|%[sdifSc]|\{[0-9A-Za-z_]+\}|[A-Za-z_][A-Za-z0-9_]*\[\d+\]|_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])|_se\[[^\]]*\]|_[A-Z][A-Z0-9_]{1,}|[♡♥❤❥💕♪☆★✦✧※]{1,}|(?:\.{3}|…{1,}|・{2,}|･{2,})/g
const PROTECT_TOKEN = new RegExp(`${TEXT_MARKUP_RE.source}|${ENGINE_TOKEN.source}`, 'g')

/** Skill and item names may have boundary markers such as ! or !#. Remove markers only at the edges to preserve punctuation inside sentences. */
const EDGE_MARK_RE = /^[!！？?#＃※＊*◆◇★☆▶▷▪▫・･]+/

function matchEdgeMarkAt(text: string, atEnd: boolean): string | null {
  if (!atEnd) {
    const m = text.match(EDGE_MARK_RE)
    return m ? m[0] : null
  }
  /* Remove the same character class from the end. */
  const m = text.match(/[!！？?#＃※＊*◆◇★☆▶▷▪▫・･]+$/)
  return m ? m[0] : null
}

function matchTokenAt(text: string, atEnd: boolean): string | null {
  PROTECT_TOKEN.lastIndex = 0
  let hit: string | null = null
  for (const m of text.matchAll(PROTECT_TOKEN)) {
    if (/^\\RB\[/i.test(m[0])) continue
    const i = m.index ?? 0
    if (atEnd) {
      if (i + m[0].length === text.length) hit = m[0]
    } else if (i === 0) {
      return m[0]
    }
  }
  return hit
}

function normCmp(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** Remove boundary controls, markers, placeholders, decorations and whitespace, leaving the body. */
export function peelProtectShell(text: string): { lead: string; core: string; trail: string } {
  let rest = String(text ?? '')
  let lead = ''
  let trail = ''

  for (;;) {
    const space = rest.match(/^[\s\u3000]+/)
    if (space) {
      lead += space[0]
      rest = rest.slice(space[0].length)
      continue
    }
    const mark = matchEdgeMarkAt(rest, false)
    if (mark) {
      lead += mark
      rest = rest.slice(mark.length)
      continue
    }
    const tok = matchTokenAt(rest, false)
    if (!tok) break
    lead += tok
    rest = rest.slice(tok.length)
  }

  for (;;) {
    const space = rest.match(/[\s\u3000]+$/)
    if (space) {
      trail = space[0] + trail
      rest = rest.slice(0, -space[0].length)
      continue
    }
    const mark = matchEdgeMarkAt(rest, true)
    if (mark) {
      trail = mark + trail
      rest = rest.slice(0, -mark.length)
      continue
    }
    const tok = matchTokenAt(rest, true)
    if (!tok) break
    trail = tok + trail
    rest = rest.slice(0, -tok.length)
  }

  return { lead, core: rest, trail }
}

/** Match RM controls only, including bracketed color and icon codes; exclude decorative ellipses. */
const CONTROL_AFFIX = /^(?:\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|[A-Za-z_][A-Za-z0-9_]*\[\d+\])/

function matchControlAffixAt(text: string, atEnd: boolean): string | null {
  if (!atEnd) {
    const m = text.match(CONTROL_AFFIX)
    return m && !/^\\RB\[/i.test(m[0]) ? m[0] : null
  }
  /* Find the longest trailing control by scanning all matches ending at the boundary. */
  const re = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|[A-Za-z_][A-Za-z0-9_]*\[\d+\]/g
  let hit: string | null = null
  for (const m of text.matchAll(re)) {
    if (/^\\RB\[/i.test(m[0])) continue
    const i = m.index ?? 0
    if (i + m[0].length === text.length) hit = m[0]
  }
  return hit
}

/** Remove only boundary RM controls and adjacent whitespace for storage and scrubbing. Unlike {@link peelProtectShell}, preserve decorations to avoid changing cache keys. */
export function peelControlShell(text: string): { lead: string; core: string; trail: string } {
  let rest = String(text ?? '')
  let lead = ''
  let trail = ''

  for (;;) {
    const space = rest.match(/^[\s\u3000]+/)
    if (space) {
      lead += space[0]
      rest = rest.slice(space[0].length)
      continue
    }
    const tok = matchControlAffixAt(rest, false)
    if (!tok) break
    lead += tok
    rest = rest.slice(tok.length)
  }

  for (;;) {
    const space = rest.match(/[\s\u3000]+$/)
    if (space) {
      trail = space[0] + trail
      rest = rest.slice(0, -space[0].length)
      continue
    }
    const tok = matchControlAffixAt(rest, true)
    if (!tok) break
    trail = tok + trail
    rest = rest.slice(0, -tok.length)
  }

  return { lead, core: rest, trail }
}

/** Remove controls and placeholders to determine whether the remaining text needs translation. */
export function stripControlNoise(text: string): string {
  return String(text ?? '')
    .replace(PROTECT_TOKEN, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
}

/** Replace inline controls, percent placeholders and decorations with ASCII slots. */
export function protectControlCodes(text: string): { plain: string; tokens: string[] } {
  const tokens: string[] = []
  const plain = String(text ?? '').replace(PROTECT_TOKEN, (m) => {
    const i = tokens.length
    tokens.push(m)
    return `__C${i}__`
  })
  return { plain, tokens }
}

/** Use model-friendly ASCII placeholders to avoid losing Unicode brackets. */
const PLACEHOLDER_RE = /__C(\d+)__/g
const PLACEHOLDER_FALLBACK_RE = /__Ｃ(\d+)__|＿＿C(\d+)＿＿|\[\[C(\d+)\]\]/g

/** Restore original tokens from their placeholders. */
export function restoreControlCodes(translated: string, tokens: string[]): string {
  if (!tokens.length) return translated
  const pick = (n: string) => {
    const i = Number(n)
    return Number.isFinite(i) && tokens[i] != null ? tokens[i]! : null
  }
  let out = String(translated ?? '').replace(PLACEHOLDER_RE, (m, n) => pick(n) ?? m)
  out = out.replace(PLACEHOLDER_FALLBACK_RE, (m, a, b, c) => pick(a || b || c) ?? m)
  return out
}

export type ProtectForTranslate = {
  /** Body after removing boundary controls; inline placeholders and controls may remain. */
  core: string
  lead: string
  trail: string
  plain: string
  tokens: string[]
}

/** Before translation, remove choice conditions and boundary shells, then protect inline placeholders, controls and decorations. Keep removed content for exact restoration. */
export function protectForTranslate(text: string): ProtectForTranslate {
  if (isDynamicTemplate(text)) return { core: text, lead: '', trail: '', ...protectControlCodes(text) }
  const content = translationSegmentContent(text)
  const shell = peelProtectShell(content.core)
  const lead = content.lead + shell.lead
  const core = shell.core
  const trail = shell.trail + content.trail
  const { plain, tokens } = protectControlCodes(core)
  return { core, lead, trail, plain, tokens }
}

/** Sentence pipeline keeps visible punctuation and wrappers in both the engine request and stored key. */
export function protectSentenceForTranslate(text: string): ProtectForTranslate {
  const choice = peelChoiceMetaShell(text)
  const shell = peelControlShell(choice.core)
  const tokens: string[] = []
  const plain = shell.core.replace(new RegExp(`${SENTENCE_TOKEN_SOURCE}|${PROTECT_TOKEN.source}`, 'g'), (token) => {
    const id = tokens.length
    tokens.push(token)
    return `__C${id}__`
  })
  return { core: shell.core, lead: choice.lead + shell.lead, trail: shell.trail + choice.trail, plain, tokens }
}

/** Restore boundary shells for immediate in-game replacement. */
export function restoreForTranslate(translated: string, ctx: ProtectForTranslate): string {
  return ctx.lead + restoreControlCodes(translated, ctx.tokens) + ctx.trail
}

/** Return only the translated body for caching, excluding boundary controls. */
export function translationCoreForCache(translated: string, ctx: ProtectForTranslate): string {
  return restoreControlCodes(translated, ctx.tokens)
}

/** Compare source and target after NFKC and whitespace normalization. */
export function isIdenticalTranslation(src: string, zh: string): boolean {
  return normCmp(src) === normCmp(zh)
}

/** Store only changed, fully translated text; reject targets with remaining kana and ignore RM controls during validation. */
export function isStorableTranslation(src: string, zh: string, targetLang = 'zh'): boolean {
  if (!validDynamicTranslation(src, zh)) return false
  if (translationRubyChunks(zh).some((part) => part.ruby && JAPANESE.test(part.base! + part.reading!))) return false
  if (!String(src ?? '').trim() || !String(zh ?? '').trim() || isIdenticalTranslation(src, zh)) return false
  const sourceText = normCmp(stripControlNoise(src))
  const translatedText = normCmp(stripControlNoise(zh))
  if (!translatedText || (sourceText && sourceText === translatedText)) return false
  if (JAPANESE.test(translatedText)) return false
  if (retainsJapaneseHanPhrase(sourceText, translatedText)) return false
  const isTargetZh =
    !targetLang || targetLang === 'zh' || targetLang === 'ch' || targetLang === 'zh-CN' || targetLang === 'zh-Hans' || targetLang === 'zh-TW' || targetLang === 'cht'
  if (isTargetZh) {
    return HAN.test(translatedText)
  }
  return true
}

/** Explicit imports may intentionally preserve kana-free labels, names and abbreviations. */
export function isReusableTranslation(src: string, zh: string): boolean {
  if (isStorableTranslation(src, zh)) return true
  if (!src.trim() || !zh.trim() || !isIdenticalTranslation(src, zh)) return false
  const body = stripControlNoise(src)
  return !JAPANESE.test(body) && /[A-Za-z\u4e00-\u9fff]/.test(body)
}

/** Validate engine output: reject empty or unchanged results and require Han characters when the source needs Chinese translation. */
export function isUsefulTranslation(src: string, send: string, raw: string, zh: string, targetLang = 'zh'): boolean {
  if (!String(raw ?? '').trim() || !String(zh ?? '').trim()) return false
  if (!isStorableTranslation(src, zh, targetLang)) return false
  if (normCmp(raw) === normCmp(send)) return false
  const placeholders = send.match(/__C\d+__/g) || []
  if (JSON.stringify([...placeholders].sort()) !== JSON.stringify((raw.match(/__C\d+__/g) || []).sort())) return false
  const srcNeedsZh = JAPANESE.test(src) || HAN.test(stripControlNoise(src))
  const isTargetZh =
    !targetLang || targetLang === 'zh' || targetLang === 'ch' || targetLang === 'zh-CN' || targetLang === 'zh-Hans' || targetLang === 'zh-TW' || targetLang === 'cht'
  if (isTargetZh && srcNeedsZh && !HAN.test(zh)) return false
  return true
}

/** Determine whether text needs translation after removing shells and placeholders; exclude punctuation-only content. */
export function shouldTranslate(text: string, sourceLang?: string | number): boolean {
  if (typeof sourceLang === 'number') sourceLang = undefined
  const core = stripControlNoise(text)
  if (!core) return false
  if (sourceLang && sourceLang !== 'ja' && sourceLang !== 'en') {
    const compact = core.replace(/[\s\u3000]+/g, '')
    return compact.length > 0 && !/^[\p{P}\p{S}]+$/u.test(compact)
  }
  if (!JAPANESE.test(core) && !isSourceText(core, 'en')) return false
  const compact = core.replace(/[\s\u3000]+/g, '')
  return !(compact.length > 0 && /^[\p{P}\p{S}]+$/u.test(compact))
}

/** Count Unicode code points. */
export function charCount(text: string): number {
  return Array.from(String(text ?? '')).length
}

/** Count text lines, with a minimum of one. */
export function lineCount(text: string): number {
  const src = String(text ?? '')
  if (!src) return 0
  return src.split(/\r\n|\n|\r/).length
}
