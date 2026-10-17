/** Pure lookup helpers without I/O: whole strings, normalization, lines, RM control segments and trailing-number families. Shared by ChayaTrans and Node game-lookup. */

import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import { lookupGameTerm } from '@/lib/translate/game-terms'
import { hasRmDigitCodes, lookupWithRmDigitTemplate, RM_ESCAPE_RE } from '@/lib/translate/rm-escape'
import {
  mapTranslationCacheLines,
  mapTranslationDisplaySegments,
  mapTranslationRubySegments,
  mapTranslationSegments,
  matchingTranslationRubyPairs,
  translationExportText,
  translationNumberedPrefixPair,
  translationSegmentContent,
} from '@/lib/translate/segments'
import { createSentenceResolver } from '@/lib/translate/sentence-plan'

export type TranslateExtraGet = (src: string) => string | null | undefined

export { applyRmDigitCodes, extractRmDigitCodes, hasRmDigitCodes, toRmDigitTemplate } from '@/lib/translate/rm-escape'

/** Match ChayaTrans normalization: remove stray quotes and script suffixes, then apply NFKC for width variants. */
export function normalizeTranslateKey(text: string): string {
  let s = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  s = s.replace(/^"+/, '').replace(/("\);|"\))$/, '')
  try {
    s = s.normalize('NFKC')
  } catch {
    /* Older runtimes may not support normalize. */
  }
  return s
}

/** Fallback matching only; never use this to rewrite exported text or translated values. */
export function compactTranslateKey(text: string): string {
  let result = ''
  let offset = 0
  for (const match of text.matchAll(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, 'g'))) {
    result += normalizeTranslateKey(text.slice(offset, match.index)).replace(/\s/g, '')
    if (!/^\\[nr]$/i.test(match[0])) result += match[0].normalize('NFKC')
    offset = match.index! + match[0].length
  }
  return result + normalizeTranslateKey(text.slice(offset)).replace(/\s/g, '')
}

/** Build once per cache revision: whitespace forms, body aliases, then safely aligned fragments. */
export function createWhitespaceLookup(entries: Iterable<readonly [string, string]>): TranslateExtraGet {
  // Historical export name retained for callers. No word/character coverage or erased whitespace.
  const records: Array<{ id: string; revision: number; src: string; zh: string; local: boolean }> = []
  const add = (src: string, zh: string) => {
    if (src && zh) records.push({ id: `local:${records.length}`, revision: 0, src, zh, local: true })
  }
  const wrappers: Record<string, string> = { '「': '」', '『': '』', '【': '】', '《': '》', '（': '）', '(': ')' }
  for (const [src, zh] of entries) {
    if (!zh) continue
    add(src, zh)
    const a = peelChoiceMetaShell(src),
      b = peelChoiceMetaShell(zh)
    if ((a.lead || a.trail) && ((!b.lead && !b.trail) || (a.lead === b.lead && a.trail === b.trail)) && !/(?:如果|启用|禁用)\s*[(（]/.test(b.core)) add(a.core, b.core)
    const numbered = translationNumberedPrefixPair(src, zh)
    if (numbered) add(numbered.source, numbered.target)
    if (wrappers[src[0]] === src.at(-1) && wrappers[zh[0]] === zh.at(-1)) add(src.slice(1, -1), zh.slice(1, -1))
    const ruby = matchingTranslationRubyPairs(src, zh)
    if (ruby) for (const pair of ruby) add(pair.source, pair.target)
  }
  const resolver = createSentenceResolver(records)
  return (src) => resolver.plan(src).zh
}

const whitespaceIndexes = new WeakMap<Record<string, string>, TranslateExtraGet>()
export function invalidateWhitespaceLookup(lookup: Record<string, string>) {
  whitespaceIndexes.delete(lookup)
}

export function lookupTranslationRecord(lookup: Record<string, string>, source: string): string | null {
  if (Object.prototype.hasOwnProperty.call(lookup, source) && lookup[source]) return lookup[source]
  let fallback = whitespaceIndexes.get(lookup)
  if (!fallback) {
    fallback = createWhitespaceLookup(Object.entries(lookup))
    whitespaceIndexes.set(lookup, fallback)
  }
  return fallback(source) ?? null
}

/** Split trailing-number families into a stem and number. Exclude obvious sentence endings to avoid treating complete sentences as numbered labels. */
export function trailingNumberParts(text: string): { stem: string; num: string } | null {
  const m = String(text || '').match(/^(.*[^\d０-９])([0-9０-９]+)$/)
  if (!m) return null
  const stem = m[1]
  const num = m[2]
  if (!stem || stem.length < 2) return null
  if (!/[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/.test(stem)) return null
  if (/[ただですますねよ]$/u.test(stem)) return null
  if (/[。！？!?]$/.test(stem)) return null
  return { stem, num }
}

export function stripTrailingNumber(text: string): string {
  return String(text ?? '').replace(/[0-9０-９]+$/, '')
}

export function swapTrailingNumber(translated: string, fromNum: string | null | undefined, toNum: string): string {
  if (!toNum) return translated
  if (!fromNum) return /[0-9０-９]+$/.test(translated) ? translated : translated + toNum
  if (/[0-9０-９]+$/.test(translated)) return translated.replace(/[0-9０-９]+$/, toNum)
  return translated + toNum
}

function lookupExact(lookup: Record<string, string>, extraGet: TranslateExtraGet | undefined, src: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(lookup, src) && lookup[src]) return lookup[src]
  const hit = extraGet?.(src)
  return hit == null || hit === '' ? undefined : hit
}

function lookupPlainOrRmTemplate(lookup: Record<string, string>, text: string, extraGet?: TranslateExtraGet): string | undefined {
  const direct = lookupExact(lookup, extraGet, text)
  if (direct != null) return direct
  if (!hasRmDigitCodes(text)) return undefined
  const hit = lookupWithRmDigitTemplate((key) => lookupExact(lookup, extraGet, key) ?? null, text)
  return hit == null ? undefined : hit
}

/** Try whole, normalized and trimmed keys, including numeric RM control templates. */
export function translatePlain(lookup: Record<string, string>, text: string, extraGet?: TranslateExtraGet): string {
  if (!text) return text
  const direct = lookupPlainOrRmTemplate(lookup, text, extraGet)
  if (direct != null) return direct
  const norm = normalizeTranslateKey(text)
  if (norm !== text) {
    const nHit = lookupPlainOrRmTemplate(lookup, norm, extraGet)
    if (nHit != null) return nHit
  }
  const lead = text.match(/^\s*/)?.[0] ?? ''
  const trail = text.match(/\s*$/)?.[0] ?? ''
  const core = text.slice(lead.length, text.length - trail.length)
  if (core && core !== text) {
    const cHit = lookupPlainOrRmTemplate(lookup, core, extraGet)
    if (cHit != null) return `${lead}${cHit}${trail}`
    const cNorm = normalizeTranslateKey(core)
    if (cNorm !== core) {
      const cnHit = lookupPlainOrRmTemplate(lookup, cNorm, extraGet)
      if (cnHit != null) return `${lead}${cnHit}${trail}`
    }
  }
  const loose = lookupTranslationRecord(lookup, text)
  if (loose != null) return loose
  return (translationSegmentContent(text).core === text ? lookupGameTerm(text) : null) ?? text
}

/** RPG Maker descriptions contain color, font and icon controls. Split around these codes to reuse plain-text cache entries, then restore the controls. */
export function translateRmSegments(lookup: Record<string, string>, text: string, extraGet?: TranslateExtraGet): string {
  if (!RM_ESCAPE_RE.test(text)) return text
  RM_ESCAPE_RE.lastIndex = 0
  let any = false
  let out = ''
  let last = 0
  for (const m of text.matchAll(RM_ESCAPE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) {
      const seg = text.slice(last, idx)
      const zh = translatePlain(lookup, seg, extraGet)
      if (zh !== seg) any = true
      out += zh
    }
    out += m[0]
    last = idx + m[0].length
  }
  if (last < text.length) {
    const seg = text.slice(last)
    const zh = translatePlain(lookup, seg, extraGet)
    if (zh !== seg) any = true
    out += zh
  }
  return any ? out : text
}

function translateByLines(lookup: Record<string, string>, text: string, extraGet?: TranslateExtraGet): string {
  let any = false
  const out = mapTranslationCacheLines(text, (part, original) => {
    const hit = translatePlain(lookup, part, extraGet)
    const legacy = hit === part ? translatePlain(lookup, original, extraGet) : part
    const zh = hit !== part ? hit : legacy !== original ? translationSegmentContent(legacy).core : part
    if (zh !== part) any = true
    return zh
  })
  return any ? out : text
}

/** Infer trailing-number variants from known stems and translations without numbers. The caller maintains stemBase when writing cache entries; see indexTrailingStem. */
export function translateTrailingNumber(text: string, stemBase: ReadonlyMap<string, string>, lookup: Record<string, string>, extraGet?: TranslateExtraGet): string | null {
  const parts = trailingNumberParts(text)
  if (!parts) return null
  const base = stemBase.get(parts.stem)
  if (base != null && base !== '') {
    return swapTrailingNumber(base, null, parts.num)
  }
  // The stem itself may also have a cached translation.
  const stemZh = translatePlain(lookup, parts.stem, extraGet)
  if (stemZh !== parts.stem) return swapTrailingNumber(stemZh, null, parts.num)
  return null
}

/** Index trailing-number stems during cache writes for constant-time variant lookup. */
export function indexTrailingStem(stemBase: Map<string, string>, src: string, zh: string) {
  const parts = trailingNumberParts(src)
  if (!parts) return
  const base = stripTrailingNumber(zh)
  if (!base) return
  // Later entries replace the translation for an existing stem, matching NDJSON replay order.
  stemBase.set(parts.stem, base)
}

export type TranslateWithLookupOptions = {
  extraGet?: TranslateExtraGet
  /** Optional trailing-number stem index; without it, use whole-string, line and control-segment lookup. */
  stemBase?: ReadonlyMap<string, string>
}

/** Translate from the lookup and return the source unchanged on a miss. */
export function translateWithLookup(lookup: Record<string, string>, text: string, opts?: TranslateWithLookupOptions): string {
  if (!text) return text
  const choice = peelChoiceMetaShell(text)
  if ((choice.lead || choice.trail) && choice.core) return choice.lead + translateWithLookup(lookup, choice.core, opts) + choice.trail
  const extraGet = opts?.extraGet
  const plain = translatePlain(lookup, text, extraGet)
  if (plain !== text) return plain
  const display = translationExportText(text)
  if (display !== text) {
    const hit = translatePlain(lookup, display, extraGet)
    if (hit !== display) {
      const { lead, trail } = translationSegmentContent(text)
      return lead + translationSegmentContent(hit).core + trail
    }
  }
  if (opts?.stemBase) {
    const derived = translateTrailingNumber(text, opts.stemBase, lookup, extraGet)
    if (derived != null) return derived
  }
  const byDisplay = mapTranslationDisplaySegments(text, (part) => translateWithLookup(lookup, part, opts))
  if (byDisplay !== text) return byDisplay
  const byRuby = mapTranslationRubySegments(text, (part) => {
    const hit = translateWithLookup(lookup, part, opts)
    return hit === part ? lookupTranslationRecord(lookup, part) : hit
  })
  if (byRuby != null) return byRuby
  const bySegment = mapTranslationSegments(text, (part, original) => {
    const semantic = /[!?！？。．.]/.test(translationSegmentContent(original).trail)
    const hit = semantic ? part : translatePlain(lookup, part, extraGet)
    if (hit !== part) return hit
    const legacy = translatePlain(lookup, original.trim(), extraGet)
    return legacy === original.trim() ? part : translationSegmentContent(legacy).core
  })
  if (bySegment !== text) return bySegment
  const byLine = translateByLines(lookup, text, extraGet)
  if (byLine !== text) return byLine
  return translateRmSegments(lookup, text, extraGet)
}
