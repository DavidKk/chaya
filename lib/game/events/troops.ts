import { countCommands, normalizeCommands } from './commands'
import type { EventCommand } from './types'

export type TroopMember = { enemyId: number; name: string; rawName: string; hidden: boolean }

export type TroopInfo = {
  id: number
  /** Translated name (original when untranslated) */
  name: string
  rawName: string
  /** Members whose enemy exists in the database */
  members: TroopMember[]
  /** Battle event pages */
  pages: EventCommand[][]
  /** Commands across all pages, excluding code 0 */
  commandCount: number
}

/** A map whose encounter list includes the troop */
export type TroopEncounter = { mapId: number; weight: number; regionSet: number[] }

/** One `encounterList` entry of a map */
export type MapEncounter = { troopId: number; weight: number; regionSet: number[] }

/** Members with the same enemy name merged, in first-seen order */
export type TroopMemberGroup = { enemyId: number; name: string; count: number; hidden: boolean }

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null)
const num = (value: unknown) => Math.floor(Number(value) || 0)

function enemyExists(enemies: unknown[] | null | undefined, id: number) {
  return id > 0 && (!enemies || !!asRecord(enemies[id]))
}

/** `Troops.json` → troops; members referencing missing enemies are dropped (all kept when enemies are unknown) */
export function normalizeTroops(raw: unknown[] | null | undefined, enemies: unknown[] | null | undefined, names: { troops: string[]; enemies: string[] }): TroopInfo[] {
  const out: TroopInfo[] = []
  for (let id = 1; id < (raw?.length ?? 0); id++) {
    const rec = asRecord(raw![id])
    if (!rec) continue
    const members: TroopMember[] = []
    for (const m of Array.isArray(rec.members) ? rec.members : []) {
      const member = asRecord(m)
      const enemyId = num(member?.enemyId)
      if (!enemyExists(enemies, enemyId)) continue
      const rawName = String(asRecord(enemies?.[enemyId])?.name ?? '').trim()
      members.push({ enemyId, name: names.enemies[enemyId] || rawName, rawName, hidden: !!member?.hidden })
    }
    const pages = (Array.isArray(rec.pages) ? rec.pages : []).map((page) => normalizeCommands(asRecord(page)?.list))
    const rawName = String(rec.name ?? '').trim()
    out.push({ id, name: names.troops[id] || rawName, rawName, members, pages, commandCount: pages.reduce((n, list) => n + countCommands(list), 0) })
  }
  return out
}

/** Matches the id, troop name or any member name (translated or original), case-insensitive */
export function matchesTroop(troop: TroopInfo, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (String(troop.id) === q) return true
  const texts = [troop.name, troop.rawName, ...troop.members.flatMap((m) => [m.name, m.rawName])]
  return texts.some((text) => text.toLowerCase().includes(q))
}

export function groupTroopMembers(members: readonly TroopMember[]): TroopMemberGroup[] {
  const groups: TroopMemberGroup[] = []
  for (const m of members) {
    const key = m.name || `#${m.enemyId}`
    const hit = groups.find((g) => (g.name || `#${g.enemyId}`) === key)
    if (hit) {
      hit.count++
      hit.hidden = hit.hidden && m.hidden
    } else groups.push({ enemyId: m.enemyId, name: m.name, count: 1, hidden: m.hidden })
  }
  return groups
}

function regionSetOf(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.map(num).filter((r) => r > 0))].sort((a, b) => a - b) : []
}

/** `MapXXX.json` → encounter list (entries without a troop dropped) and steps */
export function normalizeEncounters(rawMap: unknown): { encounters: MapEncounter[]; encounterStep: number } {
  const rec = asRecord(rawMap)
  const encounters: MapEncounter[] = []
  for (const e of Array.isArray(rec?.encounterList) ? rec.encounterList : []) {
    const entry = asRecord(e)
    const troopId = num(entry?.troopId)
    if (troopId <= 0) continue
    encounters.push({ troopId, weight: Math.max(0, num(entry?.weight)), regionSet: regionSetOf(entry?.regionSet) })
  }
  return { encounters, encounterStep: Math.max(0, num(rec?.encounterStep)) }
}

/**
 * Chance of each entry when the player stands outside every listed region: RPG Maker draws by weight among
 * entries with no region set plus those whose set contains the current region. Region-limited entries get null.
 */
export function encounterShares(encounters: readonly MapEncounter[]): Array<number | null> {
  const total = encounters.reduce((sum, e) => (e.regionSet.length ? sum : sum + e.weight), 0)
  return encounters.map((e) => (e.regionSet.length || total <= 0 ? null : e.weight / total))
}

/** Map encounter lists → troop id → maps */
export function collectTroopEncounters(maps: ReadonlyArray<{ id: number; data: unknown }> | null | undefined): Record<number, TroopEncounter[]> {
  const out: Record<number, TroopEncounter[]> = {}
  for (const map of maps ?? []) {
    for (const e of normalizeEncounters(map.data).encounters) (out[e.troopId] ??= []).push({ mapId: map.id, weight: e.weight, regionSet: e.regionSet })
  }
  return out
}
