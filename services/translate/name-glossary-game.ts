import fs from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import { RGSS_EXTRACT_WORKER_PATH } from '@/constants/paths'
import { entriesFromNamePairs, isNameGlossaryCategory, isUsableNamePair, type NameEntry } from '@/lib/translate/name-glossary'
import { type ExtractedTranslationItem, loadExtractedItems } from '@/services/extract/lib/extract-items'
import { runWorkerOnce } from '@/services/jobs'
import { startOperation } from '@/services/log/operation'
import { getGameCacheContext } from '@/services/translate/game-cache-context'
import { loadGameTranslateLookup, loadRgssTranslationLookup, resolveRgssTranslation } from '@/services/translate/game-lookup'

const tables = new Map<string, { stamp: string; entries: NameEntry[] }>()
const sources = new Map<string, { stamp: string; items: Promise<ExtractedTranslationItem[]> }>()

function rgssSourceStamp(root: string): string | null {
  const dir = fs.readdirSync(root).find((name) => name.toLowerCase() === 'data')
  if (!dir) return null
  const dataDir = path.join(root, dir)
  const names = fs
    .readdirSync(dataDir)
    .filter((name) => /\.rvdata2?(?:\.chaya\.bak)?$/i.test(name))
    .sort()
  if (!names.length) return null
  return JSON.stringify(
    names.map((name) => {
      const stat = fs.statSync(path.join(dataDir, name))
      return [name, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]
    })
  )
}

async function loadNameSources(root: string, stamp: string | null): Promise<ExtractedTranslationItem[]> {
  if (stamp === null) return loadExtractedItems(root)
  const cached = sources.get(root)
  if (cached?.stamp === stamp) return cached.items
  const items = (async () => {
    const { path: file } = await runWorkerOnce({ entry: RGSS_EXTRACT_WORKER_PATH, workerData: { contentRoot: root, namesOnly: true } })
    try {
      const body = JSON.parse(await readFile(file, 'utf8')) as { items: ExtractedTranslationItem[] }
      return body.items
    } finally {
      await unlink(file).catch(() => {})
    }
  })()
  if (sources.size >= 8 && !sources.has(root)) sources.delete(sources.keys().next().value!)
  sources.set(root, { stamp, items })
  try {
    return await items
  } catch (error) {
    if (sources.get(root)?.items === items) sources.delete(root)
    throw error
  }
}

export async function loadGameNameEntries(contentRoot: string, toLang?: string | null): Promise<NameEntry[]> {
  const root = String(contentRoot || '')
  if (!root) return []
  const timing = startOperation('translate', 'glossary.load', { target: toLang || 'zh' }, { start: false })
  let stampMs = 0
  let sourcesMs = 0
  let lookupMs = 0
  try {
    const sourceStamp = rgssSourceStamp(root)
    const context = getGameCacheContext(root)
    const stamp = `${context.stamp}:${sourceStamp}:${toLang || 'zh'}`
    const cached = tables.get(root)
    stampMs = timing.elapsedMs()
    if (cached?.stamp === stamp) {
      timing.end('completed', { cacheHit: true, entries: cached.entries.length, stampMs })
      return cached.entries
    }
    const loading = performance.now()
    const items = await loadNameSources(root, sourceStamp)
    sourcesMs = Math.round((performance.now() - loading) * 10) / 10
    const lookupStarted = performance.now()
    const translations = sourceStamp === null ? null : loadRgssTranslationLookup(root)
    const lookup = translations?.lookup ?? loadGameTranslateLookup(root)
    lookupMs = Math.round((performance.now() - lookupStarted) * 10) / 10
    const building = performance.now()
    const pairs: NameEntry[] = []
    for (const item of items) {
      const category = item.meta.category
      if (!isNameGlossaryCategory(category) || context.blocked(item.src)) continue
      const current = item.zh || item.savedZh || ''
      const zh = String(translations ? resolveRgssTranslation(item.src, current, translations) : lookup[item.src] || current).trim()
      if (!isUsableNamePair(item.src, zh)) continue
      pairs.push({ src: item.src, zh, category })
    }
    const entries = entriesFromNamePairs(pairs, toLang)
    if (tables.size >= 8 && !tables.has(root)) tables.delete(tables.keys().next().value!)
    tables.set(root, { stamp, entries })
    timing.end('completed', {
      cacheHit: false,
      format: sourceStamp === null ? 'mv' : 'rgss',
      items: items.length,
      entries: entries.length,
      stampMs,
      sourcesMs,
      lookupMs,
      buildMs: Math.round((performance.now() - building) * 10) / 10,
    })
    return entries
  } catch (error) {
    timing.fail(error, { stampMs, sourcesMs, lookupMs })
    throw error
  }
}

/** Test helper: drop memoized tables after mutating extract/records mocks. */
export function resetGameNameGlossaryTables() {
  tables.clear()
  sources.clear()
}
