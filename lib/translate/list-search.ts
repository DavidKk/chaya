import type { ExtractedTranslationItem } from '@/services/extract/lib/extract-items'

type SearchField = { text: string; weight: number }

/** Lower is better. Exact src beats startsWith beats includes; src beats zh beats meta. */
export function translationListMatchRank(item: ExtractedTranslationItem, query: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const fields: SearchField[] = [
    { text: item.src, weight: 0 },
    { text: item.zh, weight: 1 },
    { text: item.savedZh || '', weight: 1 },
    { text: item.initialZh || '', weight: 1 },
    { text: item.meta.localesKey || '', weight: 2 },
    { text: item.id, weight: 3 },
    { text: item.meta.speaker || '', weight: 4 },
    { text: item.meta.context || '', weight: 4 },
    { text: item.meta.label || '', weight: 4 },
    { text: item.meta.file || '', weight: 4 },
    { text: item.meta.localesFile || '', weight: 4 },
  ]
  let best: number | null = null
  for (const { text, weight } of fields) {
    if (!text) continue
    const value = text.toLowerCase()
    let tier: number | null = null
    if (value === q) tier = 0
    else if (value.startsWith(q)) tier = 10
    else if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(q)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(value)) tier = 20
    else if (value.includes(q)) tier = 30
    if (tier == null) continue
    const score = tier + weight
    if (best == null || score < best) best = score
  }
  return best
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Filter to matches and sort by match quality, then shorter src, then id. */
export function filterAndRankTranslationListItems(items: ExtractedTranslationItem[], query: string): ExtractedTranslationItem[] {
  const q = query.trim()
  if (!q) return items
  const ranked: Array<{ item: ExtractedTranslationItem; rank: number }> = []
  for (const item of items) {
    const rank = translationListMatchRank(item, q)
    if (rank == null) continue
    ranked.push({ item, rank })
  }
  ranked.sort((a, b) => a.rank - b.rank || a.item.src.length - b.item.src.length || a.item.id.localeCompare(b.item.id))
  return ranked.map((entry) => entry.item)
}
