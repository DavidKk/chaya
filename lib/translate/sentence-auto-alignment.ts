/** Transient sentence-order inference; never persisted as verified alignment. */
import type { SentenceRecord } from './sentence-plan'
import { controlSignature, SENTENCE_TOKEN_SOURCE, type SentenceUnit, sentenceUnits } from './sentence-units'
import { scanStructuredText } from './structured-segments'

type CompleteSentence = { from: number; to: number; start: number; end: number; tone: string; controls: string }
export type InferredSentenceAlignment = { from: number; to: number; targetStart: number; targetEnd: number; kind?: 'ellipsis' }

function completeSentences(text: string, units: SentenceUnit[]): CompleteSentence[] | null {
  if (!units.length || text.slice(0, units[0].start).trim() || text.slice(units.at(-1)!.end).trim()) return null
  const out: CompleteSentence[] = []
  let from = 0
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]
    if (unit.boundary === 'structure') return null
    if (unit.boundary !== 'stop') continue
    const start = units[from].start,
      end = unit.end
    out.push({ from, to: i + 1, start, end, tone: unit.tone, controls: JSON.stringify([controlSignature(text.slice(start, end)), text.slice(start, end).match(/%[sdif]/g) || []]) })
    from = i + 1
  }
  return from === units.length && out.length >= 2 ? out : null
}

function hasComplexControls(text: string): boolean {
  // Variable substitutions are local to a sentence. Formatting, Ruby and markup
  // may carry state across sentences and require an explicit mapping instead.
  return [...text.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'))].some((match) => !/^\\(?:[VNP]\[\d+\]|G)$/i.test(match[0]))
}

export function inferSentenceAlignment(record: SentenceRecord, units: SentenceUnit[]): InferredSentenceAlignment[] {
  if (record.derived || record.alignments?.length || record.structure?.source?.mode === 'disabled' || record.structure?.target?.mode === 'disabled') return []
  const structures = [
    scanStructuredText(record.src.replace(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'), ' '), record.structure?.source),
    scanStructuredText(record.zh.replace(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'), ' '), record.structure?.target),
  ]
  if (structures.some((s) => s.units.length || s.diagnostics.length)) return []
  if (hasComplexControls(record.src) || hasComplexControls(record.zh)) return []
  const targetUnits = sentenceUnits(record.zh, { structure: record.structure?.target })
  const source = completeSentences(record.src, units)
  const target = completeSentences(record.zh, targetUnits)
  const sentences =
    source && target && source.length === target.length && source.every((s, i) => s.tone === target[i].tone && s.controls === target[i].controls)
      ? source.map((s, i) => ({ from: s.from, to: s.to, targetStart: target[i].start, targetEnd: target[i].end }))
      : []
  return [...sentences, ...inferEllipsisClauses(record, units, targetUnits)]
}

function inferEllipsisClauses(record: SentenceRecord, source: SentenceUnit[], target: SentenceUnit[]): InferredSentenceAlignment[] {
  if (source.length < 2 || source.length !== target.length) return []
  const signature = (text: string, unit: SentenceUnit) => JSON.stringify([unit.controls, text.slice(unit.start, unit.end).match(/%[sdif]/g) || []])
  // Require the entire parent to align structurally, including stutters and
  // ellipsis positions. Plain comma counts alone never authorize extraction.
  if (
    source.some(
      (unit, i) =>
        unit.boundary !== target[i].boundary ||
        unit.tone !== target[i].tone ||
        unit.key.includes('...') !== target[i].key.includes('...') ||
        signature(record.src, unit) !== signature(record.zh, target[i])
    )
  )
    return []
  const clauses = source.flatMap((unit, i) =>
    unit.key.endsWith('...') && target[i].key.endsWith('...') ? [{ from: i, to: i + 1, targetStart: target[i].start, targetEnd: target[i].end, kind: 'ellipsis' as const }] : []
  )
  return clauses.length >= 2 ? clauses : []
}

export function inferredSentenceTarget(record: SentenceRecord, groups: InferredSentenceAlignment[], from: number, to: number): string | null {
  // Resolve one complete sentence at a time so a larger inferred block cannot
  // hide conflicting translations of one of its constituent sentences.
  const group = groups.find((g) => g.from === from && g.to === to)
  return group ? record.zh.slice(group.targetStart, group.targetEnd) : null
}

/** Explanations for diagnostic inspection; never authorizes a mapping. */
export function alignmentRejectionReason(record: SentenceRecord, units: SentenceUnit[], kind: 'sentences' | 'ellipsis'): string {
  if (record.derived) return 'derived_alias_no_inference'
  if (record.alignments?.length) return 'explicit_mapping_required'
  if (record.structure?.source?.mode === 'disabled' || record.structure?.target?.mode === 'disabled') return 'splitting_disabled'
  if (
    [
      scanStructuredText(record.src.replace(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'), ' '), record.structure?.source),
      scanStructuredText(record.zh.replace(new RegExp(SENTENCE_TOKEN_SOURCE, 'g'), ' '), record.structure?.target),
    ].some((s) => s.units.length || s.diagnostics.length)
  )
    return 'unsupported_structure'
  if (hasComplexControls(record.src) || hasComplexControls(record.zh)) return 'unsafe_control_scope'
  const target = sentenceUnits(record.zh, { structure: record.structure?.target })
  if (kind === 'sentences') {
    const a = completeSentences(record.src, units),
      b = completeSentences(record.zh, target)
    if (!a) return 'source_not_complete_sentences'
    if (!b) return 'target_not_complete_sentences'
    if (a.length !== b.length) return 'alignment_count_differs'
    return a.every((s, i) => s.tone === b[i].tone && s.controls === b[i].controls) ? 'query_boundary_incompatible' : 'alignment_markers_differ'
  }
  if (units.length !== target.length) return 'alignment_count_differs'
  return inferEllipsisClauses(record, units, target).length ? 'query_boundary_incompatible' : 'ellipsis_alignment_rejected'
}
