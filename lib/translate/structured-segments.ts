/** Lossless list structure. Detection proves boundaries, never source/target alignment. */
export const STRUCTURE_MAX_UNITS = 200
export type StructureSpan = { start: number; end: number }
export type StructureAnnotation = { mode: 'accept' | 'disabled' }
export type RecordStructure = { source?: StructureAnnotation; target?: StructureAnnotation }
export type StructuredUnit = StructureSpan & { id: string; kind: 'text' | 'label' | 'item'; state: 'accepted' | 'suggested'; ordinal?: number }
export type StructureDiagnostic = { code: 'ambiguous_marker' | 'invalid_sequence' | 'protected_token' | 'unsupported_structure' | 'candidate_limit'; start: number; end: number }
export type StructuredDocument = {
  units: StructuredUnit[]
  layout: Array<StructureSpan & { kind: 'literal' | 'unit'; unitId?: string }>
  diagnostics: StructureDiagnostic[]
}

type Marker = StructureSpan & { family: string; ordinal?: number; weak?: boolean }
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
const TOKEN = /https?:\/\/[^\s<>]+|<[^>]*>|\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|\{[A-Za-z0-9_]+\}|%\d+|__[A-Za-z]\d+__|\b\d+(?:[.．:/-]\d+)+\b/g
const PAIRS: Record<string, string> = { '「': '」', '『': '』', '“': '”', '【': '】', '《': '》', '[': ']', '{': '}', '(': ')', '（': '）' }

function ordinal(raw: string): number | undefined {
  const value = raw.normalize('NFKC')
  if (/^\d+$/.test(value)) return Number(value)
  if (!/^(?=[IVXLCDM]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(value)) return undefined
  const chars = value.toUpperCase()
  let n = 0
  for (let i = 0; i < chars.length; i++) n += ROMAN[chars[i]] * (ROMAN[chars[i]] < (ROMAN[chars[i + 1]] || 0) ? -1 : 1)
  return n || undefined
}

export function validStructureAnnotation(value: unknown): value is StructureAnnotation {
  return !!value && typeof value === 'object' && ['accept', 'disabled'].includes((value as StructureAnnotation).mode)
}
export function validRecordStructure(value: unknown): value is RecordStructure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as RecordStructure
  return (r.source === undefined || validStructureAnnotation(r.source)) && (r.target === undefined || validStructureAnnotation(r.target))
}

export function scanStructuredText(text: string, annotation?: StructureAnnotation): StructuredDocument {
  const result: StructuredDocument = { units: [], layout: text ? [{ kind: 'literal', start: 0, end: text.length }] : [], diagnostics: [] }
  if (!text || annotation?.mode === 'disabled') return result
  // Stateful display controls cannot safely be moved between list items yet.
  if (/\\(?:[A-Za-z]+\[|[^A-Za-z\s])/.test(text) || /<[^>]*>/.test(text)) {
    result.diagnostics.push({ code: 'protected_token', start: 0, end: text.length })
    return result
  }
  const protectedAt = new Map([...text.matchAll(TOKEN)].map((m) => [m.index!, m[0].length]))
  let markers: Marker[] = []
  const stack: string[] = []
  for (let i = 0; i < text.length;) {
    const token = protectedAt.get(i)
    if (token) {
      i += token
      continue
    }
    const before = text[i - 1] || ''
    const boundary = i === 0 || /[\s:：,，、;；]/.test(before) || /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/.test(text[i])
    let marker: Marker | undefined
    const circled = CIRCLED.indexOf(text[i])
    if (!stack.length && circled >= 0) marker = { start: i, end: i + 1, family: 'circled', ordinal: circled + 1 }
    if (!stack.length && /[·•]/.test(text[i])) marker = { start: i, end: i + 1, family: 'bullet' }
    if (!stack.length && boundary) {
      const match = text
        .slice(i)
        .match(
          /^(?:([（(])([0-9０-９]+|[ivxlcdmIVXLCDM]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+)[）)]|([0-9０-９]+|[ivxlcdmIVXLCDM]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+)([.．、):：]|(?=\s)|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])))/u
        )
      if (match) {
        const raw = match[2] || match[3]
        const n = ordinal(raw)
        const suffix = match[4] || ''
        if (n !== undefined && !(/[.．]/.test(suffix) && /[0-9０-９]/.test(text[i + match[0].length] || ''))) {
          const family = /^\d+$/.test(raw.normalize('NFKC')) ? 'arabic' : 'roman'
          marker = {
            start: i,
            end: i + match[0].length,
            family: `${family}:${match[1] ? 'paren' : suffix || 'bare'}`,
            ordinal: n,
            weak: !match[1] && !suffix && !/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/.test(raw),
          }
        }
      }
    }
    if (marker) {
      markers.push(marker)
      i = marker.end
      continue
    }
    if (PAIRS[text[i]]) stack.push(PAIRS[text[i]])
    else if (stack.at(-1) === text[i]) stack.pop()
    i++
  }
  if (markers.some((m) => !m.weak)) markers = markers.filter((m) => !m.weak)
  if (markers.length >= 2 && markers.every((m) => m.family === 'bullet') && !/^\s*$/.test(text.slice(0, markers[0].start))) {
    const colon = text.slice(0, markers[0].start).match(/[:：]/)
    if (colon && text.slice(colon.index! + 1, markers[0].start).trim()) markers.unshift({ start: colon.index! + 1, end: colon.index! + 1, family: 'bullet' })
  }
  if (!markers.length) return result
  if (markers.length > STRUCTURE_MAX_UNITS - 1) {
    result.diagnostics.push({ code: 'candidate_limit', start: 0, end: text.length })
    return result
  }
  const prefix = text.slice(0, markers[0].start)
  const labelMatch = prefix.match(/(?:^|\n)([^\n:：]+)[:：]\s*$/u)
  if (prefix.trim() && !labelMatch) return result
  // Preserve single isolated markers as ordinary text, not a fabricated list.
  if (markers.length < 2) return result
  const numbered = markers.filter((m) => m.ordinal !== undefined)
  const sameFamily = markers.every((m) => m.family === markers[0].family)
  const sequence = numbered.every((m, i) => !i || m.ordinal === numbered[i - 1].ordinal! + 1)
  const bulletStrong = markers[0].family !== 'bullet' || markers.every((m) => /^\s*$/.test(text.slice(text.lastIndexOf('\n', m.start - 1) + 1, m.start)))
  const strong = sameFamily && sequence && bulletStrong && markers.every((m) => !m.weak)
  const state = strong || annotation?.mode === 'accept' ? 'accepted' : 'suggested'
  if (!sequence || !sameFamily) result.diagnostics.push({ code: 'invalid_sequence', start: markers[0].start, end: text.length })
  else if (!strong) result.diagnostics.push({ code: 'ambiguous_marker', start: markers[0].start, end: text.length })
  const add = (start: number, end: number, kind: StructuredUnit['kind'], n?: number) => {
    const raw = text.slice(start, end)
    const leading = raw.match(/^\s*/)?.[0].length || 0
    const trailing = raw.match(/[\s,，、;；]*$/)?.[0].length || 0
    start += leading
    end -= trailing
    if (end <= start) return false
    result.units.push({ id: `${start}:${end}`, start, end, kind, state, ...(n !== undefined ? { ordinal: n } : {}) })
    return true
  }
  if (labelMatch) {
    const labelStart = prefix.lastIndexOf(labelMatch[1])
    if (labelStart > 0) add(0, labelStart, 'text')
    add(labelStart, labelStart + labelMatch[1].length, 'label')
  }
  for (let i = 0; i < markers.length; i++) {
    if (!add(markers[i].end, markers[i + 1]?.start ?? text.length, 'item', markers[i].ordinal)) {
      result.units = []
      return result
    }
  }
  if (result.units.length > STRUCTURE_MAX_UNITS) {
    result.units = []
    result.diagnostics.push({ code: 'candidate_limit', start: 0, end: text.length })
    return result
  }
  result.layout = []
  let cursor = 0
  for (const unit of result.units) {
    if (cursor < unit.start) result.layout.push({ kind: 'literal', start: cursor, end: unit.start })
    result.layout.push({ kind: 'unit', unitId: unit.id, start: unit.start, end: unit.end })
    cursor = unit.end
  }
  if (cursor < text.length) result.layout.push({ kind: 'literal', start: cursor, end: text.length })
  return result
}
