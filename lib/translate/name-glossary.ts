/** Confirmed game-name spans for sentence locking. No I/O. */

import { SENTENCE_TOKEN_SOURCE } from '@/lib/translate/sentence-units'

export const NAME_GLOSSARY_CATEGORIES = ['actor', 'actor_nickname', 'item', 'weapon', 'armor', 'skill', 'enemy', 'state', 'map'] as const
export type NameGlossaryCategory = (typeof NAME_GLOSSARY_CATEGORIES)[number]

export type NameEntry = { src: string; zh: string; category?: string }
export type NameSpan = { start: number; end: number; src: string; zh: string }
export type NameGap = { id: string; start: number; end: number; text: string }

const TOKEN_RE = new RegExp(SENTENCE_TOKEN_SOURCE, 'g')
const LATIN = /[A-Za-z]/u
const LATIN_OR_DIGIT = /[A-Za-z0-9]/u
const APOSTROPHE_S = ["'s", '\u2019s'] as const

export function isNameGlossaryCategory(value: string | undefined): value is NameGlossaryCategory {
  return !!value && (NAME_GLOSSARY_CATEGORIES as readonly string[]).includes(value)
}

export function isZhNameTarget(toLang?: string | null): boolean {
  if (!toLang) return true
  const lower = toLang.toLowerCase()
  return lower === 'zh' || lower === 'ch' || lower === 'zh-cn' || lower === 'zh-hans'
}

export function isUsableNamePair(src: string, zh: string | null | undefined): boolean {
  const from = String(src ?? '').trim()
  const to = String(zh ?? '').trim()
  if (!from || !to || from === to) return false
  if ([...from].length < 2) return false
  if (/^[A-Za-z]$/.test(from)) return false
  return true
}

export function expandNameVariants(entry: NameEntry, toLang?: string | null): NameEntry[] {
  if (!isUsableNamePair(entry.src, entry.zh)) return []
  const out: NameEntry[] = [{ src: entry.src, zh: entry.zh, category: entry.category }]
  if (!isZhNameTarget(toLang) || !LATIN.test(entry.src)) return out
  if (APOSTROPHE_S.some((suffix) => entry.src.endsWith(suffix))) return out
  const possessiveZh = entry.zh.endsWith('的') ? entry.zh : `${entry.zh}的`
  for (const suffix of APOSTROPHE_S) {
    out.push({ src: `${entry.src}${suffix}`, zh: possessiveZh, category: entry.category })
  }
  return out
}

export function nameEntriesFromLookup(srcNames: Iterable<string>, lookup: Record<string, string>, toLang?: string | null): NameEntry[] {
  const pairs: NameEntry[] = []
  for (const src of srcNames) {
    const zh = String(lookup[src] || '').trim()
    if (!isUsableNamePair(src, zh)) continue
    pairs.push({ src, zh })
  }
  return entriesFromNamePairs(pairs, toLang)
}

export function entriesFromNamePairs(pairs: Iterable<NameEntry>, toLang?: string | null): NameEntry[] {
  const usable = [...pairs].filter((pair) => isUsableNamePair(pair.src, pair.zh))
  const sources = new Set(usable.map((pair) => pair.src))
  const bySrc = new Map<string, NameEntry>()
  for (const pair of usable) {
    // A relational label must compose from its owner's name, not freeze an older full translation.
    const owner = pair.src.match(/^(.+?)['\u2019]s\s+\S/u)?.[1]
    if (owner && sources.has(owner)) continue
    for (const entry of expandNameVariants(pair, toLang)) {
      if (!bySrc.has(entry.src) || entry.src.length > (bySrc.get(entry.src)?.src.length || 0)) bySrc.set(entry.src, entry)
    }
  }
  return [...bySrc.values()].sort((a, b) => b.src.length - a.src.length || a.src.localeCompare(b.src))
}

function tokenRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  TOKEN_RE.lastIndex = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0
    ranges.push({ start, end: start + match[0].length })
  }
  return ranges
}

function overlaps(start: number, end: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => start < range.end && end > range.start)
}

function latinBoundary(text: string, start: number, end: number, src: string): boolean {
  if (!LATIN.test(src)) return true
  const left = text[start - 1] || ''
  const right = text[end] || ''
  if (LATIN_OR_DIGIT.test(text[start] || '') && LATIN_OR_DIGIT.test(left)) return false
  if (LATIN_OR_DIGIT.test(text[end - 1] || '') && LATIN_OR_DIGIT.test(right)) return false
  return true
}

export function findNameSpans(text: string, entries: readonly NameEntry[], toLang?: string | null): NameSpan[] {
  const source = String(text ?? '')
  if (!source || !entries.length) return []
  const variants = entriesFromNamePairs(entries, toLang)
  const blocked = tokenRanges(source)
  const spans: NameSpan[] = []
  for (const entry of variants) {
    let from = 0
    while (from < source.length) {
      const start = source.indexOf(entry.src, from)
      if (start < 0) break
      const end = start + entry.src.length
      from = start + 1
      if (overlaps(start, end, blocked) || overlaps(start, end, spans)) continue
      if (!latinBoundary(source, start, end, entry.src)) continue
      spans.push({ start, end, src: entry.src, zh: entry.zh })
      blocked.push({ start, end })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

export function nameGaps(src: string, spans: readonly NameSpan[]): NameGap[] {
  const gaps: NameGap[] = []
  let at = 0
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start > at) gaps.push({ id: `${at}:${span.start}`, start: at, end: span.start, text: src.slice(at, span.start) })
    at = Math.max(at, span.end)
  }
  if (at < src.length) gaps.push({ id: `${at}:${src.length}`, start: at, end: src.length, text: src.slice(at) })
  return gaps
}

export function isLiteralNameGap(text: string): boolean {
  return !text || !text.replace(/\s+/g, '') || /^[\s\p{P}\p{S}]+$/u.test(text)
}

export function padGapTranslation(original: string, translated: string): string {
  if (isLiteralNameGap(original)) return original
  const lead = original.match(/^\s*/)?.[0] || ''
  const trail = original.match(/\s*$/)?.[0] || ''
  return lead + String(translated ?? '').trim() + trail
}

export function stitchNameLocks(src: string, spans: readonly NameSpan[], gapZh: ReadonlyMap<string, string>): string {
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  let out = ''
  let at = 0
  function appendGap(end: number, nextName = '') {
    const gap = src.slice(at, end)
    const translated = gapZh.get(`${at}:${end}`)
    let text = padGapTranslation(gap, translated ?? gap)
    if (translated !== undefined && !isLiteralNameGap(gap)) {
      // Drop English padding only at translated CJK joins; keep literal and interior spacing.
      if (/[\u3400-\u9fff]$/u.test(out)) text = text.replace(/^ +(?=[\u3400-\u9fff])/u, '')
      if (/^[\u3400-\u9fff]/u.test(nextName)) text = text.replace(/([\u3400-\u9fff]) +$/u, '$1')
    }
    out += text
  }
  for (const span of ordered) {
    if (span.start > at) appendGap(span.start, span.zh)
    out += span.zh
    at = span.end
  }
  if (at < src.length) appendGap(src.length)
  return out
}
