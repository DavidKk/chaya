/** Transient sentence-order inference; never persisted as verified alignment. */
import type { SentenceRecord } from './sentence-plan'
import { controlSignature, SENTENCE_TOKEN_SOURCE, type SentenceUnit, sentenceUnits } from './sentence-units'
import { scanStructuredText } from './structured-segments'

type CompleteSentence = { from: number; to: number; start: number; end: number; tone: string; controls: string }
export type InferredSentenceAlignment = { from: number; to: number; targetStart: number; targetEnd: number }

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
  const source = completeSentences(record.src, units)
  if (!source) return []
  const target = completeSentences(record.zh, sentenceUnits(record.zh, { structure: record.structure?.target }))
  if (!target || source.length !== target.length || source.some((s, i) => s.tone !== target[i].tone || s.controls !== target[i].controls)) return []
  return source.map((s, i) => ({ from: s.from, to: s.to, targetStart: target[i].start, targetEnd: target[i].end }))
}

export function inferredSentenceTarget(record: SentenceRecord, groups: InferredSentenceAlignment[], from: number, to: number): string | null {
  // Resolve one complete sentence at a time so a larger inferred block cannot
  // hide conflicting translations of one of its constituent sentences.
  const group = groups.find((g) => g.from === from && g.to === to)
  return group ? record.zh.slice(group.targetStart, group.targetEnd) : null
}
