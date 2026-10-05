import { countCommands, normalizeCommands } from './commands'
import type { EventCommand, EventRef } from './types'

type Translate = (text: string) => string

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null)
const num = (value: unknown) => Math.floor(Number(value) || 0)

/** One MapInfos entry; event names enable cross-map search without loading map details */
export type MapNode = {
  id: number
  name: string
  rawName: string
  parentId: number
  order: number
  /** null when the map file was not scanned */
  eventCount: number | null
  eventNames: string[]
}

/** A transfer (201) that lands on a map */
export type MapEntrance = { x: number; y: number; direction: number; from: EventRef }

export type MapIndex = {
  nodes: MapNode[]
  /** Target map id → transfers landing there */
  entrances: Record<number, MapEntrance[]>
}

export type SelfSwitchLetter = 'A' | 'B' | 'C' | 'D'
export const SELF_SWITCH_LETTERS: readonly SelfSwitchLetter[] = ['A', 'B', 'C', 'D']

export type PageConditions = {
  switch1?: number
  switch2?: number
  variable?: { id: number; value: number }
  selfSwitch?: SelfSwitchLetter
  item?: number
  actor?: number
}

/** 0 action button · 1 player touch · 2 event touch · 3 autorun · 4 parallel */
export type MapEventTrigger = 0 | 1 | 2 | 3 | 4

export type MapEventPage = {
  conditions: PageConditions
  trigger: MapEventTrigger
  list: EventCommand[]
  commandCount: number
  /** Character sheet name; empty for tile or invisible events */
  characterName: string
  tileId: number
}

export type MapEventType = 'npc' | 'transfer' | 'chest' | 'trigger' | 'other'

export type MapEventInfo = {
  id: number
  name: string
  rawName: string
  x: number
  y: number
  type: MapEventType
  pages: MapEventPage[]
}

/** Read from the running game; absent when the detail comes from disk */
export type MapLiveState = {
  /** Player is on this map, so `activePage` is exact */
  onThisMap: boolean
  /** Event id → active page (1-based, 0 = none); only when `onThisMap` */
  activePage: Record<number, number>
  /** Event id → self switches that are ON, e.g. "AC" */
  selfSwitches: Record<number, string>
}

export type MapDetailData = {
  ok: true
  source: 'disk' | 'live'
  mapId: number
  name: string
  displayName: string
  width: number
  height: number
  events: MapEventInfo[]
  /** Dialogue / choice source → translation for this map's events */
  texts: Record<string, string>
  live?: MapLiveState
}

export function normalizeConditions(raw: Record<string, unknown> | null): PageConditions {
  const c: PageConditions = {}
  if (!raw) return c
  if (raw.switch1Valid && num(raw.switch1Id) > 0) c.switch1 = num(raw.switch1Id)
  if (raw.switch2Valid && num(raw.switch2Id) > 0) c.switch2 = num(raw.switch2Id)
  if (raw.variableValid && num(raw.variableId) > 0) c.variable = { id: num(raw.variableId), value: num(raw.variableValue) }
  const ch = String(raw.selfSwitchCh ?? '')
  if (raw.selfSwitchValid && (SELF_SWITCH_LETTERS as readonly string[]).includes(ch)) c.selfSwitch = ch as SelfSwitchLetter
  if (raw.itemValid && num(raw.itemId) > 0) c.item = num(raw.itemId)
  if (raw.actorValid && num(raw.actorId) > 0) c.actor = num(raw.actorId)
  return c
}

const CHEST_IMAGE = /chest|treasure|宝箱|box/i

export function inferEventType(pages: readonly MapEventPage[]): MapEventType {
  const has = (codes: readonly number[]) => pages.some((p) => p.list.some((cmd) => codes.includes(cmd.code)))
  if (has([201])) return 'transfer'
  if (pages.some((p) => CHEST_IMAGE.test(p.characterName)) || (has([125, 126, 127, 128]) && has([123]) && pages.length <= 3)) return 'chest'
  if (has([101]) && pages.some((p) => p.characterName && !p.characterName.startsWith('!'))) return 'npc'
  if (pages.some((p) => p.trigger >= 3 || (p.trigger > 0 && !p.characterName && !p.tileId))) return 'trigger'
  return 'other'
}

export function normalizeMapEvents(rawMap: unknown, tr: Translate): MapEventInfo[] {
  const events = asRecord(rawMap)?.events
  if (!Array.isArray(events)) return []
  const out: MapEventInfo[] = []
  for (const ev of events) {
    const rec = asRecord(ev)
    if (!rec) continue
    const rawName = String(rec.name ?? '').trim()
    const pages: MapEventPage[] = (Array.isArray(rec.pages) ? rec.pages : []).map((page) => {
      const p = asRecord(page)
      const image = asRecord(p?.image)
      const list = normalizeCommands(p?.list)
      const trigger = num(p?.trigger)
      return {
        conditions: normalizeConditions(asRecord(p?.conditions)),
        trigger: (trigger >= 0 && trigger <= 4 ? trigger : 0) as MapEventTrigger,
        list,
        commandCount: countCommands(list),
        characterName: String(image?.characterName ?? ''),
        tileId: num(image?.tileId),
      }
    })
    out.push({ id: num(rec.id), name: rawName ? tr(rawName) : '', rawName, x: num(rec.x), y: num(rec.y), type: inferEventType(pages), pages })
  }
  return out.sort((a, b) => a.id - b.id)
}

export function buildMapIndex(
  mapInfos: unknown[] | null,
  maps: Array<{ id: number; data: unknown }> | null,
  mapNames: readonly string[],
  tr: Translate,
  entrances: Record<number, MapEntrance[]>
): MapIndex {
  const byId = new Map<number, unknown>()
  for (const map of maps ?? []) byId.set(map.id, map.data)
  const nodes: MapNode[] = []
  for (let id = 1; id < (mapInfos?.length ?? 0); id++) {
    const info = asRecord(mapInfos![id])
    if (!info) continue
    const rawName = String(info.name ?? '').trim()
    const data = byId.get(id)
    const events = Array.isArray(asRecord(data)?.events) ? (asRecord(data)!.events as unknown[]) : null
    const eventNames: string[] = []
    let eventCount = 0
    for (const ev of events ?? []) {
      const name = String(asRecord(ev)?.name ?? '').trim()
      if (!asRecord(ev)) continue
      eventCount++
      if (name) eventNames.push(tr(name))
    }
    nodes.push({
      id,
      name: mapNames[id] || rawName,
      rawName,
      parentId: num(info.parentId),
      order: num(info.order),
      eventCount: data === undefined ? null : events ? eventCount : 0,
      eventNames,
    })
  }
  return { nodes, entrances }
}

/** Transfers in a command list → `entrances[target]` */
export function collectEntrances(into: Record<number, MapEntrance[]>, list: readonly EventCommand[], from: EventRef) {
  for (const cmd of list) {
    if (cmd.code !== 201) continue
    const p = cmd.parameters
    if (num(p[0]) !== 0 || num(p[1]) <= 0) continue
    const target = num(p[1])
    const entry: MapEntrance = { x: num(p[2]), y: num(p[3]), direction: num(p[4]), from }
    const list2 = (into[target] ??= [])
    if (!list2.some((e) => e.x === entry.x && e.y === entry.y)) list2.push(entry)
  }
}

export type MapTreeRow = MapNode & { depth: number }

/** MapInfos `parentId` / `order` → depth-first rows; orphans are attached to the root */
export function flattenMapTree(nodes: readonly MapNode[]): MapTreeRow[] {
  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<number, MapNode[]>()
  for (const node of nodes) {
    const parent = ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : 0
    const list = children.get(parent) ?? []
    list.push(node)
    children.set(parent, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.id - b.id)
  const out: MapTreeRow[] = []
  const seen = new Set<number>()
  const walk = (parent: number, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      out.push({ ...node, depth })
      walk(node.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
}

export type PageContext = {
  switches: Readonly<Record<number, boolean>>
  variables: Readonly<Record<number, number>>
  /** Self switch letters ON for this event; undefined when unknown */
  selfOn?: string
  itemCount: (id: number) => number | undefined
}

/**
 * RPG Maker picks the last page whose conditions hold. Actor conditions and missing
 * self switch / item data cannot be checked here, so the result is marked inexact.
 */
export function estimateActivePage(pages: readonly MapEventPage[], ctx: PageContext): { page: number; exact: boolean } {
  let exact = true
  for (let i = pages.length - 1; i >= 0; i--) {
    const c = pages[i].conditions
    if (c.switch1 && !ctx.switches[c.switch1]) continue
    if (c.switch2 && !ctx.switches[c.switch2]) continue
    if (c.variable && (ctx.variables[c.variable.id] ?? 0) < c.variable.value) continue
    if (c.selfSwitch) {
      if (ctx.selfOn == null) exact = false
      else if (!ctx.selfOn.includes(c.selfSwitch)) continue
    }
    if (c.item) {
      const count = ctx.itemCount(c.item)
      if (count == null) exact = false
      else if (count <= 0) continue
    }
    if (c.actor) exact = false
    return { page: i + 1, exact }
  }
  return { page: 0, exact }
}
