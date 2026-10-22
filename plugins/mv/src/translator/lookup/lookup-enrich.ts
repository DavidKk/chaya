/**
 * In-game lookup enrich: trailing-number index + glossary templates + proper-name table from $data*.
 */
import { createDynamicTemplateIndex, type DynamicValues } from '@/lib/translate/dynamic-template'
import { GLOSSARY_TOKEN, type GlossaryEntry, type GlossaryTokenType, indexGlossaryTemplate, translateByGlossaryTemplate } from '@/lib/translate/glossary-mask'
import { indexTrailingStem, invalidateWhitespaceLookup, normalizeTranslateKey, translatePlain, translateWithLookup } from '@/lib/translate/lookup'
import { shouldTranslate } from '@/services/translate/text-classify'

type Lookup = Record<string, string>

function dynamicValues(): DynamicValues {
  const values: Record<string, Set<string>> = Object.fromEntries(['_actor', '_name', '_class', '_desc1', '_desc2'].map((key) => [key, new Set<string>()]))
  values._desc1.add('')
  values._desc2.add('')
  const game = globalThis as unknown as Record<string, unknown>
  for (const key of ['$dataActors', '$dataEnemies', '$dataSkills', '$dataItems', '$dataWeapons', '$dataArmors', '$dataStates', '$dataClasses', '$dataSystem']) {
    const data = game[key]
    const rows = Array.isArray(data) ? data : [data]
    for (const row of rows as Array<Record<string, unknown> | null | undefined>) {
      if (!row) continue
      if (typeof row.name === 'string') {
        values._name.add(row.name)
        if (key === '$dataActors') values._actor.add(row.name)
        if (key === '$dataClasses') values._class.add(row.name)
      }
      for (const field of ['params', 'elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes']) {
        if (Array.isArray(row[field])) for (const name of row[field]) if (typeof name === 'string') values._name.add(name)
      }
      if (typeof row.description === 'string') {
        const lines = row.description.split('\n')
        values._desc1.add(lines[0] || '')
        values._desc2.add(lines[1] || '')
      }
    }
  }
  const actors = game.$gameActors as { _data?: Array<{ name?: () => string } | null> } | undefined
  for (const actor of actors?._data || []) if (actor?.name) values._actor.add(actor.name())
  const system = game.$dataSystem as { terms?: { params?: string[]; basic?: string[] } } | undefined
  for (const name of [...(system?.terms?.params || []), ...(system?.terms?.basic || [])]) values._name.add(name)
  return values
}

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
  const dynamic = createDynamicTemplateIndex()
  const stemBase = new Map<string, string>()
  const templateZh = new Map<string, string>()
  let entries: GlossaryEntry[] = []
  let allowedValues = dynamicValues()

  function rebuildGlossary() {
    allowedValues = dynamicValues()
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
          if (!shouldTranslate(jp)) continue
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
    invalidateWhitespaceLookup(lookup)
    dynamic.notePair(src, zh)
    indexTrailingStem(stemBase, src, zh)
    if (entries.length) indexGlossaryTemplate(templateZh, src, zh, entries, zhMapFrom(lookup))
  }

  /** Rebuild template index after full/incremental writes (glossary changes or first DB ready). */
  function reindexAll(lookup: Lookup) {
    invalidateWhitespaceLookup(lookup)
    rebuildGlossary()
    stemBase.clear()
    templateZh.clear()
    dynamic.clear()
    for (const [src, zh] of Object.entries(lookup)) {
      if (!src || zh == null) continue
      dynamic.notePair(src, zh)
      // Skip normalize duplicates: same translation as the original key; re-index is harmless
      indexTrailingStem(stemBase, src, zh)
      if (entries.length) indexGlossaryTemplate(templateZh, src, zh, entries, zhMapFrom(lookup))
    }
  }

  function resolve(lookup: Lookup, text: string): string | null {
    const exact = translatePlain(lookup, text)
    if (exact !== text) return exact
    if (dynamic.size) {
      const notification = dynamic.resolve(
        text,
        () => {
          // Database patching and actor renames can change captures after indexing.
          const current = dynamicValues()
          return Object.fromEntries(Object.entries(current).map(([key, values]) => [key, new Set([...values, ...(allowedValues[key] || [])])]))
        },
        (value) => translateWithLookup(lookup, value, { stemBase })
      )
      if (notification != null) return notification
    }
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
