/** Soft-break logic view: matching text + reversible UTF-16 maps back to the original. */
import type { CacheLang } from '@/lib/translate/cache-lang'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { RM_ESCAPE_RE } from '@/lib/translate/rm-escape'
import { TEXT_MARKUP_RE } from '@/lib/translate/source-text'

export type NewlineKind = 'soft' | 'hard' | 'unknown'
export type NewlineAnnotation = { start: number; end: number; kind: NewlineKind }

export type LogicTextView = {
  original: string
  logic: string
  /** Parallel to `logic`; original UTF-16 index, or -1 for inserted spaces. */
  logicToOriginal: number[]
  /** Breaks that remain in `logic` (hard + unknown), in logic coordinates. */
  logicNewlines: NewlineAnnotation[]
}

const TOKEN_RE = new RegExp(`${RM_ESCAPE_RE.source}|${TEXT_MARKUP_RE.source}|https?:\\/\\/[^\\s<>]+`, 'g')
const INDENT = /[\t \u3000]/
const WORD = /[A-Za-z0-9']/
/** Sentence-ending marks: newline after these is treated as a hard seam. */
const SENTENCE_END = /[。．.!！?？;；]/
/** Letters / numbers / CJK — mid-phrase wrap with these on both sides → soft. */
const WORDISH = /[\p{L}\p{N}]/u

/**
 * Heuristic when no explicit annotation: mid-phrase wrap (no punct on either side) → soft;
 * after sentence-end punct → hard; otherwise unknown.
 */
export function inferNewlineKind(text: string, start: number, end: number): NewlineKind {
  const src = String(text ?? '')
  if (start < 0 || end <= start || end > src.length) return 'unknown'
  let left = start - 1
  while (left >= 0 && INDENT.test(src[left]!)) left -= 1
  let right = end
  while (right < src.length && INDENT.test(src[right]!)) right += 1
  const L = left >= 0 ? src[left] : undefined
  const R = right < src.length ? src[right] : undefined
  if (L == null || R == null) return 'unknown'
  if (SENTENCE_END.test(L) || SENTENCE_END.test(R)) return 'hard'
  if (WORDISH.test(L) && WORDISH.test(R)) return 'soft'
  return 'unknown'
}

export function newlineKindAt(start: number, end: number, annotations: ReadonlyArray<NewlineAnnotation> | undefined, text?: string): NewlineKind {
  if (annotations?.length) {
    for (const note of annotations) {
      if (note.start === start && note.end === end) return note.kind
      if (note.start <= start && end <= note.end) return note.kind
    }
  }
  return text != null ? inferNewlineKind(text, start, end) : 'unknown'
}

/** CJK scripts join soft breaks; spaced languages may insert U+0020. Unknown lang → spaced (safer). */
export function usesSpacedSoftBreaks(srcLang: CacheLang | '' | undefined, sample: string): boolean {
  const lang = srcLang || detectCacheLang(sample, 'en')
  return lang !== 'ja' && lang !== 'zh' && lang !== 'ko'
}

function shouldInsertSpace(left: string | undefined, right: string | undefined, spaced: boolean): boolean {
  if (!spaced || left == null || right == null) return false
  if (/\s/.test(left) || /\s/.test(right) || INDENT.test(left) || INDENT.test(right)) return false
  return WORD.test(left) && WORD.test(right)
}

/**
 * Remove confirmed soft breaks (+ following indent) for matching; keep hard/unknown in logic.
 * Inserted spaces map to -1. Does not rewrite the original string.
 */
export function buildLogicText(original: string, opts?: { newlines?: ReadonlyArray<NewlineAnnotation>; srcLang?: CacheLang | '' }): LogicTextView {
  const text = String(original ?? '')
  const spaced = usesSpacedSoftBreaks(opts?.srcLang, text)
  const controls = new Map([...text.matchAll(TOKEN_RE)].map((m) => [m.index!, m[0]]))
  const logicToOriginal: number[] = []
  const logicNewlines: NewlineAnnotation[] = []
  let logic = ''

  for (let i = 0; i < text.length;) {
    const code = controls.get(i)
    if (code && !/^\\[nr]$/i.test(code)) {
      for (let k = 0; k < code.length; k++) {
        logic += code[k]!
        logicToOriginal.push(i + k)
      }
      i += code.length
      continue
    }
    const c = text[i]!
    const literalLine = Boolean(code && /^\\[nr]$/i.test(code))
    if (c === '\n' || c === '\r' || literalLine) {
      const end = literalLine ? i + code!.length : c === '\r' && text[i + 1] === '\n' ? i + 2 : i + 1
      const kind = newlineKindAt(i, end, opts?.newlines, text)
      if (kind === 'soft') {
        let j = end
        while (j < text.length && INDENT.test(text[j]!)) j += 1
        const left = logic.length ? logic[logic.length - 1] : undefined
        const right = j < text.length ? text[j] : undefined
        if (shouldInsertSpace(left, right, spaced)) {
          logic += ' '
          logicToOriginal.push(-1)
        }
        i = j
        continue
      }
      const logicStart = logic.length
      for (let k = i; k < end; k++) {
        logic += text[k]!
        logicToOriginal.push(k)
      }
      logicNewlines.push({ start: logicStart, end: logic.length, kind })
      i = end
      continue
    }
    logic += c
    logicToOriginal.push(i)
    i += 1
  }

  return { original: text, logic, logicToOriginal, logicNewlines }
}

/** List real / literal `\\n` breaks in `text` with inferred kind (explicit overrides applied by callers). */
export function listNewlineSpans(text: string): Array<{ start: number; end: number; kind: NewlineKind }> {
  const src = String(text ?? '')
  const controls = new Map([...src.matchAll(TOKEN_RE)].map((m) => [m.index!, m[0]]))
  const spans: Array<{ start: number; end: number; kind: NewlineKind }> = []
  for (let i = 0; i < src.length;) {
    const code = controls.get(i)
    if (code && !/^\\[nr]$/i.test(code)) {
      i += code.length
      continue
    }
    const c = src[i]!
    const literalLine = Boolean(code && /^\\[nr]$/i.test(code))
    if (c === '\n' || c === '\r' || literalLine) {
      const end = literalLine ? i + code!.length : c === '\r' && src[i + 1] === '\n' ? i + 2 : i + 1
      spans.push({ start: i, end, kind: inferNewlineKind(src, i, end) })
      i = end
      continue
    }
    i += 1
  }
  return spans
}

/** Reject annotations that do not sit on an actual break, or use an unknown kind. */
export function validateNewlineAnnotations(text: string, annotations: ReadonlyArray<NewlineAnnotation> | undefined): boolean {
  if (!annotations) return true
  if (!Array.isArray(annotations) || annotations.length > 500) return false
  const allowed = new Set(listNewlineSpans(text).map((s) => `${s.start}:${s.end}`))
  for (const note of annotations) {
    if (!note || typeof note !== 'object') return false
    if (!['soft', 'hard', 'unknown'].includes(note.kind)) return false
    if (!Number.isInteger(note.start) || !Number.isInteger(note.end) || note.end <= note.start) return false
    if (!allowed.has(`${note.start}:${note.end}`)) return false
  }
  return true
}

/** Map a half-open logic range onto the covering original span (includes skipped soft breaks between). */
export function mapLogicRangeToOriginal(view: LogicTextView, logicStart: number, logicEnd: number): { start: number; end: number } {
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  const lo = Math.max(0, logicStart)
  const hi = Math.min(view.logicToOriginal.length, logicEnd)
  for (let i = lo; i < hi; i++) {
    const o = view.logicToOriginal[i]!
    if (o < 0) continue
    if (o < start) start = o
    if (o + 1 > end) end = o + 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: 0, end: 0 }
  return { start, end }
}
