import { lookupGameTerm } from './game-terms'
import { lookupTranslationRecord } from './lookup'
import { translationExportText } from './segments'
import { sentenceOuterShell } from './sentence-units'

export type TranslationExportMode = 'all' | 'untranslated'

/** Source entries may not contain the latest translations; fill exported values from the current translation library. */
export function buildTranslationExport(
  entries: Record<string, string>,
  lookup: (source: string) => string | null | undefined,
  originals: Iterable<string> = Object.keys(entries)
): Record<string, string> {
  const output = new Map<string, string>()
  for (const original of originals) {
    const source = translationExportText(original)
    const exact = lookup(original) || lookupTranslationRecord(entries, original) || (original !== source ? lookup(source) || lookupTranslationRecord(entries, source) : null)
    const { lead, core, trail } = sentenceOuterShell(source)
    const body = !exact && core !== source && !/[!?！？]/.test(trail) ? (lookup(core) ?? entries[core]) : null
    const value = translationExportText(exact || (body ? lead + body + trail : (lookupGameTerm(source) ?? '')))
    if (source && (value || !output.has(source))) output.set(source, value)
  }
  return Object.fromEntries(output)
}

export function filterTranslationExport(entries: Record<string, string>, mode: TranslationExportMode): Record<string, string> {
  return mode === 'all' ? entries : Object.fromEntries(Object.entries(entries).filter(([, value]) => value === ''))
}
