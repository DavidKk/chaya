/** Read-only diagnostics over every registered matching branch, including unused alternatives. */
import { alignmentRejectionReason } from './sentence-auto-alignment'
import {
  inspectSentenceCandidates,
  renderSentencePlan,
  selectSentenceCandidates,
  type SentenceGap,
  type SentenceMatch,
  type SentencePlan,
  type SentenceRecord,
} from './sentence-plan'
import { queryLines, sentenceQueryKeys, sentenceQueryViews, sentenceQueryViewUnits } from './sentence-query'
import { sameSentence, SENTENCE_TOKEN_SOURCE, type SentenceUnit, sentenceUnits } from './sentence-units'
import { scanStructuredText } from './structured-segments'

export type CacheMatchPathKind = 'whole' | 'segments' | 'verified' | 'sentences' | 'ellipsis' | 'lines' | 'structure'
export type TraceMatch = Omit<SentenceMatch, 'record'> & { recordRef: number }
export type CacheMatchPath = {
  id: string
  kind: CacheMatchPathKind
  text: string
  offset: number
  units: SentenceUnit[]
  lookupKeys: string[]
  status: SentencePlan['status']
  preview: string
  matches: TraceMatch[]
  alternatives: TraceMatch[]
  gaps: SentenceGap[]
  adopted: boolean
  applicable: boolean
  ambiguous: boolean
  limited: boolean
  reasons: string[]
  checks: Array<{ recordRef: number; reasons: string[] }>
}
export type CacheMatchTrace = { paths: CacheMatchPath[]; records: SentenceRecord[]; limited: boolean }
const MAX_SEGMENTS = 80
const MAX_DETAILS = 4000
const MAX_MATCHES = 1000

export function traceTranslationCache(text: string, records: SentenceRecord[], actual: SentencePlan, opts?: Parameters<typeof sentenceUnits>[1]): CacheMatchTrace {
  const result: CacheMatchTrace = { paths: [], records: [], limited: !!actual.limited }
  const refs = new Map<string, number>()
  const budget = { remaining: 50_000 }
  let segments = 0,
    details = 0,
    matches = 0
  const ref = (r: SentenceRecord) => {
    const key = JSON.stringify([r.id, r.revision, r.src, r.zh, !!r.local])
    if (!refs.has(key)) {
      refs.set(key, result.records.length)
      result.records.push(r)
    }
    return refs.get(key)!
  }
  const serialize = (m: SentenceMatch): TraceMatch => {
    const { record, ...rest } = m
    return { ...rest, recordRef: ref(record) }
  }
  for (const [viewIndex, view] of sentenceQueryViews(text, opts?.structure?.mode === 'disabled' ? { ...opts, structure: undefined } : opts).entries()) {
    const options = { ...view.opts, structure: opts?.structure?.mode === 'disabled' ? undefined : view.opts?.structure }
    const units = sentenceQueryViewUnits(view.text, options)
    const inspected = inspectSentenceCandidates(view.text, records, options, budget)
    const segmented: SentenceMatch[] = []
    let segmentLimited = false
    for (const [i, unit] of units.entries()) {
      if (unit.start === 0 && unit.end === view.text.length) continue
      if (++segments > MAX_SEGMENTS || budget.remaining <= 0) {
        segmentLimited = true
        break
      }
      const part = view.text.slice(unit.start, unit.end)
      const scan = inspectSentenceCandidates(part, records, { srcLang: opts?.srcLang }, budget, false)
      segmentLimited ||= scan.limited
      for (const m of scan.normal) if (m.start === 0 && m.end === part.length) segmented.push({ ...m, start: unit.start, end: unit.end, from: i, to: i + 1 })
    }
    const lines = queryLines(view.text)
    const lineUnits = lines.map((line, i): SentenceUnit => ({
      start: line.start,
      end: line.start + line.text.length,
      key: line.text,
      tone: '',
      boundary: 'line',
      controls: '[]',
      block: i,
    }))
    const lineMatches: SentenceMatch[] = []
    let lineLimited = false
    for (const [i, line] of lines.entries()) {
      if (++segments > MAX_SEGMENTS || budget.remaining <= 0) {
        lineLimited = true
        break
      }
      const scan = inspectSentenceCandidates(line.text, records, { srcLang: opts?.srcLang }, budget, false)
      lineLimited ||= scan.limited
      for (const m of scan.normal)
        if (m.kind === 'whole' && m.start === 0 && m.end === line.text.length) lineMatches.push({ ...m, start: line.start, end: line.start + line.text.length, from: i, to: i + 1 })
    }
    const structure = scanStructuredText(view.text, view.opts?.structure)
    const inferenceStructure = scanStructuredText(view.text.replace(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'), ' '), view.opts?.structure)
    const inferenceAllowed = !inferenceStructure.units.length && !inferenceStructure.diagnostics.length
    const branches: Array<{ kind: CacheMatchPathKind; units: SentenceUnit[]; candidates: SentenceMatch[]; limited: boolean; applicable?: boolean; reason?: string }> = [
      { kind: 'whole', units, candidates: inspected.normal.filter((m) => m.kind === 'whole'), limited: inspected.limited },
      { kind: 'segments', units, candidates: [...inspected.normal.filter((m) => m.kind !== 'whole'), ...segmented], limited: inspected.limited || segmentLimited },
      {
        kind: 'verified',
        units,
        candidates: [...inspected.normal, ...segmented].filter((m) => m.kind === 'extracted'),
        limited: inspected.limited || segmentLimited,
        reason: 'missing_alignment',
      },
      {
        kind: 'sentences',
        units,
        candidates: inspected.inferred.filter((m) => !m.alignmentBasis),
        limited: inspected.limited,
        applicable: inferenceAllowed,
        reason: 'sentence_alignment_rejected',
      },
      {
        kind: 'ellipsis',
        units,
        candidates: inspected.inferred.filter((m) => m.alignmentBasis === 'ellipsis'),
        limited: inspected.limited,
        applicable: inferenceAllowed,
        reason: 'ellipsis_alignment_rejected',
      },
      {
        kind: 'lines',
        units: lineUnits,
        candidates: lineMatches,
        limited: lineLimited || budget.remaining <= 0,
        applicable: lines.length > 0,
        reason: lines.length ? 'source_units_differ' : 'no_line_break',
      },
      {
        kind: 'structure',
        units,
        candidates: inspected.normal.filter((m) => m.record.structuralAlias || units[m.from]?.boundary === 'structure'),
        limited: inspected.limited,
        applicable: structure.units.length > 0,
        reason: 'no_structured_segments',
      },
    ]
    for (const branch of branches) {
      const seen = new Set<string>()
      branch.candidates = branch.candidates.filter((m) => {
        const key = JSON.stringify([ref(m.record), m.start, m.end, m.sourceStart, m.sourceEnd, m.text])
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      branch.limited ||= !!actual.limited
      const applicable = branch.applicable !== false && (opts?.structure?.mode !== 'disabled' || (viewIndex === 0 && branch.kind === 'whole'))
      const plan = selectSentenceCandidates(view.text, branch.units, branch.candidates, branch.limited)
      const path: CacheMatchPath = {
        id: `${viewIndex}:${branch.kind}`,
        kind: branch.kind,
        text: view.text,
        offset: view.offset,
        units: branch.units,
        lookupKeys: sentenceQueryKeys(view.text, options),
        status: plan.status,
        preview: renderSentencePlan(plan),
        matches: [],
        alternatives: [],
        gaps: plan.gaps,
        adopted: false,
        applicable,
        ambiguous: plan.ambiguous,
        limited: branch.limited,
        reasons: [],
        checks: [],
      }
      if (!applicable) path.reasons.push(opts?.structure?.mode === 'disabled' ? 'splitting_disabled' : branch.reason || 'unsupported_structure')
      if (!branch.candidates.length && !path.limited) path.reasons.push(records.length ? branch.reason || 'source_units_differ' : 'no_candidates')
      if (plan.ambiguous) path.reasons.push('ambiguous_translation')
      if (path.limited) path.reasons.push('candidate_limit')
      for (const m of branch.candidates) {
        if (++matches > MAX_MATCHES) {
          path.limited = true
          break
        }
        path.alternatives.push(serialize(m))
      }
      path.matches = path.alternatives.filter((m) =>
        plan.matches.some((chosen) => chosen.start === m.start && chosen.end === m.end && chosen.text === m.text && ref(chosen.record) === m.recordRef)
      )
      path.adopted =
        applicable &&
        plan.matches.length > 0 &&
        plan.matches.every((m) =>
          actual.matches.some((a) => a.start === m.start + view.offset && a.end === m.end + view.offset && ref(a.record) === ref(m.record) && a.text === m.text)
        )
      for (const record of records) {
        if (++details > MAX_DETAILS) {
          path.limited = true
          break
        }
        const eligible = branch.candidates.some((m) => m.record.id === record.id && !!m.record.local === !!record.local)
        const recordUnits = sentenceUnits(record.src, { newlines: record.newlines, structure: record.structure?.source })
        const sameUnit = recordUnits.some((r) => units.some((u) => sameSentence(r, u)))
        const reason = eligible
          ? 'eligible_candidate'
          : !sameUnit
            ? 'source_units_differ'
            : branch.kind === 'whole'
              ? 'whole_text_differs'
              : branch.kind === 'sentences' || branch.kind === 'ellipsis'
                ? alignmentRejectionReason(record, recordUnits, branch.kind)
                : branch.reason || 'missing_alignment'
        path.checks.push({ recordRef: ref(record), reasons: [reason] })
      }
      if (path.limited) result.limited = true
      path.reasons = [...new Set([...path.reasons, ...(path.limited ? ['candidate_limit'] : [])])]
      result.paths.push(path)
    }
  }
  return result
}
