import { cacheEngineRank } from './cache-engine-rank'
import { buildLogicText, listNewlineSpans } from './logic-text'
import { sentenceAliases, structuredSentenceAliases } from './sentence-aliases'
import { inferredSentenceTarget, inferSentenceAlignment } from './sentence-auto-alignment'
import { queryLines, sentenceQueryKeys, sentenceQueryUnits, sentenceQueryViews } from './sentence-query'
import { type NewlineAnnotation, sameSentence, SENTENCE_TOKEN_SOURCE, type SentenceUnit, type SentenceUnitOptions, sentenceUnits, wholeSentenceKey } from './sentence-units'
import { type RecordStructure, scanStructuredText } from './structured-segments'

export type AlignmentGroup = { sourceStart: number; sourceEnd: number; targetStart: number; targetEnd: number; evidence: 'verified' | 'structural' }
export type SentenceRecord = {
  id: string
  revision: number
  src: string
  zh: string
  engine?: string | null
  local?: boolean
  derived?: boolean
  structuralAlias?: boolean
  structureContext?: number
  alignments?: AlignmentGroup[]
  /** Soft/hard newline evidence on `src` (phase 2). */
  newlines?: NewlineAnnotation[]
  structure?: RecordStructure
}

export type PlanSentenceOptions = SentenceUnitOptions

function recordUnitOpts(record: SentenceRecord): SentenceUnitOptions {
  return { newlines: record.newlines, structure: record.structure?.source }
}

function expandRecords(records: SentenceRecord[]): SentenceRecord[] {
  return records.flatMap((record) => [
    record,
    ...sentenceAliases(record.src, record.zh).map((alias) => ({ ...record, ...alias, derived: true, alignments: undefined, newlines: undefined })),
    ...structuredSentenceAliases(record.src, record.zh, record.structure).map(({ context, ...alias }) => ({
      ...record,
      ...alias,
      derived: true,
      structuralAlias: true,
      structureContext: context,
      alignments: undefined,
      newlines: undefined,
      structure: undefined,
    })),
  ])
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
  /** Runtime structural inference, never an explicitly verified mapping. */
  alignment?: 'inferred'
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
  if (from === 0 && to === units.length && units[0]?.start === 0 && units.at(-1)?.end === record.src.length) return record.zh
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
export function validateAlignments(record: Pick<SentenceRecord, 'src' | 'zh' | 'newlines' | 'structure'>, groups: AlignmentGroup[]): boolean {
  if (!Array.isArray(groups) || groups.length > 1000 || groups.some((g) => !g || typeof g !== 'object' || !['verified', 'structural'].includes(g.evidence))) return false
  const src = sentenceUnits(record.src, { newlines: record.newlines, structure: record.structure?.source })
  const tgt = sentenceUnits(record.zh, { structure: record.structure?.target })
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

function candidates(src: string, records: SentenceRecord[], queryOpts?: PlanSentenceOptions, automaticOnly = false): SentenceMatch[] & { limited?: boolean } {
  const query = sentenceUnits(src, queryOpts)
  const out: SentenceMatch[] = []
  let work = 0
  for (const record of records) {
    const unitOpts = recordUnitOpts(record)
    const units = sentenceUnits(record.src, unitOpts)
    const inferred = automaticOnly ? inferSentenceAlignment(record, units) : []
    if (automaticOnly && !inferred.length) continue
    if (!automaticOnly && logicAuthorityKey(src, queryOpts) === logicAuthorityKey(record.src, unitOpts) && query.length) {
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
    // A complete list item may contain punctuation that splits an independent cache row.
    // Reuse that row as a whole; never extract a target fragment on this path.
    for (let q = 0; q < query.length; q++) {
      const unit = query[q]
      if (!automaticOnly && unit.boundary === 'structure' && wholeSentenceKey(src.slice(unit.start, unit.end)) === wholeSentenceKey(record.src))
        out.push({
          start: unit.start,
          end: unit.end,
          from: q,
          to: q + 1,
          text: record.zh,
          record,
          sourceStart: 0,
          sourceEnd: record.src.length,
          kind: 'single',
          queryCoverage: 1 / query.length,
          recordCoverage: 1,
        })
    }
    for (let q = 0; q < query.length; q++) {
      if (automaticOnly && q > 0 && query[q - 1].boundary !== 'stop') continue
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
          if (automaticOnly && query[q + length - 1].boundary !== 'stop') continue
          const text = automaticOnly ? inferredSentenceTarget(record, inferred, r, r + length) : target(record, units, r, r + length)
          if (text == null) continue
          out.push({
            start: query[q].start,
            end: query[q + length - 1].end,
            from: q,
            to: q + length,
            text,
            ...(automaticOnly ? { alignment: 'inferred' as const } : {}),
            queryCoverage: length / query.length,
            recordCoverage: length / units.length,
            record,
            sourceStart: units[r].start,
            sourceEnd: units[r + length - 1].end,
            kind:
              r === 0 && length === units.length && units[0].start === 0 && units.at(-1)!.end === record.src.length
                ? length === query.length
                  ? 'whole'
                  : length === 1
                    ? 'single'
                    : 'block'
                : 'extracted',
          })
        }
      }
    }
  }
  return out
}

/** Preserve a query's outer comma/line seam, but keep the cached block's internal punctuation. */
export function joinSentenceBlock(source: string, translated: string, trimCachedSeam = false): string {
  const seam = source.match(/([,，、;；]\s*|\r?\n|\\n)$/)?.[0]
  if (!seam) return trimCachedSeam ? translated.replace(/[,，、;；]\s*$/u, '') : translated
  return translated.replace(/[,，、;；\s]+$/u, '') + seam
}

export function renderSentencePlan(plan: Pick<SentencePlan, 'src' | 'matches' | 'gaps'>, gaps: ReadonlyMap<string, string> = new Map()): string {
  const pieces = [
    ...plan.matches.map((m) => ({ start: m.start, end: m.end, text: m.text, trimCachedSeam: /[,，、;；]\s*$/.test(m.record.src.slice(m.sourceStart, m.sourceEnd)) })),
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
  return planSentenceTranslationView(src, records, opts, true)
}

function planSentenceTranslationView(src: string, records: SentenceRecord[], opts: PlanSentenceOptions | undefined, unwrap: boolean): SentencePlan {
  const units = sentenceUnits(src, opts)
  const expanded = expandRecords(records)
  const normal = candidates(src, expanded, opts)
  const initial = chooseSentencePlan(src, units, normal, normal.limited === true)
  if (initial.status === 'full' || initial.limited || opts?.structure?.mode === 'disabled') return initial
  const views = unwrap ? sentenceQueryViews(src, opts) : []
  if (views.length > 1 && !initial.matches.length && !initial.ambiguous) {
    let best = initial
    let covered = 0
    // Intermediate shells can themselves be exact cache keys. Try each view
    // in order rather than jumping directly to the deepest body.
    for (const body of views.slice(1)) {
      const inner = planSentenceTranslationView(body.text, records, body.opts, false)
      const shifted: SentencePlan = {
        ...inner,
        src,
        matches: inner.matches.map((m) => ({ ...m, start: m.start + body.offset, end: m.end + body.offset })),
        gaps: inner.gaps.map((g) => ({ ...g, id: `${g.start + body.offset}:${g.end + body.offset}`, start: g.start + body.offset, end: g.end + body.offset })),
        zh: null,
      }
      if (shifted.status === 'full') {
        shifted.zh = renderSentencePlan(shifted)
        return shifted
      }
      if (shifted.limited || shifted.ambiguous) return shifted
      const chars = shifted.matches.reduce((sum, m) => sum + m.end - m.start, 0)
      if (chars > covered) {
        best = shifted
        covered = chars
      }
    }
    return best
  }
  const structure = scanStructuredText(src.replace(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'), ' '), opts?.structure)
  const inferred: SentenceMatch[] & { limited?: boolean } = structure.units.length || structure.diagnostics.length ? [] : candidates(src, expanded, opts, true)
  if (inferred.limited) return { ...initial, limited: true }
  const additions = inferred.filter((m) => normal.every((hit) => m.end <= hit.start || m.start >= hit.end))
  const result = chooseSentencePlan(src, units, [...initial.matches, ...additions], false)
  result.ambiguous ||= initial.ambiguous
  return applyLineFallback(src, expanded, result, normal, opts)
}

function applyLineFallback(src: string, records: SentenceRecord[], plan: SentencePlan, normal: SentenceMatch[], opts?: PlanSentenceOptions): SentencePlan {
  if (plan.status === 'full' || plan.limited) return plan
  const lines = queryLines(src)
  if (!lines.length) return plan
  const keys = new Set(lines.map((line) => wholeSentenceKey(line.text)))
  const independent = records.filter((r) => keys.has(logicAuthorityKey(r.src, recordUnitOpts(r))))
  if (!independent.length) return plan
  const newlines = listNewlineSpans(src).map((br) => ({ ...br, kind: 'hard' as const }))
  // Explicit newline decisions remain authoritative; only inferred soft wraps change.
  const lineOpts = { ...opts, newlines: [...(opts?.newlines || []), ...newlines] }
  const units = sentenceUnits(src, lineOpts)
  const previous = plan.matches.map((m) => ({ ...m, from: units.findIndex((u) => u.start === m.start), to: units.findIndex((u) => u.end === m.end) + 1 }))
  if (previous.some((m) => m.from < 0 || m.to <= m.from)) return plan
  const selected = candidates(src, independent, lineOpts)
  if (selected.limited) return { ...plan, limited: true }
  const additions = selected.filter(
    (m) =>
      lines.some((line) => line.start === m.start && wholeSentenceKey(src.slice(m.start, m.end)) === wholeSentenceKey(line.text)) &&
      normal.every((hit) => m.end <= hit.start || m.start >= hit.end) &&
      plan.matches.every((hit) => m.end <= hit.start || m.start >= hit.end)
  )
  const result = chooseSentencePlan(src, units, [...previous, ...additions], false)
  result.ambiguous ||= plan.ambiguous
  return result
}

function chooseSentencePlan(src: string, units: SentenceUnit[], possible: SentenceMatch[], limited: boolean): SentencePlan {
  const locked = possible.filter((m) => m.alignment !== 'inferred' && m.record.local && m.record.engine === 'manual' && !m.record.derived)
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
  // Ambiguity concerns the rendered output: cache seams may differ while
  // restoring the query's punctuation produces exactly the same translation.
  const output = (m: SentenceMatch) => joinSentenceBlock(src.slice(m.start, m.end), m.text, /[,，、;；]\s*$/.test(m.record.src.slice(m.sourceStart, m.sourceEnd)))
  for (let group of ranges.values()) {
    const proven = group.filter((m) => m.alignment !== 'inferred')
    if (proven.length) group = proven
    else if (new Set(group.map(output)).size > 1) {
      ambiguous = true
      continue
    }
    const locals = group.filter((m) => m.record.local)
    if (locals.length) group = locals
    const explicit = group.filter((match) => !match.record.structuralAlias)
    if (explicit.length) group = explicit
    else {
      // A dedicated list is more specific than the same list inside a larger message.
      const context = Math.min(...group.map((match) => match.record.structureContext || 0))
      group = group.filter((match) => (match.record.structureContext || 0) === context)
      const rank = Math.max(...group.map((match) => cacheEngineRank(match.record.engine)))
      group = group.filter((match) => cacheEngineRank(match.record.engine) === rank)
    }
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
    if (new Set(group.map(output)).size > 1) {
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
  for (const record of expandRecords(records)) {
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
  function select(src: string, opts?: PlanSentenceOptions): SentenceRecord[] & { limited?: boolean } {
    const exact = whole.get(wholeSentenceKey(src)) || []
    const selected = new Set(exact)
    let limited = false
    for (const lookup of sentenceQueryKeys(src, opts)) {
      for (const record of whole.get(lookup) || []) {
        selected.add(record)
        if (selected.size > 500) return Object.assign([...exact], { limited: true })
      }
    }
    for (const unit of sentenceQueryUnits(src, opts)) {
      if (unit.boundary === 'structure') for (const r of whole.get(wholeSentenceKey(src.slice(unit.start, unit.end))) || []) selected.add(r)
      if (selected.size > 500) return Object.assign([...exact], { limited: true })
      const bucket = inverted.get(key(unit))
      if ((bucket?.size || 0) > 500) {
        limited = true
        continue
      }
      for (const record of bucket || []) {
        selected.add(record)
        if (selected.size > 500) return Object.assign([...exact], { limited: true })
      }
    }
    return Object.assign([...selected], { limited })
  }
  return {
    select,
    plan(src: string) {
      const selected = select(src)
      const plan = planSentenceTranslation(src, selected.limited ? [] : selected)
      return selected.limited ? { ...plan, limited: true } : plan
    },
  }
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
