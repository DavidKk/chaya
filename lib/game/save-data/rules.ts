import type { DataPath, InsertMode } from './types'

const CONFIRM_PLAYER = new Set(['_x', '_y', '_realX', '_realY', '_newMapId', '_newX', '_newY', '_transferring'])
const CONFIRM_SYSTEM = new Set(['_saveCount', '_versionId', '_framesOnSave'])
const ITEM_BAGS = { _items: 'item', _weapons: 'weapon', _armors: 'armor' } as const

export type ItemBag = keyof typeof ITEM_BAGS
export type PresetLockKind = 'gold' | 'var' | 'sw' | 'hp' | 'mp' | 'level' | 'item' | 'weapon' | 'armor'
export type PresetLock = { kind: PresetLockKind; id: number }

const isIndex = (seg: string | undefined) => seg != null && /^[1-9]\d*$/.test(seg)

export function itemBagOf(seg: string | undefined): ItemBag | null {
  return seg === '_items' || seg === '_weapons' || seg === '_armors' ? seg : null
}

export function itemKindOfBag(bag: ItemBag): 'item' | 'weapon' | 'armor' {
  return ITEM_BAGS[bag]
}

/** Interpreter state anywhere, and map event identity fields */
export function isReadonlyPath(path: DataPath): boolean {
  if (path.includes('_interpreter')) return true
  return path.length === 4 && path[0] === 'map' && path[1] === '_events' && (path[3] === '_eventId' || path[3] === '_mapId')
}

/** Fields whose change needs an explicit confirmation (transfer state, save bookkeeping) */
export function needsConfirm(path: DataPath): boolean {
  if (path.length !== 2) return false
  if (path[0] === 'map') return path[1] === '_mapId'
  if (path[0] === 'player') return CONFIRM_PLAYER.has(path[1])
  if (path[0] === 'system') return CONFIRM_SYSTEM.has(path[1])
  return false
}

/** The GameEdit preset lock that already owns this field, if any */
export function presetLockFor(path: DataPath): PresetLock | null {
  const [root, a, b, c] = path
  if (root === 'party' && a === '_gold' && path.length === 2) return { kind: 'gold', id: 0 }
  if ((root === 'variables' || root === 'switches') && a === '_data' && path.length === 3 && isIndex(b)) return { kind: root === 'variables' ? 'var' : 'sw', id: Number(b) }
  if (root === 'actors' && a === '_data' && path.length === 4 && isIndex(b)) {
    if (c === '_hp') return { kind: 'hp', id: Number(b) }
    if (c === '_mp') return { kind: 'mp', id: Number(b) }
    if (c === '_level') return { kind: 'level', id: Number(b) }
  }
  const bag = itemBagOf(a)
  if (root === 'party' && bag && path.length === 3 && isIndex(b)) return { kind: itemKindOfBag(bag), id: Number(b) }
  return null
}

export function presetLockLabel(lock: PresetLock): string {
  return lock.kind === 'gold' ? 'gold' : `${lock.kind}:${lock.id}`
}

/** Fixed-length lists: switches / variables are listed up to the database count */
export function isFixedList(path: DataPath): boolean {
  return path.length === 2 && (path[0] === 'switches' || path[0] === 'variables') && path[1] === '_data'
}

/** Whether children of the container at `path` may be added / removed, and how */
export function insertModeFor(path: DataPath): InsertMode | null {
  if (path.length === 0 || path[0] === 'config' || isFixedList(path) || isReadonlyPath(path)) return null
  if (path.length === 2 && path[0] === 'party' && itemBagOf(path[1])) return 'item'
  if (path.length === 2 && path[0] === 'selfSwitches' && path[1] === '_data') return 'selfSwitch'
  return 'value'
}

/** `map,event,A-D` with positive ids */
export function parseSelfSwitchKey(key: string): { mapId: number; eventId: number; letter: 'A' | 'B' | 'C' | 'D' } | null {
  const m = /^([1-9]\d*),([1-9]\d*),([ABCD])$/.exec(key)
  return m ? { mapId: Number(m[1]), eventId: Number(m[2]), letter: m[3] as 'A' | 'B' | 'C' | 'D' } : null
}
