/**
 * Cache-optimize splitter: peel outer shells + edge junk, then cut on sentence and clause
 * punctuation. Edge junk uses Unicode categories (`\p{S}` / `\p{Po}`) so glyphs like ▼
 * need not be enumerated. Does not change playtime `translationSegments`.
 */

import { SENTENCE_TOKEN_SOURCE, sentenceBoundaryAt } from '@/lib/translate/sentence-units'
import { scanStructuredText, type StructureAnnotation } from '@/lib/translate/structured-segments'
import { peelControlShell } from '@/services/translate/text-classify'

const SHELL_CLOSE: Record<string, string> = {
  '「': '」',
  '『': '』',
  '【': '】',
  '《': '》',
  '〈': '〉',
  '（': '）',
  '(': ')',
  '＜': '＞',
  '<': '>',
  '［': '］',
  '[': ']',
  '“': '”',
  '‘': '’',
}

const PROTECT: Record<string, string> = {
  ...SHELL_CLOSE,
  '{': '}',
  '｛': '｝',
}

/**
 * Edge symbols / decorative other-punct (▼ ※ … ：).
 * Sentence tone `.。．!！?？` is kept on purpose — count-matched pairs are not trusted alignment.
 */
const EDGE_JUNK_CHAR = /[\s\u3000\p{S}※…‥⋯･・：:＃#￥$%＆&＊*＝=＋+～~＠@＾^｜|／/＼\\]/u
const EDGE_JUNK_START = new RegExp(`^(?:${EDGE_JUNK_CHAR.source})+`, 'u')
const EDGE_JUNK_END = new RegExp(`(?:${EDGE_JUNK_CHAR.source})+$`, 'u')

function isBalancedOuter(text: string, open: string, close: string): boolean {
  if (text.length < 2 || text[0] !== open || text[text.length - 1] !== close) return false
  // Substitution braces / HTML tags are not optimize shells.
  if (/^\{[A-Za-z0-9_]+\}$/.test(text) || /^<\/?(?:br|span|div|p|b|i|img|ruby|rt)(?:\s[^>]*)?\s*\/?>$/i.test(text)) {
    return false
  }
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === open) depth += 1
    else if (text[i] === close) {
      depth -= 1
      if (depth === 0) return i === text.length - 1
      if (depth < 0) return false
    }
  }
  return false
}

function trimOptimizeSpace(text: string): string {
  return text.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')
}

/** Strip edge symbols / decorative marks; keeps sentence tone `.。！？`. */
export function stripOptimizeEdgeJunk(text: string): string {
  let rest = String(text ?? '')
  for (;;) {
    const next = rest.replace(EDGE_JUNK_START, '').replace(EDGE_JUNK_END, '')
    if (next === rest) return rest
    rest = next
  }
}

const SHELL_OPEN_OF_CLOSE: Record<string, string> = Object.fromEntries(Object.entries(SHELL_CLOSE).map(([o, c]) => [c, o]))

/** Leading open / trailing close with no mate in the string (import fragments like `（好感度：`). */
function stripUnmatchedShellEdges(text: string): string {
  let rest = text
  for (;;) {
    const open = rest[0]
    const closeForOpen = open ? SHELL_CLOSE[open] : undefined
    if (closeForOpen && !rest.includes(closeForOpen)) {
      rest = rest.slice(1)
      continue
    }
    const last = rest[rest.length - 1]
    const openForClose = last ? SHELL_OPEN_OF_CLOSE[last] : undefined
    if (openForClose && !rest.includes(openForClose)) {
      rest = rest.slice(0, -1)
      continue
    }
    return rest
  }
}

/** Peel paired shells, unmatched shell edges, edge junk, and protect markers until stable. */
export function peelOptimizeShell(text: string): string {
  let core = String(text ?? '')
  for (;;) {
    core = trimOptimizeSpace(core)
    const open = core[0]
    const close = open ? SHELL_CLOSE[open] : undefined
    if (close && isBalancedOuter(core, open, close)) {
      core = core.slice(1, -1)
      continue
    }
    const unmatched = stripUnmatchedShellEdges(core)
    if (unmatched !== core) {
      core = unmatched
      continue
    }
    const stripped = stripOptimizeEdgeJunk(core)
    if (stripped !== core) {
      core = stripped
      continue
    }
    // peelControlShell keeps tone marks (?！。) while still dropping boundary RM controls.
    const protectedCore = peelControlShell(core).core
    if (protectedCore !== core) {
      // Keep whole substitution slots (`{actor}`); peeling them would leave an empty body.
      if (!protectedCore && /^\{[A-Za-z0-9_]+\}$/.test(core)) return core
      core = protectedCore
      continue
    }
    return trimOptimizeSpace(core)
  }
}

/** @deprecated Use peelOptimizeShell — kept for older call sites / tests. */
export const peelOptimizeDialogueShell = peelOptimizeShell

/**
 * Import fragments often look like JS string concat: `'レオン' + '（好感度：' +`.
 * When the whole row is only quoted literals joined by `+`, return each literal's contents.
 */
export function extractJsConcatLiterals(text: string): string[] | null {
  const trimmed = trimOptimizeSpace(String(text ?? ''))
  if (!trimmed.includes('+') || !/['"]/.test(trimmed)) return null

  const literals: string[] = []
  const re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(trimmed)) !== null) {
    const between = trimmed.slice(last, match.index)
    if (last === 0) {
      if (!/^[\s\u3000]*$/.test(between)) return null
    } else if (!/^[\s\u3000]*\+[\s\u3000]*$/.test(between)) {
      return null
    }
    const raw = match[0]
    literals.push(raw.slice(1, -1).replace(/\\([\\'"])/g, '$1'))
    last = match.index + raw.length
  }
  if (!literals.length) return null
  const tail = trimmed.slice(last)
  if (!/^([\s\u3000]*\+[\s\u3000]*)*$/.test(tail)) return null
  return literals
}

/**
 * Peel outer shells / edge junk, then split on sentence/clause punctuation outside protective brackets.
 * Each part is re-stripped so body keys stay punctuation-light.
 * JS concat import rows are split into quoted literals first, then each literal is peeled.
 */
export function optimizeSplitSegments(text: string, structure?: StructureAnnotation): string[] {
  if (structure?.mode === 'disabled') return text ? [text] : []
  const parsed = scanStructuredText(text, structure)
  if (parsed.units.length) return parsed.units.map((u) => text.slice(u.start, u.end))
  const literals = extractJsConcatLiterals(text)
  if (literals) {
    const parts: string[] = []
    for (const lit of literals) {
      for (const part of optimizeSplitSegments(lit)) {
        if (part) parts.push(part)
      }
    }
    return parts
  }

  const body = peelOptimizeShell(text)
  if (!body) return []

  const stack: string[] = []
  const tokens = new Map([...body.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'))].map((m) => [m.index!, m[0]]))
  const parts: string[] = []
  let start = 0

  for (let i = 0; i < body.length; i++) {
    const token = tokens.get(i)
    if (token) {
      i += token.length - 1
      continue
    }
    const ch = body[i]
    if (PROTECT[ch]) {
      stack.push(PROTECT[ch])
      continue
    }
    if (stack.length && stack[stack.length - 1] === ch) {
      stack.pop()
      continue
    }
    if (stack.length) continue
    const seam = sentenceBoundaryAt(body, i)
    if (!seam) continue
    i = seam.end - 1
    const part = peelOptimizeShell(trimOptimizeSpace(body.slice(start, i + 1)))
    if (part) parts.push(part)
    start = i + 1
  }

  const tail = peelOptimizeShell(trimOptimizeSpace(body.slice(start)))
  if (tail) parts.push(tail)
  return parts
}

export type OptimizeSegmentPair = { src: string; zh: string }

export type OptimizeSegmentsResult = {
  srcParts: string[]
  zhParts: string[]
  pairs: OptimizeSegmentPair[]
  /**
   * True when source and target yield the same segment count.
   * Count match is only a UI hint — never trusted alignment evidence.
   */
  aligned: boolean
  /** Always false for auto-derived pairs; human/import verified mappings set trust elsewhere. */
  trusted: false
}

/** Pair source/target optimize splits in order; missing side becomes ''. */
export function buildOptimizeSegmentPairs(src: string, zh: string, structure?: { source?: StructureAnnotation; target?: StructureAnnotation }): OptimizeSegmentsResult {
  const srcParts = optimizeSplitSegments(src, structure?.source)
  const zhParts = optimizeSplitSegments(zh, structure?.target)
  const n = Math.max(srcParts.length, zhParts.length)
  const pairs: OptimizeSegmentPair[] = []
  for (let i = 0; i < n; i += 1) {
    pairs.push({ src: srcParts[i] || '', zh: zhParts[i] || '' })
  }
  return {
    srcParts,
    zhParts,
    pairs,
    aligned: srcParts.length === zhParts.length && srcParts.length > 0,
    trusted: false,
  }
}

/** True when `part` is `text` with only a trailing edge-junk suffix removed (e.g. `：` / `。`). */
function onlyTrailingEdgeJunkRemoved(text: string, part: string): boolean {
  const trim = trimOptimizeSpace(text)
  if (!part || part === trim || !trim.startsWith(part)) return false
  const suffix = trim.slice(part.length)
  return Boolean(suffix) && stripOptimizeEdgeJunk(suffix) === ''
}

/**
 * Whether peel/split yields writeable keys that differ from the whole-row text
 * (multi-sentence, body-only after `【】` / `▼` / quotes / …).
 * Trailing-only junk trim (e.g. `短い。` → `短い`) is not a candidate; unmatched shell peels are.
 */
export function hasOptimizeCandidates(src: string, zh = ''): boolean {
  const result = buildOptimizeSegmentPairs(src, zh)
  if (!result.pairs.length) return false
  if (result.pairs.length > 1) return true
  const only = result.pairs[0]
  const srcTrim = trimOptimizeSpace(String(src ?? ''))
  const zhTrim = trimOptimizeSpace(String(zh ?? ''))
  const srcChanged = only.src !== srcTrim && !onlyTrailingEdgeJunkRemoved(srcTrim, only.src)
  const zhChanged = Boolean(zhTrim) && only.zh !== zhTrim && !onlyTrailingEdgeJunkRemoved(zhTrim, only.zh)
  return srcChanged || zhChanged
}

/** @deprecated Prefer opening the optimize page; kept for call-site compat. */
export function canOptimizeTranslation(src: string, zh = ''): boolean {
  return hasOptimizeCandidates(src, zh)
}
