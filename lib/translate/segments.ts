import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import { isDynamicTemplate } from '@/lib/translate/dynamic-template'
import { RM_ESCAPE_RE } from '@/lib/translate/rm-escape'

const WRAPPERS: Record<string, string> = {
  '「': '」',
  '『': '』',
  '(': ')',
  '（': '）',
  '<': '>',
  '＜': '＞',
  '【': '】',
  '《': '》',
  '〈': '〉',
  '[': ']',
  '［': '］',
  '{': '}',
  '｛': '｝',
  '“': '”',
  '‘': '’',
}
const SEPARATE_WRAPPERS = new Set(['「', '『', '<', '＜'])
const FRAGMENT_QUOTES: Record<string, string> = { '「': '」', '『': '』', '“': '”', '‘': '’' }

function isOuterWrapper(text: string): boolean {
  if (text.length < 2 || WRAPPERS[text[0]] !== text[text.length - 1]) return false
  // ASCII braces usually denote substitution variables; HTML tags are not speaker names.
  if (/^\{[A-Za-z0-9_]+\}$/.test(text) || /^<\/?(?:br|span|div|p|b|i|img|ruby|rt)(?:\s[^>]*)?\s*\/?>$/i.test(text)) return false
  const stack: string[] = []
  const controls = new Map([...text.matchAll(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, 'g'))].map((match) => [match.index, match[0].length]))
  for (let i = 0; i < text.length; i++) {
    const length = controls.get(i)
    if (length) {
      i += length - 1
      continue
    }
    if (WRAPPERS[text[i]]) stack.push(WRAPPERS[text[i]])
    else if (stack[stack.length - 1] === text[i]) {
      stack.pop()
      if (!stack.length) return i === text.length - 1
    }
  }
  return false
}

/** Keep context inside brackets; split outside them at commas and sentence punctuation, without splitting on line breaks alone. */
function splitSegments(text: string, splitOrphanQuotes: boolean): string[] {
  if (isDynamicTemplate(text)) return [text]
  const choice = peelChoiceMetaShell(text)
  if (choice.lead || choice.trail) {
    const parts = splitSegments(choice.core, splitOrphanQuotes)
    if (!parts.length) return [choice.lead + choice.trail]
    parts[0] = choice.lead + parts[0]
    parts[parts.length - 1] += choice.trail
    return parts
  }
  const controls = new Map([...text.matchAll(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, 'g'))].map((match) => [match.index, match[0].length]))
  const stack: Array<{ close: string; separate: boolean }> = []
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const controlLength = controls.get(i)
    if (controlLength) {
      i += controlLength - 1
      continue
    }
    const char = text[i]
    if (/[.．,，]/.test(char) && /[0-9０-９]/.test(text[i - 1] || '') && /[0-9０-９]/.test(text[i + 1] || '')) continue
    let closed = false
    if (WRAPPERS[char]) {
      const separate = SEPARATE_WRAPPERS.has(char)
      if (separate && !stack.length && i > start && translationSegmentContent(text.slice(start, i)).core.trim()) {
        parts.push(text.slice(start, i))
        start = i
      }
      stack.push({ close: WRAPPERS[char], separate })
    } else if (stack[stack.length - 1]?.close === char) {
      const wrapper = stack.pop()!
      closed = stack.length === 0 && wrapper.separate
    } else if (splitOrphanQuotes && !stack.length && /[」』]/.test(char)) {
      closed = true
    }
    if (stack.length || (!closed && !/[，,。．.!！?？]/.test(char))) continue
    // Attach consecutive punctuation to the preceding segment instead of creating punctuation-only entries.
    while (i + 1 < text.length && /[，,。．.!！?？]/.test(text[i + 1])) i++
    parts.push(text.slice(start, i + 1))
    start = i + 1
  }
  if (start < text.length) parts.push(text.slice(start))
  return parts
}

export function translationSegments(text: string): string[] {
  return splitSegments(text, false)
}

/** Orphan closing quotes may delimit imported title fragments on both sides of a pair. */
export function translationAlignmentSegments(text: string): string[] {
  return splitSegments(text, true)
}

/** Keep each segment's shell in place; cache lookups and translation requests use only its body. */
function segmentContent(text: string, keepChoiceMeta: boolean): { lead: string; core: string; trail: string } {
  if (isDynamicTemplate(text)) return { lead: '', core: text, trail: '' }
  const control = new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, 'g')
  const choice = peelChoiceMetaShell(text)
  let core = choice.core
  let lead = keepChoiceMeta ? choice.lead : ''
  let trail = keepChoiceMeta ? choice.trail : ''
  for (;;) {
    const before = core
    const meta = peelChoiceMetaShell(core)
    if (keepChoiceMeta) {
      lead += meta.lead
      trail = meta.trail + trail
    }
    core = meta.core
    const prefix = core.match(/^[\s、，,。．.!！?？…]+/)?.[0] || [...core.matchAll(control)].find((match) => match.index === 0 && !/^\\RB\[/i.test(match[0]))?.[0]
    if (prefix) {
      lead += prefix
      core = core.slice(prefix.length)
    }
    const suffix =
      core.match(/[\s、，,。．.!！?？…]+$/)?.[0] || [...core.matchAll(control)].find((match) => match.index! + match[0].length === core.length && !/^\\RB\[/i.test(match[0]))?.[0]
    if (suffix) {
      trail = suffix + trail
      core = core.slice(0, -suffix.length)
    }
    if (isOuterWrapper(core)) {
      lead += core[0]
      trail = core[core.length - 1] + trail
      core = core.slice(1, -1)
    } else {
      // Imported visual lines may contain only one edge of a dialogue quotation.
      const close = FRAGMENT_QUOTES[core[0]]
      if (close && !core.includes(close)) {
        lead += core[0]
        core = core.slice(1)
      }
      const open = Object.keys(FRAGMENT_QUOTES).find((key) => FRAGMENT_QUOTES[key] === core[core.length - 1])
      if (open && !core.includes(open)) {
        trail = core[core.length - 1] + trail
        core = core.slice(0, -1)
      }
    }
    if (core === before) break
  }
  return { lead, core, trail }
}

export function translationSegmentContent(text: string): { lead: string; core: string; trail: string } {
  return segmentContent(text, true)
}

export function translationSources(text: string): string[] {
  const parts = translationSegments(text)
    .map((part) => translationSegmentContent(part).core)
    .filter(Boolean)
  return [...new Set([...parts, ...rubyFragmentSources(text, translationSources)])]
}

/** MPP_MessageEX ruby payloads are visible text, not conditions or opaque variable arguments. */
export function translationRubyChunks(text: string): Array<{ text: string; ruby: boolean; base?: string; reading?: string; prefix?: string; paren?: boolean }> {
  if (isDynamicTemplate(text)) return [{ text, ruby: false }]
  const chunks: Array<{ text: string; ruby: boolean; base?: string; reading?: string; prefix?: string; paren?: boolean }> = []
  let start = 0
  const controls = [...text.matchAll(new RegExp(RM_ESCAPE_RE.source, 'g'))]
  for (const match of text.matchAll(/\\RB\[([^,\[\]\r\n]+),([^,\[\]\r\n]+)\]|\\ruby\[([^\[\]\r\n]+)\]\(([^)\r\n]+)\)/gi)) {
    const at = match.index!
    if (controls.some((control) => control.index! < at && control.index! + control[0].length > at)) continue
    if (at > start) chunks.push({ text: text.slice(start, at), ruby: false })
    const paren = match[3] != null
    chunks.push({
      text: match[0],
      ruby: true,
      base: paren ? match[3] : match[1],
      reading: paren ? match[4] : match[2],
      prefix: match[0].slice(0, match[0].indexOf('[')),
      paren,
    })
    start = at + match[0].length
  }
  if (start < text.length) chunks.push({ text: text.slice(start), ruby: false })
  return chunks
}

/** Pair flanks, bases and readings when both sides keep the same ruby sequence. Null means neither side has ruby; empty means the shapes differ. */
export function matchingTranslationRubyPairs(source: string, target: string): Array<{ source: string; target: string }> | null {
  const left = translationRubyChunks(source)
  const right = translationRubyChunks(target)
  if (!left.some((chunk) => chunk.ruby) && !right.some((chunk) => chunk.ruby)) return null
  if (left.length !== right.length || left.some((chunk, index) => chunk.ruby !== right[index].ruby)) return []
  return left.flatMap((chunk, index) => {
    const other = right[index]
    if (chunk.ruby)
      return [
        { source: chunk.base!, target: other.base! },
        { source: chunk.reading!, target: other.reading! },
      ]
    if (!/[\p{L}\p{N}]/u.test(chunk.text) && !/[\p{L}\p{N}]/u.test(other.text)) return []
    return [{ source: chunk.text, target: other.text }]
  })
}

export function stripTranslationRuby(text: string): string {
  return translationRubyChunks(text)
    .map((chunk) => (chunk.ruby ? '' : chunk.text))
    .join('')
}

/** Drop ruby payloads after confirming both sides use the same ruby shape, so the remaining controls can be compared. */
export function translationRubyCompatibleText(source: string, target: string): [string, string] | null {
  const pairs = matchingTranslationRubyPairs(source, target)
  if (pairs && !pairs.length) return null
  if (!pairs) return [source, target]
  return [stripTranslationRuby(source), stripTranslationRuby(target)]
}

function rubyFragmentSources(text: string, sources: (fragment: string) => string[]): string[] {
  const chunks = translationRubyChunks(text)
  if (!chunks.some((chunk) => chunk.ruby)) return []
  return chunks.flatMap((chunk) => (chunk.ruby ? [chunk.base!, chunk.reading!] : sources(chunk.text)))
}

export function mapTranslationRubySegments(text: string, translate: (source: string) => string | null): string | null {
  const chunks = translationRubyChunks(text)
  if (!chunks.some((part) => part.ruby)) return null
  let result = ''
  let changed = false
  for (const part of chunks) {
    if (!part.ruby) {
      const hit = translate(part.text)
      if (hit == null) {
        if (/[\p{L}]/u.test(translationSegmentContent(part.text).core)) return null
        result += part.text
        continue
      }
      changed = true
      result += hit
      continue
    }
    const base = translate(part.base!)
    const reading = translate(part.reading!)
    // Keep the original ruby unless both arguments translate, so one glossary hit cannot block the prose.
    if (base == null || reading == null) {
      result += part.text
      continue
    }
    // Commas or brackets in translated payloads would change the plugin's argument parsing.
    if (/[,\[\]\r\n]/.test(base + reading)) return null
    changed = true
    result += part.paren ? `${part.prefix}[${base}](${reading})` : `${part.prefix}[${base},${reading}]`
  }
  return changed ? result : null
}

/** Derive a body alias only when both sides retain the same explicit numbered prefix. */
export function translationNumberedPrefixPair(source: string, target: string): { source: string; target: string } | null {
  const prefix = source.match(/^(?:[A-Za-z]+\d+_)+/)?.[0]
  if (!prefix || !target.startsWith(prefix)) return null
  const src = source.slice(prefix.length)
  const zh = target.slice(prefix.length)
  // Do not interpret remaining identifier chains, paths or empty suffixes as prose.
  if (/[_/\\]/.test(src) || /[_/\\]/.test(zh)) return null
  if (!/[\p{L}\p{N}]/u.test(src) || !/[\p{L}\p{N}]/u.test(zh)) return null
  return { source: src, target: zh }
}

/** Lookup-only visual lines; normal extraction keeps dialogue context intact. */
export function translationCacheLines(text: string): string[] {
  if (isDynamicTemplate(text)) return [text]
  const { lead, core, trail } = translationSegmentContent(text)
  const controls = [...core.matchAll(RM_ESCAPE_RE)].filter((match) => match[0] !== '\\n')
  const lines: string[] = []
  let start = 0
  for (const match of core.matchAll(/\r\n|[\r\n]|\\n(?![A-Za-z]|\[)/g)) {
    const at = match.index!
    if (controls.some((control) => at >= control.index! && at < control.index! + control[0].length)) continue
    const end = at + match[0].length
    lines.push(core.slice(start, end))
    start = end
  }
  if (!lines.length) return [text]
  lines.push(core.slice(start))
  lines[0] = lead + lines[0]
  lines[lines.length - 1] += trail
  return lines
}

/** Split only known display instructions; actor, variable and icon controls stay with their text. */
export function translationDisplayChunks(text: string): Array<{ text: string; display: boolean }> {
  if (isDynamicTemplate(text)) return [{ text, display: false }]
  const chunks: Array<{ text: string; display: boolean }> = []
  const controls = [...text.matchAll(new RegExp(RM_ESCAPE_RE.source, 'g'))]
  let start = 0
  for (const match of text.matchAll(/\\(?:RC\[(?:\d+|#[0-9a-f]+)\]|C\[(?:\d+|#[0-9a-f]+)\]|FS\[\d+\]|CL|FB|DF|G)(?![A-Za-z])/gi)) {
    const at = match.index!
    if (controls.some((control) => control.index! < at && control.index! + control[0].length > at)) continue
    if (at > start) chunks.push({ text: text.slice(start, at), display: false })
    chunks.push({ text: match[0], display: true })
    start = at + match[0].length
  }
  if (start < text.length) chunks.push({ text: text.slice(start), display: false })
  return chunks
}

export function mapTranslationDisplaySegments(text: string, translate: (source: string) => string): string {
  const choice = peelChoiceMetaShell(text)
  const chunks = translationDisplayChunks(choice.core)
  if (!chunks.some((chunk) => chunk.display)) return text
  return choice.lead + chunks.map((chunk) => (chunk.display ? chunk.text : translate(chunk.text))).join('') + choice.trail
}

/** Remove boundary display instructions only; preserve punctuation, brackets, variables and icons that carry content. */
export function translationExportText(text: string): string {
  if (isDynamicTemplate(text)) return text
  const { lead, core, trail } = translationSegmentContent(text)
  const strip = (shell: string) =>
    shell.replace(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, 'g'), (code) => (/^\\(?:[nbr]|C\[(?:\d+|#[0-9a-f]+)\]|FS\[\d+\]|[.!|><^{}$])$/i.test(code) ? '' : code))
  return strip(lead) + core + strip(trail)
}

/** Export original segment formatting; body-only keys are internal to caching and translation. */
export function translationOriginalSources(text: string): string[] {
  const originals = translationSegments(text)
    .map((part) => {
      const { lead, core, trail } = segmentContent(part, false)
      return lead + core + trail
    })
    .map(translationExportText)
    .filter((part) => translationSegmentContent(part).core.trim())
  return [...new Set([...originals, ...rubyFragmentSources(text, translationOriginalSources)])]
}

/** Translate body keys and restore controls, wrappers, trailing punctuation and inter-segment whitespace verbatim. */
export function mapTranslationSegments(text: string, translate: (source: string, original: string) => string): string {
  return mapSegments(translationSegments(text), translate)
}

export function mapTranslationCacheLines(text: string, translate: (source: string, original: string) => string): string {
  return mapSegments(translationCacheLines(text), translate)
}

function mapSegments(parts: string[], translate: (source: string, original: string) => string): string {
  return parts
    .map((part) => {
      const { lead, core, trail } = translationSegmentContent(part)
      return core ? lead + translate(core, part) + trail : part
    })
    .join('')
}

/** Drop obsolete empty fragments after extraction, retain translations, and export only current source text. */
export function reconcileTranslationSeed(sources: Iterable<string>, existing: Record<string, string>) {
  const reusable = { ...existing }
  for (const [src, zh] of Object.entries(existing)) {
    const keys = translationSources(src)
    if (zh && keys.length === 1 && !Object.prototype.hasOwnProperty.call(reusable, keys[0])) reusable[keys[0]] = translationSegmentContent(zh).core
  }
  const seed: Record<string, string> = Object.fromEntries(Object.entries(existing).filter(([, value]) => value !== ''))
  const entries: Record<string, string> = Object.create(null)
  let added = 0
  for (const src of sources) {
    if (!src.trim()) continue
    if (!Object.prototype.hasOwnProperty.call(existing, src)) added++
    entries[src] = reusable[src] ?? ''
    Object.defineProperty(seed, src, { value: entries[src], enumerable: true, configurable: true, writable: true })
  }
  return { seed, entries, added }
}
