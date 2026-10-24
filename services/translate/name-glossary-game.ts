import { entriesFromNamePairs, isNameGlossaryCategory, isUsableNamePair, type NameEntry } from '@/lib/translate/name-glossary'
import { type ExtractedTextCategory, loadExtractedItems } from '@/services/extract/lib/extract-items'
import { getGameCacheContext } from '@/services/translate/game-cache-context'

const tables = new Map<string, { stamp: string; entries: NameEntry[] }>()

function zhForName(src: string, lookup: Record<string, string>, fallback?: string): string {
  return String(lookup[src] || fallback || '').trim()
}

export function loadGameNameEntries(contentRoot: string, toLang?: string | null): NameEntry[] {
  const root = String(contentRoot || '')
  if (!root) return []
  const stamp = `${getGameCacheContext(root).stamp}:${toLang || 'zh'}`
  const cached = tables.get(root)
  if (cached?.stamp === stamp) return cached.entries
  const lookup = getGameCacheContext(root).lookup
  const pairs: NameEntry[] = []
  for (const item of loadExtractedItems(root)) {
    const category = item.meta.category as ExtractedTextCategory
    if (!isNameGlossaryCategory(category)) continue
    const zh = zhForName(item.src, lookup, item.zh || item.savedZh)
    if (!isUsableNamePair(item.src, zh)) continue
    pairs.push({ src: item.src, zh, category })
  }
  const entries = entriesFromNamePairs(pairs, toLang)
  if (tables.size >= 8 && !tables.has(root)) tables.delete(tables.keys().next().value!)
  tables.set(root, { stamp, entries })
  return entries
}

export function nameEntriesFromLookup(srcNames: Iterable<string>, lookup: Record<string, string>, toLang?: string | null): NameEntry[] {
  const pairs: NameEntry[] = []
  for (const src of srcNames) {
    const zh = String(lookup[src] || '').trim()
    if (!isUsableNamePair(src, zh)) continue
    pairs.push({ src, zh })
  }
  return entriesFromNamePairs(pairs, toLang)
}

/** Test helper: drop memoized tables after mutating extract/records mocks. */
export function resetGameNameGlossaryTables() {
  tables.clear()
}
