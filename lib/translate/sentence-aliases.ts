import { peelChoiceMetaShell } from './choice-meta'
import { matchingTranslationRubyPairs, translationNumberedPrefixPair } from './segments'
import { sentenceOuterShell } from './sentence-units'
import { type RecordStructure, scanStructuredText } from './structured-segments'

/** Explicit paired shells, numbered prefixes and named ruby parameters; never inferred prose alignment. */
export function sentenceAliases(src: string, zh: string): Array<{ src: string; zh: string }> {
  const aliases: Array<{ src: string; zh: string }> = []
  const a = peelChoiceMetaShell(src),
    b = peelChoiceMetaShell(zh)
  if ((a.lead || a.trail) && ((!b.lead && !b.trail) || (a.lead === b.lead && a.trail === b.trail)) && !/(?:如果|启用|禁用)\s*[(（]/.test(b.core))
    aliases.push({ src: a.core, zh: b.core })
  // Some message fragments begin a parenthetical that closes in a later message.
  // Strip only matching source/target opening shells; this maps the entire fragment.
  const sourceOpening = src.match(/^(?:\s*[(（])+/)?.[0]
  const targetOpening = zh.match(/^(?:\s*[(（])+/)?.[0]
  if (sourceOpening && targetOpening && sourceOpening.normalize('NFKC').trim() === targetOpening.normalize('NFKC').trim() && !/[)）]/.test(src) && !/[)）]/.test(zh))
    aliases.push({ src: src.slice(sourceOpening.length), zh: zh.slice(targetOpening.length) })
  const numbered = translationNumberedPrefixPair(src, zh)
  if (numbered) aliases.push({ src: numbered.source, zh: numbered.target })
  const source = sentenceOuterShell(src),
    target = sentenceOuterShell(zh)
  if (source.core !== src && target.core !== zh && !/[!?！？]/.test(source.trail)) aliases.push({ src: source.core, zh: target.core })
  for (const pair of matchingTranslationRubyPairs(src, zh) || []) aliases.push({ src: pair.source, zh: pair.target })
  return aliases.filter((pair) => pair.src && pair.zh)
}

/** Reuse complete numbered items, never arbitrary clauses paired by their count. */
export function structuredSentenceAliases(src: string, zh: string, structure?: RecordStructure): Array<{ src: string; zh: string; context: number }> {
  const source = scanStructuredText(src, structure?.source)
  const target = scanStructuredText(zh, structure?.target)
  if (source.diagnostics.length || target.diagnostics.length || [...source.units, ...target.units].some((unit) => unit.state !== 'accepted')) return []
  const a = source.units.filter((unit) => unit.kind === 'item')
  const b = target.units.filter((unit) => unit.kind === 'item')
  if (a.length < 2 || a.length !== b.length || a.some((unit, i) => unit.ordinal === undefined || unit.ordinal !== b[i].ordinal)) return []
  const pairs = a.map((unit, i) => ({ source: unit, target: b[i] }))
  const label = source.units.find((unit) => unit.kind === 'label')
  const translatedLabel = target.units.find((unit) => unit.kind === 'label')
  if (label && translatedLabel) pairs.unshift({ source: label, target: translatedLabel })
  const context = source.units.filter((unit) => unit.kind === 'text').reduce((length, unit) => length + unit.end - unit.start, 0)
  return pairs.flatMap((pair) => {
    const from = src.slice(pair.source.start, pair.source.end)
    let to = zh.slice(pair.target.start, pair.target.end)
    // Imports also use “①.正文”; its dot belongs to the numbering, not the translation.
    if (/[①-⑳][\t ]*$/u.test(zh.slice(0, pair.target.start))) to = to.replace(/^[.．][\t ]*/u, '')
    return from && to ? [{ src: from, zh: to, context }] : []
  })
}
