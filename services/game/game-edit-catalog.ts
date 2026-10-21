import fs from 'node:fs'
import path from 'node:path'

import type { CatalogEntry, GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { parseRubyMarshal, rubyToPlain } from '@/services/extract/lib/rgss/marshal'
import { getResolvedFromConfig } from '@/services/game'
import { loadGameTranslateLookup, translateWithLookup } from '@/services/translate/game-lookup'
import { openSharedCache } from '@/services/translate/shared-cache'

export type { CatalogEntry, GameEditCatalog } from '@/lib/game/game-edit-catalog-types'

function findChild(dir: string, name: string): string | null {
  try {
    const hit = fs.readdirSync(dir).find((entry) => entry.toLowerCase() === name.toLowerCase())
    return hit ? path.join(dir, hit) : null
  } catch {
    return null
  }
}

function readJsonArray(file: string): unknown[] | null {
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return Array.isArray(raw) ? raw : null
  } catch {
    return null
  }
}

function readRubyArray(dataDir: string, baseName: string): unknown[] | null {
  for (const ext of ['.rvdata2', '.rvdata']) {
    const file = findChild(dataDir, `${baseName}${ext}`)
    if (file && fs.existsSync(file)) {
      try {
        const parsed = parseRubyMarshal(fs.readFileSync(file))
        const plain = rubyToPlain(parsed)
        return Array.isArray(plain) ? plain : null
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

function readRubySystem(dataDir: string): { variables?: unknown[]; switches?: unknown[] } | null {
  for (const ext of ['.rvdata2', '.rvdata']) {
    const file = findChild(dataDir, `System${ext}`)
    if (file && fs.existsSync(file)) {
      try {
        const parsed = parseRubyMarshal(fs.readFileSync(file))
        const plain = rubyToPlain(parsed) as Record<string, unknown> | null
        if (plain && typeof plain === 'object') {
          return {
            variables: Array.isArray(plain.variables) ? plain.variables : undefined,
            switches: Array.isArray(plain.switches) ? plain.switches : undefined,
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null
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

/** 从已绑定内容根读取 data/*.json 或 data/*.rvdata2，供网页 GameEdit 预览 / UX 调试；有翻译则套用中文。 */
export function loadGameEditCatalog(): GameEditCatalog | { ok: false; error: string } {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return { ok: false, error: resolved.error || '尚未绑定游戏' }
  }

  const dataDir = findChild(resolved.contentRoot, 'data')
  if (!dataDir || !fs.existsSync(dataDir)) {
    return { ok: false, error: `找不到 data 目录: ${path.join(resolved.contentRoot, 'data')}` }
  }

  const isRgss = resolved.engine === 'VX Ace' || resolved.engine === 'VX' || resolved.kind === 'rgss'

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
    const loadDb = (name: string, withDesc = false) => {
      const rows = isRgss ? (readRubyArray(dataDir, name) ?? readJsonArray(path.join(dataDir, `${name}.json`))) : readJsonArray(path.join(dataDir, `${name}.json`))
      return entriesFromDb(rows, lookup, sharedGet, withDesc)
    }

    const items = loadDb('Items', true)
    const weapons = loadDb('Weapons', true)
    const armors = loadDb('Armors', true)
    const actors = loadDb('Actors')
    const skills = loadDb('Skills', true)
    const states = loadDb('States', true)
    const classes = loadDb('Classes')

    let variables: CatalogEntry[] = []
    let switches: CatalogEntry[] = []

    if (isRgss) {
      const system = readRubySystem(dataDir)
      if (system) {
        variables = entriesFromNameList(system.variables ?? null, lookup, sharedGet)
        switches = entriesFromNameList(system.switches ?? null, lookup, sharedGet)
      }
    }

    if (!variables.length && !switches.length) {
      const systemFile = findChild(dataDir, 'System.json')
      if (systemFile && fs.existsSync(systemFile)) {
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
