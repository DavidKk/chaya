import type { ActiveResourcePack, ResourceContext, ResourceHit, ResourceRecord, ResourceSnapshot, VocalRule } from './resource-types'
import { translationSegmentContent } from './segments'

type Candidate = { pack: ActiveResourcePack; record: ResourceRecord }
type Decision = { hit: ResourceHit | null; conflict: boolean }
const key = (text: string) => text.normalize('NFC')

/** Bounded whole-input parser. Unknown units and ambiguous output always miss. */
export function matchVocalRule(text: string, rule: VocalRule): string | null {
  const source = key(text)
  if (Array.from(source).length > rule.modifiers.maxInputLength) return null
  const units = Object.entries(rule.units).sort(([a], [b]) => b.length - a.length)
  const punctuation = [...rule.modifiers.punctuation].sort((a, b) => b.length - a.length)
  // Track all interpretations rather than silently choosing one segmentation.
  const states: Array<Map<number, Set<string>>> = Array.from({ length: source.length + 1 }, () => new Map())
  states[0].set(0, new Set(['']))
  let stateCount = 0
  for (let at = 0; at < source.length; at++) {
    for (const [count, outputs] of states[at]) {
      const choices: Array<[string, string, number]> = units.filter(([unit]) => source.startsWith(unit, at)).map(([unit, target]) => [unit, target, 1])
      for (const mark of punctuation) if (source.startsWith(mark, at)) choices.push([mark, mark, 0])
      for (const [part, target, increment] of choices) {
        const nextCount = count + increment
        if (nextCount > rule.modifiers.maxUnits) continue
        const next = states[at + part.length]
        const values = next.get(nextCount) || new Set<string>()
        for (const output of outputs) {
          const value = output + target
          if (value.length > 16000) return null
          values.add(value)
          if (++stateCount > 4096 || values.size > 8) return null
        }
        next.set(nextCount, values)
      }
    }
  }
  const results = new Set<string>()
  for (const [count, outputs] of states[source.length]) if (count >= rule.modifiers.minUnits) for (const output of outputs) results.add(output)
  return results.size === 1 ? [...results][0] : null
}

export function createResourceMatcher(snapshot: ResourceSnapshot) {
  const exact = new Map<string, Candidate[]>()
  const vocal: Candidate[] = []
  for (const pack of snapshot.packs) {
    for (const record of pack.records) {
      if (record.reviewStatus !== 'reviewed') continue
      const candidate = { pack, record }
      if (record.type === 'vocal_rule') vocal.push(candidate)
      else
        for (const text of [record.sourceText, ...(record.aliases || [])]) {
          const id = JSON.stringify([record.sourceLanguage, record.targetLanguage, key(text)])
          exact.set(id, [...(exact.get(id) || []), candidate])
        }
    }
  }
  function eligible(record: ResourceRecord, context: ResourceContext) {
    return (
      record.sourceLanguage === context.sourceLanguage &&
      record.targetLanguage === context.targetLanguage &&
      (record.scope.kind === 'global' || record.scope.gameId === context.gameId) &&
      Object.entries(record.conditions || {}).every(([name, value]) => context[name as keyof ResourceContext] === value)
    )
  }
  function choose(candidates: Array<Candidate & { output: string }>, context: ResourceContext): Decision {
    const available = candidates.filter(({ record }) => eligible(record, context))
    const score = ({ record }: Candidate) => (record.scope.kind === 'game' ? 100 : 0) + Object.keys(record.conditions || {}).length
    const best = Math.max(-1, ...available.map(score))
    const winners = available.filter((candidate) => score(candidate) === best)
    if (!winners.length) return { hit: null, conflict: false }
    if (new Set(winners.map(({ output }) => output)).size !== 1) return { hit: null, conflict: true }
    const { pack, record, output } = winners[0]
    return {
      conflict: false,
      hit: {
        targetText: output,
        packId: pack.manifest.packId,
        version: pack.manifest.version,
        entryId: record.entryId,
        revision: snapshot.revision,
        matchKind: record.type === 'entry' ? 'exact' : 'vocal-template',
      },
    }
  }
  return {
    revision: snapshot.revision,
    match(text: string, context: ResourceContext): ResourceHit | null {
      const candidates = (source: string) => exact.get(JSON.stringify([context.sourceLanguage, context.targetLanguage, key(source)])) || []
      const full = choose(
        candidates(text).map((candidate) => ({ ...candidate, output: (candidate.record as Extract<ResourceRecord, { type: 'entry' }>).targetText })),
        context
      )
      if (full.hit || full.conflict) return full.hit
      const shell = translationSegmentContent(text)
      if (shell.core !== text) {
        const wrapped = choose(
          candidates(shell.core)
            .filter(({ record }) => record.type === 'entry' && record.match.allowBoundary)
            .map((candidate) => ({ ...candidate, output: shell.lead + (candidate.record as Extract<ResourceRecord, { type: 'entry' }>).targetText + shell.trail })),
          context
        )
        if (wrapped.hit || wrapped.conflict) return wrapped.hit
      }
      const generated = vocal
        .filter(({ record }) => eligible(record, context))
        .flatMap((candidate) => {
          const output = matchVocalRule(text, candidate.record as VocalRule)
          return output == null ? [] : [{ ...candidate, output }]
        })
      return choose(generated, context).hit
    },
  }
}
