import { cacheEngineRank } from './cache-engine-rank'
import { buildLogicText } from './logic-text'
import { sentenceAliases } from './sentence-aliases'
import { type NewlineAnnotation, sameSentence, type SentenceUnit, type SentenceUnitOptions, sentenceUnits, wholeSentenceKey } from './sentence-units'

export type AlignmentGroup = { sourceStart: number; sourceEnd: number; targetStart: number; targetEnd: number; evidence: 'verified' | 'structural' }
export type SentenceRecord = {
  id: string
  revision: number
  src: string
  zh: string
  engine?: string | null
  local?: boolean
  derived?: boolean
  alignments?: AlignmentGroup[]
  /** Soft/hard newline evidence on `src` (phase 2). */
  newlines?: NewlineAnnotation[]
}

export type PlanSentenceOptions = SentenceUnitOptions

function recordUnitOpts(record: SentenceRecord): SentenceUnitOptions {
  return { newlines: record.newlines }
}

function logicAuthorityKey(text: string, opts?: SentenceUnitOptions): string {
  return wholeSentenceKey(buildLogicText(text, { newlines: opts?.newlines, srcLang: opts?.srcLang }).logic)
}
export type SentenceMatch = {
  start: number
  end: number
  from: number
  to: number
  text: string
  record: SentenceRecord
  sourceStart: number
  sourceEnd: number
  queryCoverage?: number
  recordCoverage?: number
  kind: 'whole' | 'block' | 'extracted' | 'single'
}
export type SentenceGap = { id: string; start: number; end: number; text: string }
export type SentencePlan = {
  status: 'full' | 'partial' | 'miss'
  src: string
  matches: SentenceMatch[]
  gaps: SentenceGap[]
  zh: string | null
  coverage: number
  limited?: boolean
  ambiguous: boolean
}

function target(record: SentenceRecord, units: SentenceUnit[], from: number, to: number): string | null {
  if (from === 0 && to === units.length) return record.zh
  const start = units[from].start
  const end = units[to - 1].end
  const groups = (record.alignments || []).filter((g) => g.evidence === 'verified' && g.sourceStart >= start && g.sourceEnd <= end).sort((a, b) => a.sourceStart - b.sourceStart)
  if (!groups.length || groups[0].sourceStart !== start || groups.at(-1)!.sourceEnd !== end) return null
  for (let i = 1; i < groups.length; i++) if (groups[i - 1].sourceEnd !== groups[i].sourceStart || groups[i - 1].targetEnd !== groups[i].targetStart) return null
  return record.zh.slice(groups[0].targetStart, groups.at(-1)!.targetEnd)
}

function cutsSurrogate(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false
  const c = text.charCodeAt(index)
  return c >= 0xdc00 && c <= 0xdfff
}

/** Validate explicit mappings; matching punctuation alone never upgrades evidence. */
export function validateAlignments(record: Pick<SentenceRecord, 'src' | 'zh' | 'newlines'>, groups: AlignmentGroup[]): boolean {
  if (!Array.isArray(groups) || groups.length > 1000 || groups.some((g) => !g || typeof g !== 'object' || !['verified', 'structural'].includes(g.evidence))) return false
  const src = sentenceUnits(record.src, { newlines: record.newlines })
  const tgt = sentenceUnits(record.zh)
  const starts = new Set(src.map((s) => s.start)),
    ends = new Set(src.map((s) => s.end))
  const targetStarts = new Set(tgt.map((s) => s.start)),
    targetEnds = new Set(tgt.map((s) => s.end))
  let sourceEnd = 0,
    targetEnd = 0
  for (const g of groups) {
    if (![g.sourceStart, g.sourceEnd, g.targetStart, g.targetEnd].every(Number.isInteger)) return false
    if (g.sourceStart < sourceEnd || g.targetStart < targetEnd || g.sourceStart >= g.sourceEnd || g.targetStart >= g.targetEnd) return false
    if (g.sourceStart < 0 || g.sourceEnd > record.src.length || g.targetStart < 0 || g.targetEnd > record.zh.length) return false
    if (cutsSurrogate(record.src, g.sourceStart) || cutsSurrogate(record.src, g.sourceEnd)) return false
    if (cutsSurrogate(record.zh, g.targetStart) || cutsSurrogate(record.zh, g.targetEnd)) return false
    const onUnits = starts.has(g.sourceStart) && ends.has(g.sourceEnd) && targetStarts.has(g.targetStart) && targetEnds.has(g.targetEnd)
    if (!onUnits) {
      // Phase 3: verified human spans may cut unpunctuated single-unit text; multi-unit rows stay unit-aligned.
      if (g.evidence !== 'verified') return false
      if (src.length !== 1 || src[0]!.start !== 0 || src[0]!.end !== record.src.length) return false
      if (tgt.length !== 1 || tgt[0]!.start !== 0 || tgt[0]!.end !== record.zh.length) return false
      sourceEnd = g.sourceEnd
      targetEnd = g.targetEnd
      continue
    }
    const a = src
      .filter((s) => s.start >= g.sourceStart && s.end <= g.sourceEnd)
      .map((s) => s.controls)
      .filter((s) => s !== '[]')
      .join('')
    const b = tgt
      .filter((s) => s.start >= g.targetStart && s.end <= g.targetEnd)
      .map((s) => s.controls)
      .filter((s) => s !== '[]')
      .join('')
    if (a !== b) return false
    sourceEnd = g.sourceEnd
    targetEnd = g.targetEnd
  }
  return true
}

function candidates(src: string, records: SentenceRecord[], queryOpts?: PlanSentenceOptions): SentenceMatch[] & { limited?: boolean } {
  const query = sentenceUnits(src, queryOpts)
  const out: SentenceMatch[] = []
  let work = 0
  for (const record of records) {
    const unitOpts = recordUnitOpts(record)
    const units = sentenceUnits(record.src, unitOpts)
    if (logicAuthorityKey(src, queryOpts) === logicAuthorityKey(record.src, unitOpts) && query.length) {
      out.push({
        start: 0,
        end: src.length,
        from: 0,
        to: query.length,
        text: record.zh,
        record,
        sourceStart: 0,
        sourceEnd: record.src.length,
        kind: 'whole',
        queryCoverage: 1,
        recordCoverage: 1,
      })
      continue
    }
    for (let q = 0; q < query.length; q++)
      for (let r = 0; r < units.length; r++) {
        if (++work > 50_000) return Object.assign([], { limited: true })
        let length = 0
        while (q + length < query.length && r + length < units.length && sameSentence(query[q + length], units[r + length])) {
          if (++work > 50_000) return Object.assign([], { limited: true })
          if (
            length &&
            (query[q + length].block !== query[q].block || units[r + length].block !== units[r].block || query[q + length - 1].boundary !== units[r + length - 1].boundary)
          )
            break
          length++
          const text = target(record, units, r, r + length)
          if (text == null) continue
          out.push({
            start: query[q].start,
            end: query[q + length - 1].end,
            from: q,
            to: q + length,
            text,
            queryCoverage: length / query.length,
            recordCoverage: length / units.length,
            record,
            sourceStart: units[r].start,
            sourceEnd: units[r + length - 1].end,
            kind: r === 0 && length === units.length ? (length === query.length ? 'whole' : length === 1 ? 'single' : 'block') : 'extracted',
          })
        }
      }
  }
  return out
}

/** Preserve a query's outer comma/line seam, but keep the cached block's internal punctuation. */
export function joinSentenceBlock(source: string, translated: string, trimCachedSeam = false): string {
  const seam = source.match(/([,，;；]\s*|\r?\n|\\n)$/)?.[0]
  if (!seam) return trimCachedSeam ? translated.replace(/[,，;；]\s*$/u, '') : translated
  return translated.replace(/[,，;；\s]+$/u, '') + seam
}

export function renderSentencePlan(plan: Pick<SentencePlan, 'src' | 'matches' | 'gaps'>, gaps: ReadonlyMap<string, string> = new Map()): string {
  const pieces = [
    ...plan.matches.map((m) => ({ start: m.start, end: m.end, text: m.text, trimCachedSeam: /[,，;；]\s*$/.test(m.record.src.slice(m.sourceStart, m.sourceEnd)) })),
    ...plan.gaps.map((g) => ({ ...g, text: gaps.get(g.id) ?? g.text, trimCachedSeam: false })),
  ].sort((a, b) => a.start - b.start)
  let at = 0,
    out = ''
  for (const part of pieces) {
    out += plan.src.slice(at, part.start) + joinSentenceBlock(plan.src.slice(part.start, part.end), part.text, part.trimCachedSeam)
    at = part.end
  }
  return out + plan.src.slice(at)
}

export function planSentenceTranslation(src: string, records: SentenceRecord[], opts?: PlanSentenceOptions): SentencePlan {
  const units = sentenceUnits(src, opts)
  let possible = candidates(
    src,
    records.flatMap((r) => [r, ...sentenceAliases(r.src, r.zh).map((a) => ({ ...r, ...a, derived: true, alignments: undefined }))]),
    opts
  )
  const limited = possible.limited === true
  const locked = possible.filter((m) => m.record.local && m.record.engine === 'manual' && !m.record.derived)
  possible = possible.filter((m) =>
    locked.every((lock) => {
      if (m.end <= lock.start || m.start >= lock.end || m === lock) return true
      return m.start === lock.start && m.end === lock.end && m.text === lock.text
    })
  )
  // Prefer local authority for the same range; never resolve unrelated alias collisions by timestamp.
  let ambiguous = false
  const ranges = new Map<string, SentenceMatch[]>()
  for (const m of possible) {
    const key = `${m.from}:${m.to}`
    ranges.set(key, [...(ranges.get(key) || []), m])
  }
  possible = []
  for (let group of ranges.values()) {
    const locals = group.filter((m) => m.record.local)
    if (locals.length) group = locals
    const equivalentBeforeExact = group.every((m) => !m.record.derived && wholeSentenceKey(m.record.src) === wholeSentenceKey(group[0].record.src))
    if (equivalentBeforeExact) {
      const rank = Math.max(...group.map((m) => cacheEngineRank(m.record.engine)))
      group = group.filter((m) => cacheEngineRank(m.record.engine) === rank)
    }
    const exact = group.filter((m) => !m.record.derived && m.record.src === src && m.start === 0 && m.end === src.length)
    if (exact.length) group = exact
    const equivalent = group.every((m) => !m.record.derived && wholeSentenceKey(m.record.src) === wholeSentenceKey(group[0].record.src))
    if (equivalent) {
      const rank = Math.max(...group.map((m) => cacheEngineRank(m.record.engine)))
      group = group.filter((m) => cacheEngineRank(m.record.engine) === rank)
    }
    if (new Set(group.map((m) => m.text)).size > 1) {
      ambiguous = true
      continue
    }
    possible.push(group.sort((a, b) => (a.kind === 'extracted' ? 1 : 0) - (b.kind === 'extracted' ? 1 : 0) || a.record.id.localeCompare(b.record.id))[0])
  }
  type Choice = { matches: SentenceMatch[]; covered: number; chars: number }
  const best: Choice[] = Array.from({ length: units.length + 1 }, () => ({ matches: [], covered: 0, chars: 0 }))
  for (let i = units.length - 1; i >= 0; i--) {
    best[i] = best[i + 1]
    for (const m of possible.filter((m) => m.from === i)) {
      const rest = best[m.to]
      const next = { matches: [m, ...rest.matches], covered: m.to - m.from + rest.covered, chars: m.end - m.start + rest.chars }
      const old = best[i]
      if (next.covered > old.covered || (next.covered === old.covered && (next.chars > old.chars || (next.chars === old.chars && next.matches.length < old.matches.length))))
        best[i] = next
    }
  }
  const matches = best[0].matches
  const gaps: SentenceGap[] = []
  let i = 0
  while (i < units.length) {
    const hit = matches.find((m) => m.from === i)
    if (hit) {
      i = hit.to
      continue
    }
    const first = i++
    while (i < units.length && units[i].block === units[first].block && !matches.some((m) => m.from === i)) i++
    const start = units[first].start,
      end = units[i - 1].end
    gaps.push({ id: `${start}:${end}`, start, end, text: src.slice(start, end) })
  }
  const status = matches.length ? (gaps.length ? 'partial' : 'full') : 'miss'
  const plan: SentencePlan = { src, status, matches, gaps, zh: null, coverage: units.length ? best[0].covered / units.length : 0, ambiguous, limited }
  if (status === 'full') plan.zh = renderSentencePlan(plan)
  return plan
}

/** Compile once per corpus revision; high-frequency units never trigger an unbounded candidate scan. */
export function createSentenceResolver(records: SentenceRecord[]) {
  const inverted = new Map<string, Set<SentenceRecord>>()
  const whole = new Map<string, SentenceRecord[]>()
  const key = (s: SentenceUnit) => JSON.stringify([s.key, s.tone, s.controls])
  const addWhole = (k: string, record: SentenceRecord) => {
    whole.set(k, [...(whole.get(k) || []), record])
  }
  for (const record of records.flatMap((r) => [r, ...sentenceAliases(r.src, r.zh).map((a) => ({ ...r, ...a, derived: true, alignments: undefined, newlines: undefined }))])) {
    const unitOpts = recordUnitOpts(record)
    const raw = wholeSentenceKey(record.src)
    addWhole(raw, record)
    // Soft-annotated rows also answer continuous (logic) queries without rewriting the PK.
    const logic = logicAuthorityKey(record.src, unitOpts)
    if (logic !== raw) addWhole(logic, record)
    for (const unit of sentenceUnits(record.src, unitOpts)) {
      const k = key(unit),
        bucket = inverted.get(k) || new Set<SentenceRecord>()
      bucket.add(record)
      inverted.set(k, bucket)
    }
  }
  function select(src: string): SentenceRecord[] {
    const exact = whole.get(wholeSentenceKey(src)) || []
    const selected = new Set(exact)
    for (const unit of sentenceUnits(src)) {
      const bucket = inverted.get(key(unit))
      if ((bucket?.size || 0) > 500) continue
      for (const record of bucket || []) {
        selected.add(record)
        if (selected.size > 500) return exact
      }
    }
    return [...selected]
  }
  return { select, plan: (src: string) => planSentenceTranslation(src, select(src)) }
}

/** Completed gaps become transient matches so status/gaps remain consistent without a new composite final. */
export function resolveSentenceGaps(plan: SentencePlan, values: ReadonlyMap<string, string>): SentencePlan {
  const records = new Map(plan.matches.map((m) => [`${m.record.id}:${m.record.revision}:${m.record.src}`, m.record]))
  for (const gap of plan.gaps) {
    const zh = values.get(gap.id)
    if (zh) records.set(`gap:${gap.id}`, { id: `gap:${gap.id}`, revision: 0, src: gap.text, zh, local: true, engine: 'transient:gap' })
  }
  return { ...plan, ...planSentenceTranslation(plan.src, [...records.values()]) }
}
