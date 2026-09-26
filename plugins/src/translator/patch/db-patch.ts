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

export function patchRow(row: Record<string, unknown> | null | undefined, translate: Translate) {
  if (!row) return
  for (const field of DB_TEXT_FIELDS) {
    const cur = row[field]
    if (cur == null || cur === '') continue
    const zh = translate(String(cur))
    if (zh !== cur) row[field] = zh
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
      const arr = terms[bag]
      if (!arr) continue
      for (let i = 0; i < arr.length; i++) {
        if (arr[i]) arr[i] = translate(String(arr[i]))
      }
    }
    if (terms.messages) {
      for (const key of Object.keys(terms.messages)) {
        if (terms.messages[key]) terms.messages[key] = translate(String(terms.messages[key]))
      }
    }
  }
  for (const key of ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes', 'switches', 'variables']) {
    const arr = sys[key]
    if (!arr) continue
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]) arr[i] = translate(String(arr[i]))
    }
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
  if (!opts?.quiet) opts?.log?.ok('地图文本已套用翻译')
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
  if (!opts?.quiet) opts?.log?.ok('数据库文本已套用翻译')
}
