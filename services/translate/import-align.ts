import { isDynamicTemplate } from '@/lib/translate/dynamic-template'
import { normalizeTranslateKey } from '@/lib/translate/lookup'
import {
  matchingTranslationRubyPairs,
  translationAlignmentSegments,
  translationNumberedPrefixPair,
  translationRubyCompatibleText,
  translationSegmentContent,
  translationSegments,
} from '@/lib/translate/segments'

import { isReusableTranslation, protectControlCodes } from './text-classify'

function boundaries(text: string): string {
  return (text.match(/[,，。．.!！?？]/g) || []).map((mark) => (/[,，]/.test(mark) ? ',' : /[。．.]/.test(mark) ? '.' : /[!！]/.test(mark) ? '!' : '?')).join('')
}

function bodies(source: string, target: string) {
  let src = translationSegmentContent(source).core
  let zh = translationSegmentContent(target).core
  // Some tools save each visual line separately, including unmatched dialogue quotes.
  for (const edge of ['start', 'end']) {
    const re = edge === 'start' ? /^[「」『』【】《》“”]+/ : /[「」『』【】《》“”]+$/
    if (re.test(src) && re.test(zh)) {
      src = src.replace(re, '')
      zh = zh.replace(re, '')
    }
  }
  return [src, zh]
}

function variablesMatch(source: string, target: string): boolean {
  const bare = translationRubyCompatibleText(source, target)
  if (!bare) return false
  const tokens = (text: string) =>
    JSON.stringify(
      protectControlCodes(text)
        .tokens.filter((token) => /^(?:\\|%|\{|_|[A-Za-z_]+\[)/.test(token) && !/^\\[nb]$/i.test(token))
        .sort()
    )
  return tokens(bare[0]) === tokens(bare[1])
}

function sentences(text: string): string[] {
  const result: string[] = []
  let current = ''
  for (const part of translationSegments(text)) {
    current += part
    if (/[。．.!！?？]/.test(translationSegmentContent(part).trail)) {
      result.push(current)
      current = ''
    }
  }
  if (current) result.push(current)
  return result
}

/** Keep full translations; derive body/segment aliases only with compatible boundaries and tokens. */
export function prepareTranslationImport(original: Record<string, string>) {
  const aliases = new Map<string, { rank: number; targets: Set<string> }>()
  let aligned = 0
  let unaligned = 0
  const add = (source: string, target: string, rank: number) => {
    if (!isReusableTranslation(source, target) || !variablesMatch(source, target)) return
    for (const key of new Set([source, normalizeTranslateKey(source)])) {
      if (Object.prototype.hasOwnProperty.call(original, key) && isReusableTranslation(key, original[key])) continue
      const previous = aliases.get(key)
      if (previous && previous.rank < rank) continue
      const entry = previous?.rank === rank ? previous : { rank, targets: new Set<string>() }
      entry.targets.add(target)
      aliases.set(key, entry)
    }
  }
  const align = (source: string, target: string, rank: number): void => {
    const [src, zh] = bodies(source, target)
    add(src, zh, rank)
    const ruby = matchingTranslationRubyPairs(src, zh)
    if (ruby) {
      ruby.forEach((pair) => align(pair.source, pair.target, rank + 1))
      return
    }
    const numbered = translationNumberedPrefixPair(src, zh)
    if (numbered && variablesMatch(source, target)) align(numbered.source, numbered.target, rank + 0.5)
    const sourceParts = translationAlignmentSegments(src)
      .map(translationSegmentContent)
      .filter((part) => part.core.trim())
    const targetParts = translationAlignmentSegments(zh)
      .map(translationSegmentContent)
      .filter((part) => part.core.trim())
    if (sourceParts.length <= 1) return
    if (
      sourceParts.length !== targetParts.length ||
      sourceParts.some((part, i) => boundaries(part.trail) !== boundaries(targetParts[i].trail) || !variablesMatch(part.core, targetParts[i].core))
    ) {
      unaligned++
      const a = sentences(src)
      const b = sentences(zh)
      if (a.length > 1 && a.length === b.length && a.every((line, i) => variablesMatch(line, b[i]))) a.forEach((line, i) => align(line, b[i], rank + 1))
      return
    }
    aligned++
    sourceParts.forEach((part, i) => {
      const [a, b] = bodies(part.core, targetParts[i].core)
      add(a, b, rank + 1)
    })
  }
  for (const [source, target] of Object.entries(original)) {
    if (!target.trim() || isDynamicTemplate(source)) continue
    align(source, target, 0)
    const srcLines = source.split(/\r?\n|\\n(?![A-Za-z]|\[)/)
    const zhLines = target.split(/\r?\n|\\n(?![A-Za-z]|\[)/)
    if (srcLines.length > 1 && srcLines.length === zhLines.length && srcLines.every((line, i) => variablesMatch(line, zhLines[i]))) {
      srcLines.forEach((line, i) => align(line, zhLines[i], 1))
    }
  }
  const map: Record<string, string> = Object.assign(Object.create(null), original)
  let added = 0
  let conflicts = 0
  for (const [source, { targets }] of aliases) {
    if (targets.size !== 1) {
      conflicts++
      continue
    }
    map[source] = [...targets][0]
    added++
  }
  return { map, added, aligned, unaligned, conflicts }
}
