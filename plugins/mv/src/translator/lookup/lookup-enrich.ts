/**
 * In-game lookup enrich: trailing-number index + glossary templates + proper-name table from $data*.
 */
import { createDynamicTemplateIndex, type DynamicValues } from '@/lib/translate/dynamic-template'
import { GLOSSARY_TOKEN, type GlossaryEntry, type GlossaryTokenType, indexGlossaryTemplate, translateByGlossaryTemplate } from '@/lib/translate/glossary-mask'
import { indexTrailingStem, invalidateWhitespaceLookup, normalizeTranslateKey, translatePlain, translateWithLookup } from '@/lib/translate/lookup'
import { shouldTranslate } from '@/services/translate/text-classify'

type Lookup = Record<string, string>

type RuntimeControlRefs = {
  actors: Set<number>
  party: Set<number>
  variables: Set<number>
  currency: boolean
}

const RUNTIME_CONTROL_RE = /(?:\\|\x1b)([NPV])\[(\d+)\]/gi
const RUNTIME_CURRENCY_RE = /(?:\\|\x1b)G/gi
const RUNTIME_EXPANDABLE_RE = /(?:\\|\x1b)(?:[NPV]\[\d+\]|G)/i

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

function runtimeActorName(id: number): string | null {
  try {
    const game = globalThis as unknown as Record<string, unknown>
    const actors = game.$gameActors as { actor?: (id: number) => unknown; _data?: Array<{ name?: (() => unknown) | string } | null>; [key: number]: unknown } | undefined
    const actor = typeof actors?.actor === 'function' ? actors.actor(id) : (actors?._data?.[id] ?? actors?.[id])
    const value =
      typeof (actor as { name?: unknown } | null | undefined)?.name === 'function'
        ? (actor as { name: () => unknown }).name()
        : (actor as { name?: unknown } | null | undefined)?.name
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

function runtimePartyMemberName(id: number): string | null {
  try {
    const game = globalThis as unknown as Record<string, unknown>
    const party = game.$gameParty as { members?: (() => unknown) | unknown } | undefined
    const members = typeof party?.members === 'function' ? party.members() : party?.members
    const member = Array.isArray(members) ? members[id - 1] : null
    const value =
      typeof (member as { name?: unknown } | null | undefined)?.name === 'function'
        ? (member as { name: () => unknown }).name()
        : (member as { name?: unknown } | null | undefined)?.name
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

function runtimeVariableValue(id: number): string | null {
  try {
    const game = globalThis as unknown as Record<string, unknown>
    const variables = game.$gameVariables as { value?: (id: number) => unknown; [key: number]: unknown } | undefined
    const value = typeof variables?.value === 'function' ? variables.value(id) : variables?.[id]
    return value == null ? null : String(value)
  } catch {
    return null
  }
}

function runtimeCurrencyUnit(): string | null {
  try {
    const game = globalThis as unknown as Record<string, unknown>
    const text = game.TextManager as { currencyUnit?: unknown } | undefined
    if (typeof text?.currencyUnit === 'string') return text.currencyUnit
    const system = game.$dataSystem as { currencyUnit?: unknown } | undefined
    return typeof system?.currencyUnit === 'string' ? system.currencyUnit : null
  } catch {
    return null
  }
}

function collectRuntimeControlRefs(text: string, refs: RuntimeControlRefs) {
  for (const match of text.matchAll(RUNTIME_CONTROL_RE)) {
    const code = match[1].toUpperCase()
    const id = Number(match[2])
    if (code === 'N') refs.actors.add(id)
    else if (code === 'P') refs.party.add(id)
    else refs.variables.add(id)
  }
  if (RUNTIME_CURRENCY_RE.test(text)) refs.currency = true
  RUNTIME_CURRENCY_RE.lastIndex = 0
}

function expandRuntimeControls(text: string, lookup?: Lookup): { text: string; complete: boolean; changed: boolean } {
  let complete = true
  let changed = false
  let result = text.replace(RUNTIME_CONTROL_RE, (match, code: string, idText: string) => {
    const id = Number(idText)
    const upper = code.toUpperCase()
    const value = upper === 'N' ? runtimeActorName(id) : upper === 'P' ? runtimePartyMemberName(id) : runtimeVariableValue(id)
    if (value == null) {
      complete = false
      return match
    }
    changed = true
    return translatedRuntimeValue(value, lookup)
  })
  result = result.replace(RUNTIME_CURRENCY_RE, (match) => {
    const value = runtimeCurrencyUnit()
    if (value == null) {
      complete = false
      return match
    }
    changed = true
    return translatedRuntimeValue(value, lookup)
  })
  return { text: result, complete, changed }
}

function translatedRuntimeValue(value: string, lookup?: Lookup): string {
  if (!lookup || !value) return value
  return translatePlain(lookup, value)
}

function runtimeSignature(refs: RuntimeControlRefs): string {
  const parts: string[] = []
  for (const id of [...refs.actors].sort((a, b) => a - b)) parts.push(`n${id}:${runtimeActorName(id) ?? '-'}`)
  for (const id of [...refs.party].sort((a, b) => a - b)) parts.push(`p${id}:${runtimePartyMemberName(id) ?? '-'}`)
  for (const id of [...refs.variables].sort((a, b) => a - b)) parts.push(`v${id}:${runtimeVariableValue(id) ?? '-'}`)
  if (refs.currency) parts.push(`g:${runtimeCurrencyUnit() ?? '-'}`)
  return parts.join('\x1f')
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

export function collectGameNameSources(): string[] {
  const names = new Set<string>()
  for (const bucket of FIELD_BUCKETS) {
    const table = bucket.tables()
    if (!table) continue
    for (const row of table) {
      if (!row) continue
      for (const field of bucket.fields) {
        const value = String(row[field] ?? '')
          .trim()
          .replace(/^#/, '')
        if (value) names.add(value)
      }
    }
  }
  const maps = (globalThis as unknown as { $dataMapInfos?: Array<{ name?: string } | null> }).$dataMapInfos
  for (const map of maps || []) if (map?.name?.trim()) names.add(map.name.trim())
  return [...names]
}

export function createLookupEnrichment() {
  const dynamic = createDynamicTemplateIndex()
  const stemBase = new Map<string, string>()
  const templateZh = new Map<string, string>()
  let entries: GlossaryEntry[] = []
  let allowedValues = dynamicValues()
  let runtimeRefs: RuntimeControlRefs = { actors: new Set(), party: new Set(), variables: new Set(), currency: false }
  let runtimeAliases = new Map<string, string>()
  let runtimeAliasesReady = false
  let runtimeAliasesSignature = ''

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
    collectRuntimeControlRefs(src, runtimeRefs)
    collectRuntimeControlRefs(zh, runtimeRefs)
    runtimeAliasesReady = false
  }

  /** Rebuild template index after full/incremental writes (glossary changes or first DB ready). */
  function reindexAll(lookup: Lookup) {
    invalidateWhitespaceLookup(lookup)
    rebuildGlossary()
    stemBase.clear()
    templateZh.clear()
    dynamic.clear()
    runtimeRefs = { actors: new Set(), party: new Set(), variables: new Set(), currency: false }
    for (const [src, zh] of Object.entries(lookup)) {
      if (!src || zh == null) continue
      collectRuntimeControlRefs(src, runtimeRefs)
      collectRuntimeControlRefs(zh, runtimeRefs)
      dynamic.notePair(src, zh)
      // Skip normalize duplicates: same translation as the original key; re-index is harmless
      indexTrailingStem(stemBase, src, zh)
      if (entries.length) indexGlossaryTemplate(templateZh, src, zh, entries, zhMapFrom(lookup))
    }
    runtimeAliasesReady = false
  }

  function refreshRuntimeAliases(lookup: Lookup) {
    const signature = runtimeSignature(runtimeRefs)
    if (runtimeAliasesReady && signature === runtimeAliasesSignature) return
    const aliases = new Map<string, string>()
    const conflicts = new Set<string>()
    for (const [src, zh] of Object.entries(lookup)) {
      if (!src || !zh || !RUNTIME_EXPANDABLE_RE.test(src)) continue
      const source = expandRuntimeControls(src)
      if (!source.complete || !source.changed) continue
      const target = expandRuntimeControls(zh, lookup)
      if (!target.complete) continue
      const key = normalizeTranslateKey(source.text)
      if (conflicts.has(key)) continue
      const previous = aliases.get(key)
      if (previous != null && previous !== target.text) {
        aliases.delete(key)
        conflicts.add(key)
      } else {
        aliases.set(key, target.text)
      }
    }
    runtimeAliases = aliases
    runtimeAliasesSignature = signature
    runtimeAliasesReady = true
  }

  function resolveRuntimeAlias(lookup: Lookup, text: string): string | null {
    if (!runtimeRefs.actors.size && !runtimeRefs.party.size && !runtimeRefs.variables.size && !runtimeRefs.currency) return null
    refreshRuntimeAliases(lookup)
    return runtimeAliases.get(normalizeTranslateKey(text)) ?? null
  }

  function resolve(lookup: Lookup, text: string): string | null {
    const exact = translatePlain(lookup, text)
    if (exact !== text) return exact
    const runtime = resolveRuntimeAlias(lookup, text)
    if (runtime != null) return runtime
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
    get runtimeAliasCount() {
      return runtimeAliases.size
    },
  }
}

export type LookupEnrichment = ReturnType<typeof createLookupEnrichment>
