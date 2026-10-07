/** RPG Maker MV / MZ event data shared by the disk reader, the web console and the game plugin. */

import type { MapIndex } from './map-index'
import type { TroopEncounter, TroopInfo } from './troops'

export type EventCommand = { code: number; indent: number; parameters: unknown[] }

/** 0 none (call only) · 1 autorun · 2 parallel */
export type CommonEventTrigger = 0 | 1 | 2

export type CommonEventInfo = {
  id: number
  /** Translated name (original when untranslated) */
  name: string
  rawName: string
  trigger: CommonEventTrigger
  /** Trigger switch for autorun / parallel */
  switchId: number
  list: EventCommand[]
  /** Command count, excluding empty end / branch-end commands (code 0) */
  commandCount: number
}

export type EventRefKind = 'common' | 'map' | 'troop'

/** A location that calls a common event */
export type EventRef = {
  kind: EventRefKind
  /** Common event / map / troop id */
  id: number
  name: string
  /** Map event id and name */
  eventId?: number
  eventName?: string
  /** Event page (1-based) */
  page?: number
}

/** Indexed by id; empty string when unnamed */
export type EventNames = {
  switches: string[]
  variables: string[]
  items: string[]
  weapons: string[]
  armors: string[]
  actors: string[]
  maps: string[]
  commonEvents: string[]
  troops: string[]
  enemies: string[]
}

export type CommonEventsData = {
  ok: true
  source: 'disk' | 'live'
  events: CommonEventInfo[]
  names: EventNames
  /** Dialogue / choice source text → translation (translated entries only) */
  texts: Record<string, string>
  /** Common event id → locations that call it */
  calledBy: Record<number, EventRef[]>
  /** Switch id → locations that use it (map event page conditions, common event triggers, conditional branches, switch operations) */
  switchRefs: Record<number, EventRef[]>
  /** Variable id → locations that use it (map event page conditions, conditional branches, variable operations) */
  variableRefs: Record<number, EventRef[]>
  /** Map tree, per-map event names and transfer destinations; no command lists */
  mapIndex: MapIndex
  troops: TroopInfo[]
  /** Troop id → maps whose encounter list includes it */
  troopEncounters: Record<number, TroopEncounter[]>
  /** Troop id → locations whose Battle Processing (301) names it directly */
  troopRefs: Record<number, EventRef[]>
  /** Whether map data was provided (otherwise only common event and troop references) */
  mapsScanned: boolean
  /** Maps that failed to load or parse; references may be incomplete when > 0 */
  mapsFailed: number
}
