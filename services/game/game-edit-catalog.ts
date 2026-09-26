import fs from 'node:fs'
import path from 'node:path'

import type { CatalogEntry, GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { getResolvedFromConfig } from '@/services/game'
import { loadGameTranslateLookup, translateWithLookup } from '@/services/translate/game-lookup'
import { openSharedCache } from '@/services/translate/shared-cache'

export type { CatalogEntry, GameEditCatalog } from '@/lib/game/game-edit-catalog-types'

function readJsonArray(file: string): unknown[] | null {
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return Array.isArray(raw) ? raw : null
  } catch {
    return null
  }
}

type SharedGet = (src: string) => string | null

function applyZh(lookup: Record<string, string>, sharedGet: SharedGet | null, text: string): string {
  if (!text) return text
  const zh = translateWithLookup(lookup, text, { extraGet: sharedGet ?? undefined })
  return zh && zh !== text ? zh : text
}

function entriesFromDb(rows: unknown[] | null, lookup: Record<string, string>, sharedGet: SharedGet | null, withDescription = false): CatalogEntry[] {
  if (!rows) return []
  const out: CatalogEntry[] = []
  for (let id = 1; id < rows.length; id++) {
    const row = rows[id]
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const rawName = String(rec.name ?? '').trim()
    const name = applyZh(lookup, sharedGet, rawName)
    const entry: CatalogEntry = { id, name }
    if (withDescription) {
      const rawDesc = String(rec.description ?? '')
      entry.description = applyZh(lookup, sharedGet, rawDesc)
    }
    out.push(entry)
  }
  return out
}

function entriesFromNameList(names: unknown[] | null, lookup: Record<string, string>, sharedGet: SharedGet | null): CatalogEntry[] {
  if (!names) return []
  const out: CatalogEntry[] = []
  for (let id = 1; id < names.length; id++) {
    const raw = String(names[id] ?? '').trim()
    out.push({ id, name: applyZh(lookup, sharedGet, raw) })
  }
  return out
}

/** 从已绑定内容根读取 data/*.json，供网页 GameEdit 预览 / UX 调试；有翻译则套用中文。 */
export function loadGameEditCatalog(): GameEditCatalog | { ok: false; error: string } {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return { ok: false, error: resolved.error || '尚未绑定游戏' }
  }

  const dataDir = path.join(resolved.contentRoot, 'data')
  if (!fs.existsSync(dataDir)) {
    return { ok: false, error: `找不到 data 目录: ${dataDir}` }
  }

  const lookup = loadGameTranslateLookup(resolved.contentRoot)
  let shared: ReturnType<typeof openSharedCache> | null = null
  let sharedGet: SharedGet | null = null
  try {
    shared = openSharedCache()
    sharedGet = (src) => shared!.get(src)
  } catch {
    shared = null
    sharedGet = null
  }

  try {
    const items = entriesFromDb(readJsonArray(path.join(dataDir, 'Items.json')), lookup, sharedGet, true)
    const weapons = entriesFromDb(readJsonArray(path.join(dataDir, 'Weapons.json')), lookup, sharedGet, true)
    const armors = entriesFromDb(readJsonArray(path.join(dataDir, 'Armors.json')), lookup, sharedGet, true)
    const actors = entriesFromDb(readJsonArray(path.join(dataDir, 'Actors.json')), lookup, sharedGet)
    const skills = entriesFromDb(readJsonArray(path.join(dataDir, 'Skills.json')), lookup, sharedGet, true)
    const states = entriesFromDb(readJsonArray(path.join(dataDir, 'States.json')), lookup, sharedGet, true)
    const classes = entriesFromDb(readJsonArray(path.join(dataDir, 'Classes.json')), lookup, sharedGet)

    let variables: CatalogEntry[] = []
    let switches: CatalogEntry[] = []
    const systemFile = path.join(dataDir, 'System.json')
    if (fs.existsSync(systemFile)) {
      try {
        const system = JSON.parse(fs.readFileSync(systemFile, 'utf8')) as {
          variables?: unknown[]
          switches?: unknown[]
        }
        variables = entriesFromNameList(system.variables ?? null, lookup, sharedGet)
        switches = entriesFromNameList(system.switches ?? null, lookup, sharedGet)
      } catch {
        /* ignore */
      }
    }

    return {
      ok: true,
      contentRoot: resolved.contentRoot,
      source: 'disk',
      items,
      weapons,
      armors,
      variables,
      switches,
      actors,
      skills,
      states,
      classes,
    }
  } finally {
    shared?.close()
  }
}
