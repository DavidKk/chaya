import { itemBagOf, itemKindOfBag, parseSelfSwitchKey } from './rules'
import type { DataPath, ExpectType, RefreshKind } from './types'

/** Names from the game database (already translated); missing → undefined */
export type NameSource = {
  switchName(id: number): string | undefined
  variableName(id: number): string | undefined
  actorName(id: number): string | undefined
  itemName(kind: 'item' | 'weapon' | 'armor', id: number): string | undefined
  mapName(id: number): string | undefined
  /** `mapId` null → the current map */
  eventName(mapId: number | null, eventId: number): string | undefined
}

export type Annotation = {
  label?: string
  labelKey?: string
  expectType?: ExpectType
  nullable?: boolean
  refresh?: RefreshKind
}

export const CONFIG_KEYS = ['alwaysDash', 'commandRemember', 'touchUI', 'bgmVolume', 'bgsVolume', 'meVolume', 'seVolume'] as const

const KNOWN_CONFIG = new Set<string>(CONFIG_KEYS)

const index = (key: string) => (/^[1-9]\d*$/.test(key) ? Number(key) : null)

/** Label, fixed type and post-write refresh for the child `key` of the container at `parent` */
export function annotate(parent: DataPath, key: string, value: unknown, names: NameSource): Annotation {
  const [root, a] = parent
  const depth = parent.length

  if (depth === 0) return { labelKey: `data.root.${key}` }

  if (root === 'config' && depth === 1) {
    return { labelKey: KNOWN_CONFIG.has(key) ? `data.config.${key}` : undefined, nullable: false, refresh: 'config' }
  }

  if ((root === 'switches' || root === 'variables') && a === '_data' && depth === 2) {
    const id = index(key)
    if (id == null) return {}
    return root === 'switches'
      ? { label: names.switchName(id), expectType: 'boolean', nullable: false, refresh: 'map' }
      : { label: names.variableName(id), expectType: 'number|string', nullable: false, refresh: 'map' }
  }

  if (root === 'selfSwitches' && a === '_data' && depth === 2) {
    const parsed = parseSelfSwitchKey(key)
    if (!parsed) return {}
    const map = names.mapName(parsed.mapId) || `#${parsed.mapId}`
    const ev = names.eventName(parsed.mapId, parsed.eventId) || `#${parsed.eventId}`
    return { label: `${map} · ${ev} · ${parsed.letter}`, expectType: 'boolean', nullable: false, refresh: 'map' }
  }

  if (root === 'actors' && a === '_data') {
    if (depth === 2) {
      const id = index(key)
      return id == null ? {} : { label: names.actorName(id) }
    }
    return { refresh: 'actor' }
  }

  if (root === 'party' && depth === 2) {
    const bag = itemBagOf(a)
    if (bag) {
      const id = index(key)
      return id == null ? {} : { label: names.itemName(itemKindOfBag(bag), id), expectType: 'number', nullable: false, refresh: 'map' }
    }
    if (a === '_actors') {
      const id = typeof value === 'number' ? value : null
      return { label: id ? names.actorName(id) : undefined, expectType: 'number', refresh: 'actor-party' }
    }
  }

  if (root === 'map' && a === '_events' && depth === 2) {
    const id = index(key)
    return id == null ? {} : { label: names.eventName(null, id) }
  }

  return {}
}

/** Label for each segment of a path (breadcrumb, search hits) */
export function pathLabels(path: DataPath, names: NameSource, valueAt?: (prefix: DataPath) => unknown): (string | null)[] {
  return path.map((key, i) => {
    const parent = path.slice(0, i)
    return annotate(parent, key, valueAt?.(path.slice(0, i + 1)), names).label ?? null
  })
}
