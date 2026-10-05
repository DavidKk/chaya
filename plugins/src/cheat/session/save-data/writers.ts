/**
 * Low-level writes. Known structures go through the engine (switches, variables, self switches, item counts,
 * config); everything else is a plain assignment followed by a refresh the caller batches.
 */
import { annotate, type DataPath, itemBagOf, itemKindOfBag, parseSelfSwitchKey, type PrimitiveValue } from '@/lib/game/save-data'

import { liveNames } from './names'

type Rec = Record<string, unknown>
const g = globalThis as Rec

const isIndex = (key: string) => /^[1-9]\d*$/.test(key)

function dbOf(kind: 'item' | 'weapon' | 'armor'): unknown[] | undefined {
  const list = g[kind === 'item' ? '$dataItems' : kind === 'weapon' ? '$dataWeapons' : '$dataArmors']
  return Array.isArray(list) ? list : undefined
}

/** Engine-routed write; returns false when the path is not a known structure */
function writeKnown(path: DataPath, value: PrimitiveValue | undefined): boolean {
  const [root, a, key] = path
  if (path.length !== 3) return false
  if ((root === 'switches' || root === 'variables') && a === '_data' && isIndex(key) && value !== undefined) {
    const store = g[root === 'switches' ? '$gameSwitches' : '$gameVariables'] as { setValue?: (id: number, v: unknown) => void } | undefined
    if (typeof store?.setValue !== 'function') return false
    store.setValue(Number(key), root === 'switches' ? !!value : value)
    return true
  }
  if (root === 'selfSwitches' && a === '_data' && typeof value === 'boolean') {
    const parsed = parseSelfSwitchKey(key)
    const store = g.$gameSelfSwitches as { setValue?: (k: unknown[], v: boolean) => void } | undefined
    if (!parsed || typeof store?.setValue !== 'function') return false
    store.setValue([parsed.mapId, parsed.eventId, parsed.letter], value)
    return true
  }
  const bag = root === 'party' ? itemBagOf(a) : null
  if (bag && isIndex(key) && (typeof value === 'number' || value === undefined)) {
    const item = dbOf(itemKindOfBag(bag))?.[Number(key)]
    const party = g.$gameParty as { gainItem?: (item: unknown, n: number) => void; numItems?: (item: unknown) => number } | undefined
    if (!item || typeof party?.gainItem !== 'function' || typeof party.numItems !== 'function') return false
    party.gainItem(item, Math.floor(value ?? 0) - party.numItems(item))
    return true
  }
  return false
}

export type WriteOutcome = { refresh: string | null }

/**
 * Set `owner[key]`; `remove` deletes the key (undo of a field that did not exist).
 * Returns the refresh key to run once per batch (see `runRefreshes`).
 */
export function writeValue(path: DataPath, owner: object, key: string, value: PrimitiveValue | undefined, remove = false): WriteOutcome {
  const parentPath = path.slice(0, -1)
  if (parentPath.length === 1 && parentPath[0] === 'config') {
    ;(owner as Rec)[key] = value
    return { refresh: 'config' }
  }
  if (!remove && writeKnown(path, value)) return { refresh: null }
  const rec = owner as Rec
  if (remove) {
    if (Array.isArray(owner) && Number(key) === owner.length - 1) owner.length -= 1
    else delete rec[key]
  } else rec[key] = value
  return { refresh: refreshKeyFor(path, value) }
}

export function refreshKeyFor(path: DataPath, value?: unknown): string | null {
  const parentPath = path.slice(0, -1)
  const kind = annotate(parentPath, path[path.length - 1], value, liveNames).refresh
  if (kind === 'actor') return `actor:${path[2]}`
  if (kind === 'map' && (path[0] === 'switches' || path[0] === 'variables')) return 'switch-change'
  return kind ?? null
}

/** Run each refresh once */
export function runRefreshes(keys: Iterable<string | null>) {
  const done = new Set<string>()
  for (const key of keys) {
    if (!key || done.has(key)) continue
    done.add(key)
    try {
      runRefresh(key)
    } catch {
      /* best effort; the value is already written */
    }
  }
}

function runRefresh(key: string) {
  const map = g.$gameMap as { requestRefresh?: () => void } | undefined
  if (key === 'map') return map?.requestRefresh?.()
  if (key === 'switch-change') {
    ;(g.$gameSwitches as { onChange?: () => void } | undefined)?.onChange?.()
    return
  }
  if (key === 'config') return (g.ConfigManager as { save?: () => void } | undefined)?.save?.()
  if (key === 'actor-party') {
    ;(g.$gamePlayer as { refresh?: () => void } | undefined)?.refresh?.()
    return map?.requestRefresh?.()
  }
  if (key.startsWith('actor:')) {
    const actors = (g.$gameActors as { _data?: unknown[] } | undefined)?._data
    const actor = actors?.[Number(key.slice(6))] as { refresh?: () => void } | undefined
    actor?.refresh?.()
    return map?.requestRefresh?.()
  }
}
