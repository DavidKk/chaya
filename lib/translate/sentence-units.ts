/** Lossless short-sentence boundaries. Offsets always refer to the original UTF-16 string. */
import type { CacheLang } from '@/lib/translate/cache-lang'
import { buildLogicText, mapLogicRangeToOriginal, type NewlineAnnotation, type NewlineKind } from '@/lib/translate/logic-text'

import { RM_ESCAPE_RE } from './rm-escape'
import { TEXT_MARKUP_RE } from './source-text'

export type { NewlineAnnotation, NewlineKind } from '@/lib/translate/logic-text'
export { buildLogicText, inferNewlineKind, mapLogicRangeToOriginal, newlineKindAt, usesSpacedSoftBreaks } from '@/lib/translate/logic-text'

export const SENTENCE_TOKEN_SOURCE = `${RM_ESCAPE_RE.source}|${TEXT_MARKUP_RE.source}|https?:\\/\\/[^\\s<>]+`
/** Bumped for mid-phrase soft inference (no punct → soft match). */
export const SENTENCE_RULE_VERSION = 4
export type SentenceUnit = { start: number; end: number; key: string; tone: string; boundary: string; controls: string; block: number }

export type SentenceUnitOptions = {
  /** Explicit newline spans on the original string. Unannotated mid-phrase wraps infer soft. */
  newlines?: ReadonlyArray<NewlineAnnotation>
  /** Affects soft-break space insertion (CJK join vs spaced languages). */
  srcLang?: CacheLang | ''
}

const PAIRS: Record<string, string> = { '<': '>', '「': '」', '『': '』', '【': '】', '《': '》', '〈': '〉', '（': '）', '(': ')', '[': ']', '{': '}', '“': '”' }
const WIDTH: Record<string, string> = { '？': '?', '！': '!', '，': ',', '。': '.', '．': '.', '；': ';' }
export function punctuationKey(text: string): string {
  return text.replace(/[？！，。．；]/g, (c) => WIDTH[c]).replace(/([!?])\1{2,}/g, '$1$1')
}
export function controlSignature(text: string): string {
  return JSON.stringify(text.match(new RegExp(`${SENTENCE_TOKEN_SOURCE}|%\\d+|\\{[A-Za-z0-9_]+\\}|__[A-Za-z]\\d+__`, 'g')) || [])
}
export function wholeSentenceKey(text: string): string {
  // Avoid normalizing control parameters or erasing word spacing / unknown line breaks.
  const normalized = text.trim()
  let out = '',
    at = 0
  for (const match of normalized.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'))) {
    out += punctuationKey(normalized.slice(at, match.index).replace(/\r\n?/g, '\n')) + match[0]
    at = match.index! + match[0].length
  }
  return out + punctuationKey(normalized.slice(at).replace(/\r\n?/g, '\n'))
}
/** Wider body alias, separate from the narrow authority-equivalence key. Controls stay byte-for-byte. */
export function sentenceBodyKey(text: string): string {
  let out = '',
    at = 0
  for (const match of text.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'))) {
    out += punctuationKey(text.slice(at, match.index).normalize('NFKC')) + match[0]
    at = match.index! + match[0].length
  }
  return out + punctuationKey(text.slice(at).normalize('NFKC'))
}

function newlineKindOnLogic(start: number, end: number, annotations: ReadonlyArray<NewlineAnnotation>): NewlineKind {
  for (const note of annotations) {
    if (note.start === start && note.end === end) return note.kind
    if (note.start <= start && end <= note.end) return note.kind
  }
  return 'unknown'
}

/** Split `text` using only punctuation and hard line annotations (coordinates of `text`). */
function splitSentenceUnitsOn(text: string, hardOrUnknown: ReadonlyArray<NewlineAnnotation>): SentenceUnit[] {
  const units: SentenceUnit[] = []
  const controls = new Map([...text.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'))].map((m) => [m.index!, m[0]]))
  const stack: string[] = []
  let start = 0
  let block = 0
  function push(end: number, boundary: string) {
    const raw = text.slice(start, end)
    const tail = raw.match(/[,.!?;，。．！？；\s]+$/u)?.[0] || ''
    const body = raw.slice(0, raw.length - tail.length).trim()
    const marks = punctuationKey(tail.replace(/\s/g, ''))
    const tone = marks.match(/[!?]+/)?.[0] || (marks.includes('.') ? '.' : '')
    if (body) units.push({ start, end, key: sentenceBodyKey(body), tone, boundary, controls: controlSignature(raw), block })
    start = end
  }
  for (let i = 0; i < text.length; i++) {
    const code = controls.get(i)
    if (code && !/^\\[nr]$/i.test(code)) {
      i += code.length - 1
      continue
    }
    const c = text[i]!
    if (PAIRS[c]) stack.push(PAIRS[c])
    else if (stack.at(-1) === c) stack.pop()
    if (stack.length) continue
    const literalLine = code && /^\\[nr]$/i.test(code)
    if (c === '\n' || c === '\r' || literalLine) {
      const end = i + (literalLine ? code!.length : c === '\r' && text[i + 1] === '\n' ? 2 : 1)
      const kind = newlineKindOnLogic(i, end, hardOrUnknown)
      if (kind === 'hard') {
        push(end, 'line')
        block++
      }
      i = end - 1
      continue
    }
    if (!/[,，。．.!！?？;；]/.test(c)) continue
    if (/[,.，．]/.test(c) && /[0-9０-９]/.test(text[i - 1] || '') && /[0-9０-９]/.test(text[i + 1] || '')) continue
    while (i + 1 < text.length && /[,，。．.!！?？;；]/.test(text[i + 1])) i++
    push(i + 1, /[,，]/.test(c) ? ',' : /[;；]/.test(c) ? ';' : 'stop')
  }
  if (start < text.length) push(text.length, 'end')
  return units
}

/**
 * Split on punctuation / confirmed hard line breaks only.
 * Soft breaks are removed in the logic view first (phase 2); unknown stays and does not split.
 */
export function sentenceUnits(text: string, opts?: SentenceUnitOptions): SentenceUnit[] {
  const view = buildLogicText(text, { newlines: opts?.newlines, srcLang: opts?.srcLang })
  const units = splitSentenceUnitsOn(view.logic, view.logicNewlines)
  if (view.logic === text) return units
  return units.map((unit) => {
    const span = mapLogicRangeToOriginal(view, unit.start, unit.end)
    return { ...unit, start: span.start, end: span.end }
  })
}

export function sameSentence(a: SentenceUnit, b: SentenceUnit): boolean {
  return a.key === b.key && a.tone === b.tone && a.controls === b.controls
}

/** Only paired outer wrappers are aliases; sentence punctuation remains part of the body key. */
export function sentenceOuterShell(text: string): { lead: string; core: string; trail: string } {
  const visible = text.trim()
  const trimmed = visible.replace(/[,，。．.!！?？;；]+$/, '')
  const suffix = visible.slice(trimmed.length)
  if (!trimmed || PAIRS[trimmed[0]] !== trimmed.at(-1)) return { lead: '', core: text, trail: '' }
  const stack: string[] = []
  for (let i = 0; i < trimmed.length; i++) {
    if (PAIRS[trimmed[i]]) stack.push(PAIRS[trimmed[i]])
    else if (stack.at(-1) === trimmed[i]) {
      stack.pop()
      if (!stack.length && i !== trimmed.length - 1) return { lead: '', core: text, trail: '' }
    }
  }
  const space = text.indexOf(trimmed)
  return { lead: text.slice(0, space) + trimmed[0], core: trimmed.slice(1, -1), trail: trimmed.at(-1)! + suffix + text.slice(space + visible.length) }
}
