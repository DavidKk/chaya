/** Lossless short-sentence boundaries. Offsets always refer to the original UTF-16 string. */
import type { CacheLang } from '@/lib/translate/cache-lang'
import { buildLogicText, mapLogicRangeToOriginal, type NewlineAnnotation, type NewlineKind } from '@/lib/translate/logic-text'

import { RM_ESCAPE_RE } from './rm-escape'
import { TEXT_MARKUP_RE } from './source-text'
import { scanStructuredText, type StructureAnnotation } from './structured-segments'

export type { NewlineAnnotation, NewlineKind } from '@/lib/translate/logic-text'
export { buildLogicText, inferNewlineKind, mapLogicRangeToOriginal, newlineKindAt, usesSpacedSoftBreaks } from '@/lib/translate/logic-text'

export const SENTENCE_TOKEN_SOURCE = `${RM_ESCAPE_RE.source}|${TEXT_MARKUP_RE.source}|https?:\\/\\/[^\\s<>]+`
/** Bumped for paired opening-parenthesis aliases on message fragments. */
export const SENTENCE_RULE_VERSION = 9
export type SentenceUnit = { start: number; end: number; key: string; tone: string; boundary: string; controls: string; block: number }

export type SentenceUnitOptions = {
  /** Explicit newline spans on the original string. Unannotated mid-phrase wraps infer soft. */
  newlines?: ReadonlyArray<NewlineAnnotation>
  /** Affects soft-break space insertion (CJK join vs spaced languages). */
  srcLang?: CacheLang | ''
  structure?: StructureAnnotation
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
  // Ignore line-edge indentation, preserving control parameters, word spacing and every newline.
  const normalized = text.trim()
  const plainKey = (part: string) => punctuationKey(part.replace(/\r\n?/g, '\n').replace(/[\t \u3000]*\n[\t \u3000]*/g, '\n'))
  let out = '',
    at = 0
  for (const match of normalized.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'))) {
    out += plainKey(normalized.slice(at, match.index)) + match[0]
    at = match.index! + match[0].length
  }
  return out + plainKey(normalized.slice(at))
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

/** Shared punctuation boundaries for optimize previews and reusable sentence units. */
export function sentenceBoundaryAt(text: string, index: number): { end: number; boundary: string } | null {
  const c = text[index]
  if (!/[,，、。．.!！?？;；]/.test(c || '')) return null
  if (/[,.，．]/.test(c) && /[0-9０-９]/.test(text[index - 1] || '') && /[0-9０-９]/.test(text[index + 1] || '')) return null
  // Repeated ASCII/fullwidth periods are an ellipsis, not multiple sentence endings.
  if (/[.．]/.test(c) && (/[.．]/.test(text[index - 1] || '') || /[.．]/.test(text[index + 1] || ''))) return null
  let end = index + 1
  while (end < text.length && /[,，、。．.!！?？;；]/.test(text[end])) end++
  return { end, boundary: /[,，、]/.test(c) ? ',' : /[;；]/.test(c) ? ';' : 'stop' }
}

/** Split `text` using only punctuation and hard line annotations (coordinates of `text`). */
function splitSentenceUnitsOn(text: string, hardOrUnknown: ReadonlyArray<NewlineAnnotation>): SentenceUnit[] {
  const units: SentenceUnit[] = []
  const controls = new Map([...text.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'))].map((m) => [m.index!, m[0]]))
  const stack: string[] = []
  // RPG messages may leave the leading dialogue quote open across message boxes.
  // Keep it in the first unit, but do not let it suppress every punctuation seam.
  const opening = text.match(/^\s*[「『“]/)?.[0]
  const openDialogueAt = opening && !text.includes(PAIRS[opening.at(-1)!]) ? opening.length - 1 : -1
  let start = 0
  let block = 0
  function push(end: number, boundary: string) {
    const raw = text.slice(start, end)
    const tail = raw.match(/[,.!?;，、。．！？；\s]+$/u)?.[0] || ''
    const body = raw.slice(0, raw.length - tail.length).trim()
    const marks = punctuationKey(tail.replace(/\s/g, ''))
    const tone = marks.match(/[!?]+/)?.[0] || (marks.includes('.') ? '.' : '')
    if (body) units.push({ start: start + (raw.match(/^\s*/)?.[0].length || 0), end, key: sentenceBodyKey(body), tone, boundary, controls: controlSignature(raw), block })
    start = end
  }
  for (let i = 0; i < text.length; i++) {
    const code = controls.get(i)
    if (code && !/^\\[nr]$/i.test(code)) {
      i += code.length - 1
      continue
    }
    const c = text[i]!
    if (PAIRS[c] && i !== openDialogueAt) stack.push(PAIRS[c])
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
    const seam = sentenceBoundaryAt(text, i)
    if (!seam) continue
    push(seam.end, seam.boundary)
    i = seam.end - 1
  }
  if (start < text.length) push(text.length, 'end')
  return units
}

/**
 * Split on punctuation / confirmed hard line breaks only.
 * Soft breaks are removed in the logic view first (phase 2); unknown stays and does not split.
 */
export function sentenceUnits(text: string, opts?: SentenceUnitOptions): SentenceUnit[] {
  if (opts?.structure?.mode === 'disabled')
    return text.trim() ? [{ start: 0, end: text.length, key: sentenceBodyKey(text), tone: '', boundary: 'end', controls: controlSignature(text), block: 0 }] : []
  // Game dialogue can continue in another message with an opening parenthesis only.
  // Keep that visible shell literal while allowing punctuation inside the continuation.
  const opening = text.match(/^(?:\s*[(（])+/)?.[0]
  if (opening && !/[)）]/.test(text)) {
    const offset = opening.length
    const innerOpts = { ...opts, newlines: opts?.newlines?.filter((n) => n.start >= offset).map((n) => ({ ...n, start: n.start - offset, end: n.end - offset })) }
    return sentenceUnits(text.slice(offset), innerOpts).map((u) => ({ ...u, start: u.start + offset, end: u.end + offset }))
  }
  const structured = scanStructuredText(text, opts?.structure)
  if (structured.units.length && structured.units.every((unit) => unit.state === 'accepted')) {
    return structured.units.map((unit, block) => {
      const raw = text.slice(unit.start, unit.end)
      const logic = buildLogicText(raw, {
        srcLang: opts?.srcLang,
        newlines: opts?.newlines?.filter((n) => n.start >= unit.start && n.end <= unit.end).map((n) => ({ ...n, start: n.start - unit.start, end: n.end - unit.start })),
      }).logic
      const tail = logic.match(/[,.!?;，、。．！？；\s]+$/u)?.[0] || ''
      const body = logic.slice(0, logic.length - tail.length).trim()
      const marks = punctuationKey(tail.replace(/\s/g, ''))
      return {
        start: unit.start,
        end: unit.end,
        key: sentenceBodyKey(body || logic),
        tone: marks.match(/[!?]+/)?.[0] || (marks.includes('.') ? '.' : ''),
        boundary: 'structure',
        controls: controlSignature(raw),
        block,
      }
    })
  }
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
