import type { MapEventInfo, MapEventType } from '@/lib/game/events'
import type { MessageKey } from '@/lib/i18n'

export const TYPE_KEY: Record<MapEventType, MessageKey> = {
  npc: 'events.map.typeNpc',
  transfer: 'events.map.typeTransfer',
  chest: 'events.map.typeChest',
  trigger: 'events.map.typeTrigger',
  other: 'events.map.typeOther',
}

export type EventState = { kind: 'shown' | 'hidden' | 'unknown'; page: number; exact: boolean }

export function isNpcEvent(ev: MapEventInfo): boolean {
  if (ev.type === 'npc') return true
  if (ev.type === 'transfer' || ev.type === 'chest') return false
  if (ev.pages.some((p) => p.characterName && !p.characterName.startsWith('!'))) return true
  const name = (ev.name || ev.rawName || '').toLowerCase()
  return /npc|角色|人物|村民|守卫|商人|女仆|侍女|路人|居民|镇民|店主|老板|接待/i.test(name)
}
