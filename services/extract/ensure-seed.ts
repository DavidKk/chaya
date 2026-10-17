/** Extract strings from the game's data directory and merge them into *-trans.seed.json, adding empty values for missing keys while retaining translations. */
import fs from 'node:fs'
import path from 'node:path'

import { ensureGameContentDir, gameContentReadPath } from '@/lib/game/content-files'
import { buildTranslationExport } from '@/lib/translate/export'
import { lookupTranslationRecord } from '@/lib/translate/lookup'
import { reconcileTranslationSeed } from '@/lib/translate/segments'
import type { SourceLanguageOption } from '@/lib/translate/source-text'
import { getResolvedFromConfig } from '@/services/game/binding'
import { lookupGameTranslation } from '@/services/translate/cache-lookup'
import { loadGameTranslateLookup } from '@/services/translate/game-lookup'
import { openSharedCache } from '@/services/translate/shared-cache'

import { runExtract } from './lib/main'

function loadExistingSeed(contentRoot: string): Record<string, string> {
  const p = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (!p) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!k.trim()) continue
      out[k] = typeof v === 'string' ? v : v == null ? '' : String(v)
    }
    return out
  } catch {
    return {}
  }
}

export type EnsureSeedResult = {
  contentRoot: string
  extractFile: string
  seedFile: string
  unique: number
  added: number
  total: number
}

/** Extract text and ensure the seed exists before web extraction or fill-missing; entries are used for translation JSON export. */
export function extractAndEnsureSeed(options?: { entries?: boolean; sourceLanguage?: SourceLanguageOption }): EnsureSeedResult & { entries?: Record<string, string> } {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('请先在游戏库绑定本地游戏')
  if (resolved.remote) throw new Error('远程游戏请在本机绑定后抽取')
  const contentRoot = resolved.contentRoot

  const { OUT, allStrings, originalStrings } = runExtract(contentRoot, options)
  const existing = loadExistingSeed(contentRoot)
  const { seed, entries, added } = reconcileTranslationSeed(allStrings, existing)

  const seedFile = ensureGameContentDir(contentRoot, 'seed')
  fs.writeFileSync(seedFile, `${JSON.stringify(seed)}\n`, 'utf8')

  let exportEntries = entries
  if (options?.entries) {
    const local = loadGameTranslateLookup(contentRoot)
    const shared = openSharedCache()
    try {
      exportEntries = buildTranslationExport(
        entries,
        (source) =>
          lookupGameTranslation(
            (key) => lookupTranslationRecord(local, key),
            (key) => shared.get(key),
            source
          )?.zh,
        originalStrings
      )
    } finally {
      shared.close()
    }
  }

  return {
    contentRoot,
    extractFile: path.basename(OUT),
    seedFile: path.basename(seedFile),
    unique: allStrings.size,
    added,
    total: Object.keys(seed).length,
    ...(options?.entries ? { entries: exportEntries } : {}),
  }
}
