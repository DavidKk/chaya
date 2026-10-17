import { peelChoiceMetaShell } from './choice-meta'
import { matchingTranslationRubyPairs, translationNumberedPrefixPair } from './segments'
import { sentenceOuterShell } from './sentence-units'

/** Explicit paired shells, numbered prefixes and named ruby parameters; never inferred prose alignment. */
export function sentenceAliases(src: string, zh: string): Array<{ src: string; zh: string }> {
  const aliases: Array<{ src: string; zh: string }> = []
  const a = peelChoiceMetaShell(src),
    b = peelChoiceMetaShell(zh)
  if ((a.lead || a.trail) && ((!b.lead && !b.trail) || (a.lead === b.lead && a.trail === b.trail)) && !/(?:如果|启用|禁用)\s*[(（]/.test(b.core))
    aliases.push({ src: a.core, zh: b.core })
  const numbered = translationNumberedPrefixPair(src, zh)
  if (numbered) aliases.push({ src: numbered.source, zh: numbered.target })
  const source = sentenceOuterShell(src),
    target = sentenceOuterShell(zh)
  if (source.core !== src && target.core !== zh && !/[!?！？]/.test(source.trail)) aliases.push({ src: source.core, zh: target.core })
  for (const pair of matchingTranslationRubyPairs(src, zh) || []) aliases.push({ src: pair.source, zh: pair.target })
  return aliases.filter((pair) => pair.src && pair.zh)
}
