import { collectTexts, countCommands, normalizeCommands, translatedTexts } from './commands'
import { buildMapIndex, collectEntrances, type MapDetailData, type MapEntrance, type MapLiveState, normalizeMapEvents } from './map-index'
import { collectTroopEncounters, normalizeEncounters, normalizeTroops } from './troops'
import type { CommonEventInfo, CommonEventsData, CommonEventTrigger, EventCommand, EventNames, EventRef } from './types'

export { countCommands, normalizeCommands } from './commands'

/** Raw data/*.json from disk or game memory; null when unavailable */
export type RawEventSources = {
  commonEvents: unknown[] | null
  system: { switches?: unknown[]; variables?: unknown[] } | null
  items: unknown[] | null
  weapons: unknown[] | null
  armors: unknown[] | null
  actors: unknown[] | null
  troops: unknown[] | null
  /** `Enemies.json`: names for troop members */
  enemies?: unknown[] | null
  mapInfos: unknown[] | null
  /** `data/MapXXX.json`; null means maps were not scanned */
  maps: Array<{ id: number; data: unknown }> | null
  /** Number of maps that failed to load or parse */
  mapsFailed?: number
}

type Translate = (text: string) => string

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null)
const num = (value: unknown) => Math.floor(Number(value) || 0)

function namesFromDb(rows: unknown[] | null, tr: Translate): string[] {
  const out: string[] = []
  if (!rows) return out
  for (let id = 1; id < rows.length; id++) {
    const raw = String(asRecord(rows[id])?.name ?? '').trim()
    out[id] = raw ? tr(raw) : ''
  }
  return out
}

function namesFromList(list: unknown[] | undefined, tr: Translate): string[] {
  const out: string[] = []
  if (!list) return out
  for (let id = 1; id < list.length; id++) {
    const raw = String(list[id] ?? '').trim()
    out[id] = raw ? tr(raw) : ''
  }
  return out
}

function addCalls(calledBy: Record<number, EventRef[]>, list: readonly EventCommand[], ref: EventRef) {
  const seen = new Set<number>()
  for (const cmd of list) {
    if (cmd.code !== 117) continue
    const target = num(cmd.parameters[0])
    if (target <= 0 || seen.has(target)) continue
    seen.add(target)
    ;(calledBy[target] ??= []).push(ref)
  }
}

const MAX_RANGE_REFS = 200

function refKey(ref: EventRef) {
  return `${ref.kind}:${ref.id}:${ref.eventId ?? ''}:${ref.page ?? ''}`
}

/** Switch / variable id → locations; each id recorded at most once per location */
class RefTable {
  readonly refs: Record<number, EventRef[]> = {}
  private seen = new Set<string>()

  add(id: number, ref: EventRef) {
    if (id <= 0) return
    const key = `${id}|${refKey(ref)}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    ;(this.refs[id] ??= []).push(ref)
  }

  addRange(start: unknown, end: unknown, ref: EventRef) {
    const from = num(start)
    const to = Math.min(num(end), from + MAX_RANGE_REFS - 1)
    for (let id = from; id <= to; id++) this.add(id, ref)
  }
}

function addListRefs(switches: RefTable, variables: RefTable, troops: RefTable, list: readonly EventCommand[], ref: EventRef) {
  for (const cmd of list) {
    const p = cmd.parameters
    if (cmd.code === 301 && num(p[0]) === 0) troops.add(num(p[1]), ref)
    else if (cmd.code === 111 && num(p[0]) === 0) switches.add(num(p[1]), ref)
    else if (cmd.code === 111 && num(p[0]) === 1) {
      variables.add(num(p[1]), ref)
      if (num(p[2]) === 1) variables.add(num(p[3]), ref)
    } else if (cmd.code === 121) switches.addRange(p[0], p[1], ref)
    else if (cmd.code === 122) {
      variables.addRange(p[0], p[1], ref)
      if (num(p[3]) === 1) variables.add(num(p[4]), ref)
    }
  }
}

type RawPage = { list: EventCommand[]; conditions: Record<string, unknown> | null }

function pagesOf(owner: unknown): RawPage[] {
  const pages = asRecord(owner)?.pages
  return Array.isArray(pages) ? pages.map((page) => ({ list: normalizeCommands(asRecord(page)?.list), conditions: asRecord(asRecord(page)?.conditions) })) : []
}

export function buildCommonEventsData(raw: RawEventSources, tr: Translate, source: CommonEventsData['source']): CommonEventsData {
  const names: EventNames = {
    switches: namesFromList(raw.system?.switches, tr),
    variables: namesFromList(raw.system?.variables, tr),
    items: namesFromDb(raw.items, tr),
    weapons: namesFromDb(raw.weapons, tr),
    armors: namesFromDb(raw.armors, tr),
    actors: namesFromDb(raw.actors, tr),
    maps: namesFromDb(raw.mapInfos, tr),
    commonEvents: namesFromDb(raw.commonEvents, tr),
    troops: namesFromDb(raw.troops, tr),
    enemies: namesFromDb(raw.enemies ?? null, tr),
  }

  const events: CommonEventInfo[] = []
  const textSources = new Set<string>()
  const calledBy: Record<number, EventRef[]> = {}
  const switches = new RefTable()
  const variables = new RefTable()
  const troopRefs = new RefTable()
  const entrances: Record<number, MapEntrance[]> = {}
  for (let id = 1; id < (raw.commonEvents?.length ?? 0); id++) {
    const rec = asRecord(raw.commonEvents![id])
    if (!rec) continue
    const rawName = String(rec.name ?? '').trim()
    const trigger = num(rec.trigger)
    const list = normalizeCommands(rec.list)
    const info: CommonEventInfo = {
      id,
      name: names.commonEvents[id] || rawName,
      rawName,
      trigger: (trigger === 1 || trigger === 2 ? trigger : 0) as CommonEventTrigger,
      switchId: num(rec.switchId),
      list,
      commandCount: countCommands(list),
    }
    events.push(info)
    collectTexts(list, textSources)
    const ref: EventRef = { kind: 'common', id, name: names.commonEvents[id] || '' }
    addCalls(calledBy, list, ref)
    if (info.trigger !== 0) switches.add(info.switchId, ref)
    addListRefs(switches, variables, troopRefs, list, ref)
    collectEntrances(entrances, list, ref)
  }

  const troops = normalizeTroops(raw.troops, raw.enemies, names)
  for (const troop of troops) {
    troop.pages.forEach((list, index) => {
      const ref: EventRef = { kind: 'troop', id: troop.id, name: names.troops[troop.id] || '', page: index + 1 }
      addCalls(calledBy, list, ref)
      addListRefs(switches, variables, troopRefs, list, ref)
      collectTexts(list, textSources)
    })
  }

  for (const map of raw.maps ?? []) {
    const mapEvents = asRecord(map.data)?.events
    if (!Array.isArray(mapEvents)) continue
    for (const ev of mapEvents) {
      const rec = asRecord(ev)
      if (!rec) continue
      const eventName = String(rec.name ?? '').trim()
      const translated = eventName ? tr(eventName) : ''
      pagesOf(rec).forEach(({ list, conditions }, index) => {
        const ref: EventRef = { kind: 'map', id: map.id, name: names.maps[map.id] || '', eventId: num(rec.id), eventName: translated, page: index + 1 }
        addCalls(calledBy, list, ref)
        if (conditions?.switch1Valid) switches.add(num(conditions.switch1Id), ref)
        if (conditions?.switch2Valid) switches.add(num(conditions.switch2Id), ref)
        if (conditions?.variableValid) variables.add(num(conditions.variableId), ref)
        addListRefs(switches, variables, troopRefs, list, ref)
        collectEntrances(entrances, list, ref)
      })
    }
  }

  return {
    ok: true,
    source,
    events,
    names,
    texts: translatedTexts(textSources, tr),
    calledBy,
    switchRefs: switches.refs,
    variableRefs: variables.refs,
    mapIndex: buildMapIndex(raw.mapInfos, raw.maps, names.maps, tr, entrances),
    troops,
    troopEncounters: collectTroopEncounters(raw.maps),
    troopRefs: troopRefs.refs,
    mapsScanned: raw.maps != null,
    mapsFailed: raw.mapsFailed ?? 0,
  }
}

/** One `MapXXX.json` → events with pages and command lists (loaded on demand) */
export function buildMapDetail(mapId: number, rawMap: unknown, mapInfos: unknown[] | null, tr: Translate, source: MapDetailData['source'], live?: MapLiveState): MapDetailData {
  const rec = asRecord(rawMap)
  const rawName = String(asRecord(mapInfos?.[mapId])?.name ?? '').trim()
  const displayName = String(rec?.displayName ?? '').trim()
  const events = normalizeMapEvents(rawMap, tr)
  const textSources = new Set<string>()
  for (const ev of events) for (const page of ev.pages) collectTexts(page.list, textSources)
  return {
    ok: true,
    source,
    mapId,
    name: rawName ? tr(rawName) : '',
    displayName: displayName ? tr(displayName) : '',
    width: num(rec?.width),
    height: num(rec?.height),
    events,
    texts: translatedTexts(textSources, tr),
    ...normalizeEncounters(rawMap),
    ...(live ? { live } : {}),
  }
}
