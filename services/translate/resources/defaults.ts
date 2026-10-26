import terms from '@/lib/translate/default-game-terms.json'
import type { ResourcePack, ResourceRecord, ResourceSnapshot } from '@/lib/translate/resource-types'

import fixed from './defaults/fixed-phrases.json'

const languages = [
  { tag: 'ja', name: '日本語' },
  { tag: 'en', name: 'English' },
  { tag: 'ru', name: 'Русский' },
  { tag: 'ko', name: '한국어' },
  { tag: 'zh', name: '中文' },
]
const records: ResourceRecord[] = []
for (const [id, term] of Object.entries(terms)) {
  for (const [sourceLanguage, sourceText] of Object.entries(term.translations)) {
    for (const [targetLanguage, targetText] of Object.entries(term.translations)) {
      if (sourceLanguage === targetLanguage) continue
      const aliases = 'aliases' in term ? (term.aliases as Record<string, string[]>)[sourceLanguage] : undefined
      records.push({
        type: 'entry',
        entryId: `term.${id}.${sourceLanguage}.${targetLanguage}`,
        sourceLanguage,
        targetLanguage,
        sourceText,
        targetText,
        aliases,
        scope: { kind: 'global' },
        reviewStatus: 'reviewed',
        provenance: { kind: 'legacy-game-term' },
        match: { kind: 'exact', allowBoundary: true },
      })
    }
  }
}
for (const [index, [sourceText, targetText]] of Object.entries(fixed).entries()) {
  records.push({
    type: 'entry',
    entryId: `fixed.${index}`,
    sourceLanguage: 'ja',
    targetLanguage: 'zh',
    sourceText,
    targetText,
    scope: { kind: 'global' },
    reviewStatus: 'reviewed',
    provenance: { kind: 'legacy-fixed-phrase' },
    match: { kind: 'exact', allowBoundary: true },
  })
}

/** Only migrate established exact examples. New vocal templates require explicit review. */
export const defaultResourcePack: ResourcePack = {
  manifest: { type: 'manifest', schemaVersion: 1, packId: 'chaya.defaults', version: '1', languages },
  records,
}

export function bundledResourceSnapshot(): ResourceSnapshot {
  return { revision: 0, languages, packs: [{ ...defaultResourcePack, hash: 'bundled', revision: 0 }] }
}
