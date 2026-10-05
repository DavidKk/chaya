/** Database names for data labels, translated like the rest of the overlay */
import type { NameSource } from '@/lib/game/save-data'

import { tName } from '../../console/item-label'
import { gameMap } from '../../runtime/game-globals'
import { loadedMapData } from '../live-events'

type Named = { name?: unknown } | null | undefined

const g = () =>
  globalThis as {
    $dataSystem?: { switches?: unknown[]; variables?: unknown[] }
    $dataActors?: Named[]
    $dataItems?: Named[]
    $dataWeapons?: Named[]
    $dataArmors?: Named[]
    $dataMapInfos?: Named[]
    $dataMap?: { events?: Named[] } | null
  }

const label = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return tName(raw) || raw
}

const nameAt = (list: Named[] | undefined, id: number) => label(list?.[id]?.name)

function eventsOf(mapId: number | null): Named[] | undefined {
  const current = Math.floor(Number(gameMap()?.mapId?.()) || 0)
  if (mapId == null || mapId === current) return g().$dataMap?.events
  return (loadedMapData(mapId) as { events?: Named[] } | null)?.events
}

export const liveNames: NameSource = {
  switchName: (id) => label(g().$dataSystem?.switches?.[id]),
  variableName: (id) => label(g().$dataSystem?.variables?.[id]),
  actorName: (id) => nameAt(g().$dataActors, id),
  itemName: (kind, id) => nameAt(kind === 'item' ? g().$dataItems : kind === 'weapon' ? g().$dataWeapons : g().$dataArmors, id),
  mapName: (id) => nameAt(g().$dataMapInfos, id),
  eventName: (mapId, id) => nameAt(eventsOf(mapId), id),
}
