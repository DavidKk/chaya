import type { MapEventType } from '@/lib/game/events'
import type { MessageKey } from '@/lib/i18n'

export const TYPE_KEY: Record<MapEventType, MessageKey> = {
  npc: 'events.map.typeNpc',
  transfer: 'events.map.typeTransfer',
  chest: 'events.map.typeChest',
  trigger: 'events.map.typeTrigger',
  other: 'events.map.typeOther',
}

export type EventState = { kind: 'shown' | 'hidden' | 'unknown'; page: number; exact: boolean }
