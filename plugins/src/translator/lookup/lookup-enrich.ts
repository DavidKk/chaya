/**
 * In-game lookup enrich: trailing-number index + glossary templates + proper-name table from $data*.
 */
import { GLOSSARY_TOKEN, type GlossaryEntry, type GlossaryTokenType, indexGlossaryTemplate, translateByGlossaryTemplate } from '@/lib/translate/glossary-mask'
import { indexTrailingStem, normalizeTranslateKey, translateWithLookup } from '@/lib/translate/lookup'
import { containsJapaneseText } from '@/services/translate/text-classify'

type Lookup = Record<string, string>

const FIELD_BUCKETS: Array<{ type: GlossaryTokenType; tables: () => Array<Record<string, unknown> | null> | null; fields: string[]; minLen: number }> = [
  {
    type: 'name',
    tables: () => (typeof $dataActors !== 'undefined' ? ($dataActors as Array<Record<string, unknown> | null>) : null),
    fields: ['name', 'nickname'],
    minLen: 2,
  },
  {
    type: 'enemy',
    tables: () => (typeof $dataEnemies !== 'undefined' ? ($dataEnemies as Array<Record<string, unknown> | null>) : null),
    fields: ['name'],
    minLen: 2,
  },
  {
    type: 'skill',
    tables: () => (typeof $dataSkills !== 'undefined' ? ($dataSkills as Array<Record<string, unknown> | null>) : null),
    fields: ['name'],
    minLen: 2,
  },
  {
    type: 'item',
    tables: () => (typeof $dataItems !== 'undefined' ? ($dataItems as Array<Record<string, unknown> | null>) : null),
    fields: ['name'],
    minLen: 2,
  },
  {
    type: 'weapon',
    tables: () => (typeof $dataWeapons !== 'undefined' ? ($dataWeapons as Array<Record<string, unknown> | null>) : null),
    fields: ['name'],
    minLen: 2,
  },
  {
    type: 'armor',
    tables: () => (typeof $dataArmors !== 'undefined' ? ($dataArmors as Array<Record<string, unknown> | null>) : null),
    fields: ['name'],
    minLen: 2,
  },
  {
    type: 'state',
    tables: () => (typeof $dataStates !== 'undefined' ? ($dataStates as Array<Record<string, unknown> | null>) : null),
    fields: ['name'],
    minLen: 2,
  },
]

export function createLookupEnrichment() {
  const stemBase = new Map<string, string>()
  const templateZh = new Map<string, string>()
  let entries: GlossaryEntry[] = []

  function rebuildGlossary() {
    const seen = new Set<string>()
    const next: GlossaryEntry[] = []
    for (const bucket of FIELD_BUCKETS) {
      const table = bucket.tables()
      if (!table) continue
      const token = GLOSSARY_TOKEN[bucket.type]
      for (const row of table) {
        if (!row) continue
        for (const field of bucket.fields) {
          const jp = String(row[field] ?? '')
            .trim()
            .replace(/^#/, '')
          if (!jp || seen.has(jp)) continue
          if (!containsJapaneseText(jp)) continue
          if (jp.length < bucket.minLen) continue
          if (jp.length <= 2 && bucket.type !== 'name') continue
          seen.add(jp)
          next.push({ jp, type: bucket.type, token })
        }
      }
    }
    next.sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp))
    entries = next
  }

  function zhMapFrom(lookup: Lookup): Record<string, string> {
    const map: Record<string, string> = Object.create(null)
    for (const e of entries) {
      if (Object.prototype.hasOwnProperty.call(lookup, e.jp)) map[e.jp] = lookup[e.jp]!
      else {
        const nk = normalizeTranslateKey(e.jp)
        if (nk !== e.jp && Object.prototype.hasOwnProperty.call(lookup, nk)) map[e.jp] = lookup[nk]!
        else map[e.jp] = e.jp
      }
    }
    return map
  }

  function notePair(src: string, zh: string, lookup: Lookup) {
    indexTrailingStem(stemBase, src, zh)
    if (entries.length) indexGlossaryTemplate(templateZh, src, zh, entries, zhMapFrom(lookup))
  }

  /** Rebuild template index after full/incremental writes (glossary changes or first DB ready). */
  function reindexAll(lookup: Lookup) {
    rebuildGlossary()
    stemBase.clear()
    templateZh.clear()
    for (const [src, zh] of Object.entries(lookup)) {
      if (!src || zh == null) continue
      // Skip normalize duplicates: same translation as the original key; re-index is harmless
      indexTrailingStem(stemBase, src, zh)
      if (entries.length) indexGlossaryTemplate(templateZh, src, zh, entries, zhMapFrom(lookup))
    }
  }

  function resolve(lookup: Lookup, text: string): string | null {
    const viaLookup = translateWithLookup(lookup, text, { stemBase })
    if (viaLookup !== text) return viaLookup
    if (!entries.length) return null
    const templated = translateByGlossaryTemplate(text, entries, zhMapFrom(lookup), templateZh)
    return templated
  }

  return {
    rebuildGlossary,
    reindexAll,
    notePair,
    resolve,
    get entryCount() {
      return entries.length
    },
    get stemCount() {
      return stemBase.size
    },
    get templateCount() {
      return templateZh.size
    },
  }
}

export type LookupEnrichment = ReturnType<typeof createLookupEnrichment>
