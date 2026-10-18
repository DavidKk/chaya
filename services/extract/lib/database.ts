import fs from 'node:fs'
import path from 'node:path'

import { DB_SPECS } from '@/lib/translate/database-fields'
export { DB_SPECS } from '@/lib/translate/database-fields'

import { addUnique, clean, isUseful } from './text'

export function loadJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.warn(`[extract] Skipping non-standard or corrupt JSON file ${file}:`, err instanceof Error ? err.message : err)
    return null
  }
}

function extractDatabaseArray(dataDir: string, file: string, fields: string[]) {
  const loaded = loadJson(path.join(dataDir, file))
  const rows = Array.isArray(loaded) ? loaded : []
  const out: any[] = []
  const seen = new Set<string>()
  rows.forEach((row: any, index: number) => {
    if (!row) return
    const entry: any = { id: row.id != null ? row.id : index }
    let any = false
    for (const field of fields) {
      const value = clean(row[field])
      if (!isUseful(value)) continue
      entry[field] = value
      any = true
      seen.add(value)
    }
    if (any) out.push(entry)
  })
  return { entries: out, unique: [...seen] }
}

function extractSystem(dataDir: string) {
  const sys = loadJson(path.join(dataDir, 'System.json'))
  const bucket: string[] = []
  if (!sys) return bucket
  const seen = new Set<string>()
  const push = (text: unknown) => addUnique(bucket, seen, text)

  push(sys.gameTitle)
  push(sys.currencyUnit)

  for (const key of ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes', 'switches', 'variables']) {
    for (const value of sys[key] || []) push(value)
  }

  const terms = sys.terms || {}
  for (const key of ['basic', 'commands', 'params']) {
    for (const value of terms[key] || []) push(value)
  }
  for (const value of Object.values(terms.messages || {})) push(value)

  return bucket
}

function extractMapNames(dataDir: string) {
  const maps: { id: number; name: string; eventId?: number }[] = []
  const seen = new Set<string>()
  for (const file of fs
    .readdirSync(dataDir)
    .filter((f) => /^Map\d+\.json$/.test(f))
    .sort()) {
    const map = loadJson(path.join(dataDir, file))
    if (!map) continue
    const id = Number(file.match(/Map(\d+)/)?.[1])
    const add = (value: unknown, eventId?: number) => {
      const name = clean(value)
      if (!isUseful(name) || seen.has(name)) return
      seen.add(name)
      maps.push({ id, name, ...(eventId == null ? {} : { eventId }) })
    }
    add(map.displayName)
    add(map.name)
    for (const event of map.events || []) if (event) add(event.name, event.id)
  }
  return maps
}

function extractNames(dataDir: string) {
  const nameSet = new Set<string>()
  const actors = loadJson(path.join(dataDir, 'Actors.json'))
  for (const actor of Array.isArray(actors) ? actors : []) {
    if (!actor) continue
    if (isUseful(actor.name)) nameSet.add(clean(actor.name))
    if (isUseful(actor.nickname)) nameSet.add(clean(actor.nickname))
  }
  const enemies = loadJson(path.join(dataDir, 'Enemies.json'))
  for (const enemy of Array.isArray(enemies) ? enemies : []) {
    const name = clean(enemy && enemy.name)
    if (name.length >= 3 && /^[\u30A0-\u30FFー]+$/.test(name)) nameSet.add(name)
  }
  return [...nameSet].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

export function extractDatabase(dataDir: string) {
  const db: Record<string, unknown> = {}
  for (const [file, fields, category] of DB_SPECS) {
    db[category] = extractDatabaseArray(dataDir, file, fields).entries
  }
  db.system = extractSystem(dataDir)
  db.names = extractNames(dataDir)
  const mapNames = extractMapNames(dataDir)
  if (mapNames.length) db.maps = mapNames
  return db
}

export { extractDatabaseArray, extractMapNames, extractSystem }
