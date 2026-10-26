export type ResourceLanguage = { tag: string; name: string }
export type ResourceManifest = {
  type: 'manifest'
  schemaVersion: 1
  packId: string
  version: string
  languages: ResourceLanguage[]
}
type ResourceBase = {
  entryId: string
  sourceLanguage: string
  targetLanguage: string
  scope: { kind: 'global' } | { kind: 'game'; gameId: string }
  reviewStatus: 'candidate' | 'reviewed'
  provenance: { kind: string; note?: string }
  conditions?: { category?: string; speaker?: string; scene?: string }
}
export type ResourceEntry = ResourceBase & {
  type: 'entry'
  sourceText: string
  targetText: string
  aliases?: string[]
  match: { kind: 'exact'; allowBoundary?: boolean }
  badTranslations?: string[]
}
export type VocalRule = ResourceBase & {
  type: 'vocal_rule'
  templateKind: 'vocal-sequence'
  units: Record<string, string>
  modifiers: {
    punctuation: string[]
    minUnits: number
    maxUnits: number
    maxInputLength: number
  }
}
export type ResourceRecord = ResourceEntry | VocalRule
export type ResourcePack = { manifest: ResourceManifest; records: ResourceRecord[] }
export type ActiveResourcePack = ResourcePack & { hash: string; revision: number }
export type ResourceSnapshot = { revision: number; languages: ResourceLanguage[]; packs: ActiveResourcePack[] }
export type ResourceContext = { sourceLanguage: string; targetLanguage: string; gameId?: string; category?: string; speaker?: string; scene?: string }
export type ResourceHit = {
  targetText: string
  packId: string
  version: string
  entryId: string
  revision: number
  matchKind: 'exact' | 'vocal-template'
}

export function canonicalResourceLanguage(value: string): string {
  try {
    const [tag] = Intl.getCanonicalLocales(value)
    if (tag && tag.length <= 100) return tag
  } catch {
    // Unknown or malformed identifiers must not silently fall back to Japanese.
  }
  throw new TypeError(`Invalid language identifier: ${value}`)
}
