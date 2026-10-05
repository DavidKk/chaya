import type { CommonEventInfo, CommonEventsData, CommonEventTrigger, EventCommand, EventNames, EventRef } from './types'

/** 读盘或游戏内存里的原始 data/*.json；读不到的传 null */
export type RawEventSources = {
  commonEvents: unknown[] | null
  system: { switches?: unknown[]; variables?: unknown[] } | null
  items: unknown[] | null
  weapons: unknown[] | null
  armors: unknown[] | null
  actors: unknown[] | null
  troops: unknown[] | null
  mapInfos: unknown[] | null
  /** `data/MapXXX.json`；null 表示没有扫描地图 */
  maps: Array<{ id: number; data: unknown }> | null
  /** 读取或解析失败的地图数 */
  mapsFailed?: number
}

type Translate = (text: string) => string

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null)
const num = (value: unknown) => Math.floor(Number(value) || 0)

export function normalizeCommands(list: unknown): EventCommand[] {
  if (!Array.isArray(list)) return []
  const out: EventCommand[] = []
  for (const raw of list) {
    const rec = asRecord(raw)
    if (!rec) continue
    out.push({ code: num(rec.code), indent: num(rec.indent), parameters: Array.isArray(rec.parameters) ? rec.parameters : [] })
  }
  return out
}

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

/** 对话、滚动文字、选项、MZ 说话人：送去查译文 */
function collectTexts(list: readonly EventCommand[], into: Set<string>) {
  for (const cmd of list) {
    const p = cmd.parameters
    if ((cmd.code === 401 || cmd.code === 405) && typeof p[0] === 'string') into.add(p[0])
    else if (cmd.code === 101 && typeof p[4] === 'string' && p[4]) into.add(p[4])
    else if (cmd.code === 102 && Array.isArray(p[0])) {
      for (const choice of p[0]) if (typeof choice === 'string') into.add(choice)
    } else if (cmd.code === 402 && typeof p[1] === 'string') into.add(p[1])
  }
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

/** 同一位置对同一开关只记一次 */
function addSwitchRef(refs: Record<number, EventRef[]>, seen: Set<string>, switchId: number, ref: EventRef) {
  if (switchId <= 0) return
  const key = `${switchId}|${refKey(ref)}`
  if (seen.has(key)) return
  seen.add(key)
  ;(refs[switchId] ??= []).push(ref)
}

function addListSwitchRefs(refs: Record<number, EventRef[]>, seen: Set<string>, list: readonly EventCommand[], ref: EventRef) {
  for (const cmd of list) {
    const p = cmd.parameters
    if (cmd.code === 111 && num(p[0]) === 0) addSwitchRef(refs, seen, num(p[1]), ref)
    else if (cmd.code === 121) {
      const start = num(p[0])
      const end = Math.min(num(p[1]), start + MAX_RANGE_REFS - 1)
      for (let id = start; id <= end; id++) addSwitchRef(refs, seen, id, ref)
    }
  }
}

export function countCommands(list: readonly EventCommand[]): number {
  let n = 0
  for (const cmd of list) if (cmd.code !== 0) n++
  return n
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
  }

  const events: CommonEventInfo[] = []
  const textSources = new Set<string>()
  const calledBy: Record<number, EventRef[]> = {}
  const switchRefs: Record<number, EventRef[]> = {}
  const switchSeen = new Set<string>()
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
    if (info.trigger !== 0) addSwitchRef(switchRefs, switchSeen, info.switchId, ref)
    addListSwitchRefs(switchRefs, switchSeen, list, ref)
  }

  for (let id = 1; id < (raw.troops?.length ?? 0); id++) {
    pagesOf(raw.troops![id]).forEach(({ list }, index) => {
      const ref: EventRef = { kind: 'troop', id, name: names.troops[id] || '', page: index + 1 }
      addCalls(calledBy, list, ref)
      addListSwitchRefs(switchRefs, switchSeen, list, ref)
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
        if (conditions?.switch1Valid) addSwitchRef(switchRefs, switchSeen, num(conditions.switch1Id), ref)
        if (conditions?.switch2Valid) addSwitchRef(switchRefs, switchSeen, num(conditions.switch2Id), ref)
        addListSwitchRefs(switchRefs, switchSeen, list, ref)
      })
    }
  }

  const texts: Record<string, string> = {}
  for (const src of textSources) {
    const zh = tr(src)
    if (zh && zh !== src) texts[src] = zh
  }

  return { ok: true, source, events, names, texts, calledBy, switchRefs, mapsScanned: raw.maps != null, mapsFailed: raw.mapsFailed ?? 0 }
}
