import type { CacheLangPair } from '@/lib/translate/cache-lang'
import { type NewlineAnnotation, validateNewlineAnnotations } from '@/lib/translate/logic-text'
import { type AlignmentGroup, validateAlignments } from '@/lib/translate/sentence-plan'
import { sameSentence, sentenceUnits } from '@/lib/translate/sentence-units'
import { type RecordStructure, type StructureAnnotation, validRecordStructure } from '@/lib/translate/structured-segments'

import type { MatchIndex } from './match-index'

export type ConfirmSegmentDiagnosis = {
  index: number
  src: string
  zh: string
  ok: boolean
  reason?: 'span' | 'validate' | 'empty'
}

export type ConfirmSegmentsOptions = {
  newlines?: NewlineAnnotation[]
  structure?: RecordStructure
  replaceGroups?: boolean
  expectedRevision?: number
  /** Validate only; do not bump revision or write. */
  dryRun?: boolean
  /** Explicit verified groups (UTF-16 offsets on parent src/zh). */
  groups?: AlignmentGroup[]
}

function uniqueSpan(text: string, fragment: string, newlines?: NewlineAnnotation[], structure?: StructureAnnotation) {
  const units = sentenceUnits(text, { newlines, structure })
  const parts = sentenceUnits(fragment)
  if (!parts.length) return null
  const hits: Array<{ start: number; end: number }> = []
  for (let i = 0; i + parts.length <= units.length; i++) {
    if (
      parts.every((part, j) => sameSentence(part, units[i + j]!) && (j === parts.length - 1 || part.boundary === units[i + j]!.boundary)) &&
      units[i]!.block === units[i + parts.length - 1]!.block
    )
      hits.push({ start: units[i]!.start, end: units[i + parts.length - 1]!.end })
  }
  return hits.length === 1 ? hits[0] : null
}

/** A human confirms exact source/target fragments of an unchanged record; no child final records. */
export function confirmRecordSegments(index: MatchIndex, parent: { src: string; zh: string }, pairs: Array<[string, string]>, pair: CacheLangPair, opts?: ConfirmSegmentsOptions) {
  const record = index.record(parent.src, pair)
  const diagnostics: ConfirmSegmentDiagnosis[] = []
  const stats = {
    inserted: 0,
    identical: 0,
    conflict: 0,
    skipped: 0,
    total: pairs.length + (opts?.groups?.length || 0),
    localOnly: [] as Array<[string, string]>,
    stale: false,
    dryRun: Boolean(opts?.dryRun),
    diagnostics,
  }
  if (!record || record.zh !== parent.zh) return { ...stats, stale: true }
  if (opts?.expectedRevision !== undefined && record.revision !== opts.expectedRevision) return { ...stats, stale: true }
  if ((opts?.newlines && !validateNewlineAnnotations(record.src, opts.newlines)) || (opts?.structure && !validRecordStructure(opts.structure))) {
    return {
      ...stats,
      conflict: Math.max(1, stats.total),
      diagnostics: [{ index: -1, src: '', zh: '', ok: false, reason: 'validate' as const }],
    }
  }

  const newlines = opts?.newlines ?? record.newlines
  const structure = opts?.structure ?? record.structure
  const draft = { ...record, newlines, structure }
  let groups: AlignmentGroup[] = opts?.replaceGroups ? [] : [...(record.alignments || [])]

  const tryAdd = (group: AlignmentGroup, index: number, src: string, zh: string) => {
    const dup = groups.some(
      (g) =>
        g.sourceStart === group.sourceStart &&
        g.sourceEnd === group.sourceEnd &&
        g.targetStart === group.targetStart &&
        g.targetEnd === group.targetEnd &&
        g.evidence === group.evidence
    )
    if (dup) {
      stats.identical++
      diagnostics.push({ index, src, zh, ok: true })
      return
    }
    const next = [...groups, group].sort((a, b) => a.sourceStart - b.sourceStart)
    if (!validateAlignments(draft, next)) {
      stats.conflict++
      diagnostics.push({ index, src, zh, ok: false, reason: 'validate' })
      return
    }
    groups = next
    stats.inserted++
    diagnostics.push({ index, src, zh, ok: true })
  }

  if (opts?.groups?.length) {
    for (let i = 0; i < opts.groups.length; i++) {
      const group = opts.groups[i]!
      tryAdd(group, i, record.src.slice(group.sourceStart, group.sourceEnd), record.zh.slice(group.targetStart, group.targetEnd))
    }
  }

  for (let i = 0; i < pairs.length; i++) {
    const [src, zh] = pairs[i]!
    if (!src.trim() || !zh.trim()) {
      stats.skipped++
      diagnostics.push({ index: i, src, zh, ok: false, reason: 'empty' })
      continue
    }
    const source = uniqueSpan(record.src, src, newlines, structure?.source)
    const target = uniqueSpan(record.zh, zh, undefined, structure?.target)
    if (!source || !target) {
      stats.conflict++
      diagnostics.push({ index: i, src, zh, ok: false, reason: 'span' })
      continue
    }
    tryAdd({ sourceStart: source.start, sourceEnd: source.end, targetStart: target.start, targetEnd: target.end, evidence: 'verified' }, i, src, zh)
  }

  if (opts?.dryRun) return stats
  if (stats.conflict > 0 || stats.skipped > 0) return { ...stats, inserted: 0 }
  if (!stats.inserted && !opts?.newlines && !opts?.structure) return stats

  const ok = index.setAlignment(record.src, pair, groups, record.revision, { newlines: opts?.newlines, structure: opts?.structure })
  if (!ok) return { ...stats, inserted: 0, stale: true }
  return stats
}
