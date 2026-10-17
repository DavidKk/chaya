import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import { lookupGameTerm } from '@/lib/translate/game-terms'
import { normalizeTranslateKey } from '@/lib/translate/lookup'
import { lookupWithRmDigitTemplate, toRmDigitTemplate } from '@/lib/translate/rm-escape'
import {
  mapTranslationCacheLines,
  mapTranslationDisplaySegments,
  mapTranslationRubySegments,
  mapTranslationSegments,
  translationCacheLines,
  translationDisplayChunks,
  translationExportText,
  translationRubyChunks,
  translationSegmentContent,
  translationSources,
} from '@/lib/translate/segments'
import { sentenceOuterShell } from '@/lib/translate/sentence-units'

import { isReusableTranslation, protectSentenceForTranslate as protectForTranslate, shouldTranslate } from './text-classify'

function lookupCandidates(src: string): Array<{ key: string; lead: string; trail: string; bodyOnly?: boolean; displayOnly?: boolean }> {
  const choice = peelChoiceMetaShell(src)
  const key = choice.core || src
  const guard = protectForTranslate(src)
  const display = translationExportText(key)
  const shell = sentenceOuterShell(key)
  const displayShell = translationSegmentContent(key)
  const leadSpace = key.match(/^\s*/)?.[0] ?? ''
  const trailSpace = key.match(/\s*$/)?.[0] ?? ''
  const trimmed = key.slice(leadSpace.length, key.length - trailSpace.length)
  const description = key.match(/^<SG説明:/)
  // Restore condition scripts verbatim; do not reuse legacy whole-string entries that translated if/en keywords.
  return [
    { key, lead: choice.lead, trail: choice.trail },
    { key: normalizeTranslateKey(key), lead: choice.lead, trail: choice.trail },
    ...(trimmed && trimmed !== key ? [{ key: trimmed, lead: choice.lead + leadSpace, trail: trailSpace + choice.trail }] : []),
    ...(description ? [{ key: key.slice(description[0].length), lead: choice.lead + description[0], trail: choice.trail }] : []),
    ...(display === key
      ? []
      : [display, normalizeTranslateKey(display)].map((candidate) => ({
          key: candidate,
          lead: choice.lead + displayShell.lead,
          trail: displayShell.trail + choice.trail,
          displayOnly: true,
        }))),
    ...(shell.core !== key && !/[!?！？]/.test(shell.trail) ? [{ key: shell.core, lead: choice.lead + shell.lead, trail: shell.trail + choice.trail, bodyOnly: true }] : []),
    { key: guard.core, lead: guard.lead, trail: guard.trail },
    { key: normalizeTranslateKey(guard.core), lead: guard.lead, trail: guard.trail },
  ]
}

/** Share candidate keys between persistence, live lookup and job progress; restore controls only in the returned output. */
export function translationLookupKeys(src: string): string[] {
  return [
    ...new Set(
      [
        src,
        ...translationDisplayChunks(peelChoiceMetaShell(src).core)
          .filter((chunk) => !chunk.display)
          .map((chunk) => chunk.text),
        ...translationRubyChunks(peelChoiceMetaShell(src).core).flatMap((chunk) => (chunk.ruby ? [chunk.base!, chunk.reading!] : [chunk.text])),
      ]
        .flatMap((source) => [source, ...translationSources(source), ...translationCacheLines(source).flatMap(translationSources)])
        .flatMap((source) => lookupCandidates(source).flatMap(({ key }) => [key, toRmDigitTemplate(key)]))
    ),
  ].filter(Boolean)
}

function lookupWholeTranslation(get: (key: string) => string | null | undefined, src: string): string | null {
  for (const { key, lead, trail, bodyOnly, displayOnly } of lookupCandidates(src)) {
    if (!key) continue
    const hit = lookupWithRmDigitTemplate((k) => {
      const value = get(k)
      return value && isReusableTranslation(k, value) ? value : null
    }, key)
    if (hit != null) {
      const restored = lead + (displayOnly ? translationSegmentContent(hit).core : bodyOnly ? sentenceOuterShell(hit).core : hit) + trail
      if (isReusableTranslation(src, restored)) return restored
    }
  }
  return null
}

export function lookupCachedTranslation(get: (key: string) => string | null | undefined, src: string): string | null {
  const whole = lookupWholeTranslation(get, src)
  if (whole != null) return whole
  if (/\\(?:RB\[|ruby\[)/i.test(src)) return lookupDisplayParts(get, src) ?? mapTranslationRubySegments(src, (part) => lookupCachedTranslation(get, part))
  return (
    lookupDisplayParts(get, src) ??
    mapTranslationRubySegments(src, (part) => lookupCachedTranslation(get, part)) ??
    lookupParts(get, src, mapTranslationSegments) ??
    lookupParts(get, src, mapTranslationCacheLines)
  )
}

function lookupDisplayParts(get: (key: string) => string | null | undefined, src: string): string | null {
  let complete = true
  let resolved = false
  const result = mapTranslationDisplaySegments(src, (part) => {
    const hit = lookupCachedTranslation(get, part)
    if (hit != null) {
      resolved = true
      return hit
    }
    // Missing Han-only names must not be mistaken for formatting or already translated text.
    if (/\\(?:RB\[|ruby\[)/i.test(part) || /[\p{L}]/u.test(translationSegmentContent(part).core)) complete = false
    return part
  })
  return complete && resolved ? result : null
}

function lookupParts(get: (key: string) => string | null | undefined, src: string, map: typeof mapTranslationSegments): string | null {
  let complete = true
  let changed = false
  const result = map(src, (part, original) => {
    const legacy = lookupWholeTranslation(get, original)
    const semantic = /[!?！？。．.]/.test(translationSegmentContent(original).trail)
    const hit = (semantic ? null : lookupWholeTranslation(get, part)) ?? (legacy == null ? null : translationSegmentContent(legacy).core)
    if (hit != null) {
      changed = true
      return hit
    }
    if (shouldTranslate(part)) complete = false
    return part
  })
  return complete && changed ? result : null
}

export function lookupGameTranslation(
  localGet: (key: string) => string | null | undefined,
  sharedGet: (key: string) => string | null | undefined,
  src: string
): { zh: string; engine: 'cache:local' | 'cache:remote' } | null {
  const local = lookupCachedTranslation(localGet, src)
  if (local != null) return { zh: local, engine: 'cache:local' }
  const shared = lookupCachedTranslation(sharedGet, src)
  if (shared != null) return { zh: shared, engine: 'cache:remote' }
  const term = lookupGameTerm(src)
  return term == null ? null : { zh: term, engine: 'cache:local' }
}
