import { isDynamicTemplate } from './dynamic-template'
import { translationSegmentContent } from './segments'

type Token = { value: string; start: number; end: number; control?: boolean }
type Node = { next: Map<string, Node>; value?: string | null }
const protectedTokens = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|%\d+|%[sdifSc]|\{[A-Za-z0-9_]+\}|_[A-Za-z][A-Za-z0-9_]*/g
const ascii = /^[A-Za-z0-9_]$/

/** Ignore formatting only; controls, identifiers and punctuation inside ASCII words remain significant. Ruby arguments are text, while the wrapper stays one shared control. */
function tokens(text: string, offset = 0): Token[] {
  const controls = new Map([...text.matchAll(protectedTokens)].map((match) => [match.index!, match[0]]))
  const out: Token[] = []
  for (let at = 0; at < text.length;) {
    const code = controls.get(at)
    if (code) {
      const ruby = code.match(/^\\RB\[([^,\[\]\r\n]+),([^,\[\]\r\n]+)\]$/i)
      const paren = !ruby && /^\\ruby\[/i.test(code) ? text.slice(at + code.length).match(/^\(([^)\r\n]+)\)/) : null
      const rubyBase = ruby?.[1] ?? code.match(/^\\ruby\[([^\[\]\r\n]+)\]$/i)?.[1]
      if (ruby || (paren && rubyBase)) {
        const reading = ruby?.[2] ?? paren?.[1] ?? ''
        const prefix = code.match(/^\\(?:RB|ruby)\[/i)![0].length
        const span = code.length + (paren?.[0].length ?? 0)
        out.push({ value: ruby ? '\\RB' : '\\ruby', start: offset + at, end: offset + at + prefix, control: true })
        const readingAt = prefix + (rubyBase?.length ?? 0) + (ruby ? 1 : 2)
        const inner = [...tokens(rubyBase ?? '', offset + at + prefix), ...tokens(reading, offset + at + readingAt)]
        if (inner.length) inner[inner.length - 1] = { ...inner[inner.length - 1], end: offset + at + span }
        else out[out.length - 1] = { ...out[out.length - 1], end: offset + at + span }
        out.push(...inner)
        at += span
        continue
      }
      if (!/^\\[nr]$/i.test(code)) out.push({ value: code, start: offset + at, end: offset + at + code.length, control: true })
      at += code.length
      continue
    }
    const char = String.fromCodePoint(text.codePointAt(at)!)
    const value = char.normalize('NFKC')
    const end = at + char.length
    const insideAscii = ascii.test(text[at - 1] || '') && ascii.test(text[end] || '')
    if (!/^\s+$/.test(value) && (!/^\p{P}+$/u.test(value) || value === '_' || insideAscii)) out.push({ value, start: offset + at, end: offset + end })
    at = end
  }
  return out
}

function controls(text: string): string {
  return JSON.stringify(
    tokens(text)
      .filter((token) => token.control)
      .map((token) => token.value)
  )
}

/** Match complete bodies or an unambiguous complete sequence of cached bodies, never arbitrary substrings. */
export function createCoverageLookup(entries: Iterable<readonly [string, string]>) {
  const root: Node = { next: new Map() }
  for (const [source, target] of entries) {
    if (!target || isDynamicTemplate(source) || controls(source) !== controls(target)) continue
    const choice = peelChoiceMetaShell(source)
    const translatedChoice = peelChoiceMetaShell(target)
    if ((choice.lead || choice.trail) && /(?:如果|启用|禁用)\s*[(（]/.test(translatedChoice.core)) continue
    if ((translatedChoice.lead || translatedChoice.trail) && (choice.lead !== translatedChoice.lead || choice.trail !== translatedChoice.trail)) continue
    const a = translationSegmentContent(source).core
    const b = translationSegmentContent(target).core
    const key = tokens(a)
    if (key.length < 2 || key.length > 2048 || !b.trim()) continue
    let node = root
    for (const token of key) {
      let next = node.next.get(token.value)
      if (!next) {
        next = { next: new Map() }
        node.next.set(token.value, next)
      }
      node = next
    }
    if (node.value === undefined) node.value = b
    else if (node.value !== b) node.value = null
  }
  return (source: string): string | null => {
    if (isDynamicTemplate(source)) return null
    const { lead, core, trail } = translationSegmentContent(source)
    if (controls(lead + trail) !== '[]') return null
    const key = tokens(core)
    if (key.length < 2 || key.length > 2048) return null
    let whole: Node | undefined = root
    for (const token of key) whole = whole?.next.get(token.value)
    if (whole?.value !== undefined) return whole.value === null ? null : lead + whole.value + trail

    // Each state keeps two distinct outputs at most: a second output proves ambiguity.
    const states: Array<Set<string> | undefined> = Array(key.length + 1)
    states[key.length] = new Set([''])
    let budget = 100_000
    const boundary = (at: number) => at === 0 || at === key.length || !ascii.test(key[at - 1].value) || !ascii.test(key[at].value) || key[at - 1].end < key[at].start
    for (let start = key.length - 1; start >= 0; start--) {
      if (!boundary(start)) continue
      let node = root
      const outputs = new Set<string>()
      for (let end = start; end < key.length; end++) {
        if (--budget < 0) return null
        const next = node.next.get(key[end].value)
        if (!next) break
        node = next
        const after = end + 1
        if (after - start < 2 || node.value == null || !boundary(after) || !states[after]) continue
        const separator = core.slice(key[end].end, after < key.length ? key[after].start : core.length)
        for (const rest of states[after]) {
          outputs.add(node.value + separator + rest)
          if (outputs.size === 2) break
        }
        if (outputs.size === 2) break
      }
      if (outputs.size) states[start] = outputs
    }
    const results = states[0]
    if (!results || results.size !== 1) return null
    return lead + core.slice(0, key[0].start) + [...results][0] + trail
  }
}
import { peelChoiceMetaShell } from './choice-meta'
