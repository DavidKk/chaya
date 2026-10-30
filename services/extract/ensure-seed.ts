/** Extract strings from the game's data directory and merge them into *-trans.seed.json, adding empty values for missing keys while retaining translations. */
import fs from 'node:fs'
import path from 'node:path'

import { ensureGameContentDir, gameContentReadPath } from '@/lib/game/content-files'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { buildTranslationExport } from '@/lib/translate/export'
import { lookupTranslationRecord } from '@/lib/translate/lookup'
import { reconcileTranslationSeed } from '@/lib/translate/segments'
import type { SourceLanguageOption } from '@/lib/translate/source-text'
import { getResolvedFromConfig } from '@/services/game/binding'
import { publicGameFiles, writePublicGameDocument } from '@/services/storage/game-files'
import { lookupGameTranslation } from '@/services/translate/cache-lookup'
import { getGameCacheContext } from '@/services/translate/game-cache-context'
import { loadGameTranslateLookup } from '@/services/translate/game-lookup'
import { loadResourceMatcher } from '@/services/translate/resources/snapshot'
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
export function extractAndEnsureSeed(options?: {
  entries?: boolean
  sourceLanguage?: SourceLanguageOption
  gameId?: string
  contentRoot?: string
}): EnsureSeedResult & { entries?: Record<string, string> } {
  let contentRoot: string
  if (options?.contentRoot) {
    contentRoot = options.contentRoot
  } else {
    const resolved = getResolvedFromConfig(options?.gameId ? { gameId: options.gameId } : undefined)
    if (!resolved.ok) throw new Error('Please bind a local game in the game library first')
    if (resolved.remote) throw new Error('Remote games must be bound locally before extracting')
    contentRoot = resolved.contentRoot
  }

  const { OUT, allStrings, originalStrings } = runExtract(contentRoot, options)
  const existing = loadExistingSeed(contentRoot)
  const { seed, entries, added } = reconcileTranslationSeed(allStrings, existing)

  const seedFile = ensureGameContentDir(contentRoot, 'seed')
  writePublicGameDocument(contentRoot, 'seed', seed)

  let exportEntries = entries
  if (options?.entries) {
    const local = loadGameTranslateLookup(contentRoot)
    const shared = openSharedCache()
    try {
      const resources = loadResourceMatcher(shared.path)
      const gameId = publicGameFiles(contentRoot).gameId
      const context = getGameCacheContext(contentRoot)
      exportEntries = buildTranslationExport(
        entries,
        (source) =>
          getGameCacheContext(contentRoot).blocked(source)
            ? undefined
            : lookupGameTranslation(
                (key) => lookupTranslationRecord(local, key),
                (key) => shared.get(key),
                source,
                { resources: false }
              )?.zh,
        originalStrings,
        {
          blocked: context.blocked,
          fallback: (source) =>
            resources.match(source, {
              sourceLanguage: options.sourceLanguage && options.sourceLanguage !== 'auto' ? options.sourceLanguage : detectCacheLang(source),
              targetLanguage: 'zh',
              gameId,
            })?.targetText,
        }
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
