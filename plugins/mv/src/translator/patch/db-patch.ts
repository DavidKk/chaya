/**
 * Write translations back into RM DB / event commands (shared by boot full apply and HMR chunks).
 */

export type Cmd = { code?: number; parameters?: unknown[] }
export type Translate = (text: string) => string
type Log = { ok: (message: string, meta?: unknown) => void }

export const DB_TEXT_FIELDS = ['name', 'nickname', 'description', 'message1', 'message2', 'message3', 'message4', 'profile'] as const

function g(name: string): any {
  return typeof globalThis !== 'undefined' ? (globalThis as any)[name] : undefined
}

export function patchCommand(cmd: Cmd | null | undefined, translate: Translate, preserveDialogue = false) {
  if (!cmd || !cmd.parameters) return
  const p = cmd.parameters
  const code = cmd.code
  if (((code === 401 && !preserveDialogue) || code === 405) && p[0] != null && p[0] !== '') {
    p[0] = translate(String(p[0]))
  }
  if (code === 102 && !preserveDialogue && Array.isArray(p[0])) {
    p[0] = (p[0] as unknown[]).map((c) => (c == null || c === '' ? c : translate(String(c))))
  }
  if ((code === 320 || code === 324 || code === 325) && p[1]) {
    p[1] = translate(String(p[1]))
  }
}

const ORIGINAL_ROW_DATA = Symbol.for('chaya.originalRowData')

export function patchRow(row: Record<string, unknown> | null | undefined, translate: Translate) {
  if (!row) return
  const anyRow = row as any
  let origData: Record<string, string> | undefined = anyRow[ORIGINAL_ROW_DATA]
  if (!origData) {
    origData = {}
    for (const field of DB_TEXT_FIELDS) {
      if (row[field] != null && row[field] !== '') {
        origData[field] = String(row[field])
      }
    }
    try {
      Object.defineProperty(anyRow, ORIGINAL_ROW_DATA, {
        value: origData,
        writable: false,
        enumerable: false,
        configurable: true,
      })
      if (row.name != null && row.name !== '' && !anyRow._originalName) {
        Object.defineProperty(anyRow, '_originalName', {
          value: String(row.name),
          writable: true,
          enumerable: false,
          configurable: true,
        })
      }
    } catch {
      anyRow[ORIGINAL_ROW_DATA] = origData
      if (row.name != null && row.name !== '' && !anyRow._originalName) {
        anyRow._originalName = String(row.name)
      }
    }
  }

  for (const field of DB_TEXT_FIELDS) {
    const raw = origData[field] ?? row[field]
    if (raw == null || raw === '') continue
    const zh = translate(String(raw))
    if (zh !== row[field]) row[field] = zh
  }
}

const ORIGINAL_VALUES = Symbol.for('chaya.originalValues')

export function patchLookupArray(arr: unknown[] | null | undefined, translate: Translate) {
  if (!Array.isArray(arr)) return
  const anyArr = arr as any
  const originals: (string | undefined)[] = anyArr[ORIGINAL_VALUES] || arr.map((item) => (item != null ? String(item) : undefined))
  if (!anyArr[ORIGINAL_VALUES]) {
    try {
      Object.defineProperty(anyArr, ORIGINAL_VALUES, {
        value: originals,
        writable: false,
        enumerable: false,
        configurable: true,
      })
    } catch {
      anyArr[ORIGINAL_VALUES] = originals
    }
  }

  for (let i = 0; i < arr.length; i++) {
    const raw = originals[i]
    if (raw) {
      const zh = translate(raw)
      if (zh && zh !== arr[i]) arr[i] = zh
    }
  }

  // Define non-enumerable property aliases for direct named access (e.g. arr['メインアクション'])
  for (let i = 0; i < originals.length; i++) {
    const raw = originals[i]
    if (raw && !(raw in anyArr)) {
      try {
        Object.defineProperty(anyArr, raw, {
          get: () => anyArr[i],
          enumerable: false,
          configurable: true,
        })
      } catch {}
    }
  }

  // Safety property for negative index (e.g. arr[-1] when plugin calculations like indexOf(...) || 1 evaluate to -1)
  try {
    Object.defineProperty(anyArr, '-1', {
      get: () => anyArr[1] || anyArr[0] || '',
      enumerable: false,
      configurable: true,
    })
  } catch {}

  if (!anyArr.__chaya_lookup_hooked) {
    try {
      Object.defineProperty(anyArr, '__chaya_lookup_hooked', {
        value: true,
        writable: true,
        enumerable: false,
        configurable: true,
      })
    } catch {
      anyArr.__chaya_lookup_hooked = true
    }
    const origIndexOf = Array.prototype.indexOf
    const origIncludes = Array.prototype.includes
    const origFindIndex = Array.prototype.findIndex
    const origFind = Array.prototype.find

    const customIndexOf = function (this: any[], searchElement: any, fromIndex?: number): number {
      const idx = origIndexOf.call(this, searchElement, fromIndex)
      if (idx !== -1) return idx
      if (typeof searchElement === 'string') {
        const origIdx = originals.indexOf(searchElement, fromIndex)
        if (origIdx !== -1) return origIdx
        const trimmed = searchElement.trim()
        if (trimmed && trimmed !== searchElement) {
          const trimmedIdx = origIndexOf.call(this, trimmed, fromIndex)
          if (trimmedIdx !== -1) return trimmedIdx
          const trimmedOrigIdx = originals.indexOf(trimmed, fromIndex)
          if (trimmedOrigIdx !== -1) return trimmedOrigIdx
        }
        const translated = translate(searchElement)
        if (translated && translated !== searchElement) {
          const transIdx = origIndexOf.call(this, translated, fromIndex)
          if (transIdx !== -1) return transIdx
        }
        for (let i = 0; i < originals.length; i++) {
          const orig = originals[i]
          if (orig && translate(orig) === searchElement) return i
        }
      }
      return -1
    }

    const customIncludes = function (this: any[], searchElement: any, fromIndex?: number): boolean {
      if (origIncludes.call(this, searchElement, fromIndex)) return true
      return customIndexOf.call(this, searchElement, fromIndex) !== -1
    }

    const customFindIndex = function (this: any[], predicate: (value: any, index: number, obj: any[]) => boolean, thisArg?: any): number {
      const idx = origFindIndex.call(this, predicate, thisArg)
      if (idx !== -1) return idx
      return origFindIndex.call(originals, predicate, thisArg)
    }

    const customFind = function (this: any[], predicate: (value: any, index: number, obj: any[]) => boolean, thisArg?: any): any {
      const val = origFind.call(this, predicate, thisArg)
      if (val !== undefined) return val
      const origIdx = origFindIndex.call(originals, predicate, thisArg)
      if (origIdx !== -1) return this[origIdx]
      return undefined
    }

    try {
      Object.defineProperty(anyArr, 'indexOf', {
        value: customIndexOf,
        writable: true,
        enumerable: false,
        configurable: true,
      })
      Object.defineProperty(anyArr, 'includes', {
        value: customIncludes,
        writable: true,
        enumerable: false,
        configurable: true,
      })
      Object.defineProperty(anyArr, 'findIndex', {
        value: customFindIndex,
        writable: true,
        enumerable: false,
        configurable: true,
      })
      Object.defineProperty(anyArr, 'find', {
        value: customFind,
        writable: true,
        enumerable: false,
        configurable: true,
      })
    } catch {
      anyArr.indexOf = customIndexOf
      anyArr.includes = customIncludes
      anyArr.findIndex = customFindIndex
      anyArr.find = customFind
    }
  }
}

export function patchSystem(translate: Translate) {
  const sys = g('$dataSystem')
  if (!sys) return
  if (sys.gameTitle) sys.gameTitle = translate(String(sys.gameTitle))
  if (sys.currencyUnit) sys.currencyUnit = translate(String(sys.currencyUnit))
  const terms = sys.terms
  if (terms) {
    for (const bag of ['basic', 'commands', 'params'] as const) {
      patchLookupArray(terms[bag], translate)
    }
    if (terms.messages) {
      for (const key of Object.keys(terms.messages)) {
        if (terms.messages[key]) terms.messages[key] = translate(String(terms.messages[key]))
      }
    }
  }
  // Switch/variable names are script identifiers, even when their strings were collected as candidates.
  for (const key of ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes']) {
    patchLookupArray(sys[key], translate)
  }
}

/** Tables for chunked apply phase0 (troops / common events handled in later phases) */
export function dbTables(): any[] {
  return [
    g('$dataActors'),
    g('$dataClasses'),
    g('$dataSkills'),
    g('$dataItems'),
    g('$dataWeapons'),
    g('$dataArmors'),
    g('$dataEnemies'),
    g('$dataStates'),
    g('$dataAnimations'),
    g('$dataTilesets'),
  ]
}

export function patchEventList(list: unknown, translate: Translate, preserveDialogue = false) {
  if (!Array.isArray(list)) return
  for (const cmd of list as Array<Cmd | null>) {
    patchCommand(cmd, translate, preserveDialogue)
  }
}

export function patchMapTexts(translate: Translate, opts?: { quiet?: boolean; log?: Log; preserveDialogue?: boolean }) {
  const map = g('$dataMap')
  if (!map) return
  if (map.displayName) map.displayName = translate(String(map.displayName))
  if (Array.isArray(map.events)) {
    for (const ev of map.events) {
      if (!ev) continue
      if (ev.name) ev.name = translate(String(ev.name))
      if (!Array.isArray(ev.pages)) continue
      for (const page of ev.pages) {
        if (page && page.list) patchEventList(page.list, translate, opts?.preserveDialogue)
      }
    }
  }
  if (!opts?.quiet) opts?.log?.ok('Map translations applied')
}

export function patchDatabaseTexts(translate: Translate, opts?: { quiet?: boolean; log?: Log; preserveDialogue?: boolean }) {
  // Troops handled below (name + battle pages); keep out of this list to avoid double-translating name.
  const tables = [
    g('$dataActors'),
    g('$dataClasses'),
    g('$dataSkills'),
    g('$dataItems'),
    g('$dataWeapons'),
    g('$dataArmors'),
    g('$dataEnemies'),
    g('$dataStates'),
    g('$dataAnimations'),
    g('$dataTilesets'),
  ]
  for (const table of tables) {
    if (!table) continue
    for (const row of table) {
      if (!row) continue
      patchRow(row, translate)
    }
  }
  const common = g('$dataCommonEvents')
  if (common) {
    for (const ce of common) {
      if (!ce) continue
      if (ce.name) ce.name = translate(String(ce.name))
      if (ce.list) patchEventList(ce.list, translate, opts?.preserveDialogue)
    }
  }
  const troops = g('$dataTroops')
  if (troops) {
    for (const troop of troops) {
      if (!troop) continue
      if (troop.name) troop.name = translate(String(troop.name))
      if (!Array.isArray(troop.pages)) continue
      for (const page of troop.pages) {
        if (page && page.list) patchEventList(page.list, translate, opts?.preserveDialogue)
      }
    }
  }
  patchSystem(translate)
  if (!opts?.quiet) opts?.log?.ok('Database translations applied')
}
