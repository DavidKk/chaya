import { normalizeSearchText, tokenizeSearchText } from '@/lib/translate/text-segmenter'
import { isManualTranslation, resolveItemSourceKind } from '@/lib/translate/translation-source'
import type { ExtractedTranslationItem } from '@/services/extract/lib/extract-items'

type SearchField = { text: string; weight: number }

/** Lower is better. Exact src beats exact token beats prefix beats includes; src beats zh beats meta. */
export function translationListMatchRank(item: ExtractedTranslationItem, query: string): number | null {
  const q = normalizeSearchText(query).trim()
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
    const norm = normalizeSearchText(text)
    if (!norm) continue

    let tier: number | null = null
    let penalty = 0

    if (norm === q) {
      tier = 0
    } else {
      const pos = norm.indexOf(q)
      if (pos >= 0) {
        if (q.includes(' ')) {
          if (pos === 0) {
            tier = 10
          } else {
            const charBefore = norm[pos - 1]
            const isBoundary = /[^\p{L}\p{N}]/u.test(charBefore)
            tier = isBoundary ? 20 : 30
            penalty += Math.min(pos * 0.005, 0.5)
          }
        } else {
          const tokens = tokenizeSearchText(norm)
          let exactToken = false
          let minPrefixDiff: number | null = null

          for (const token of tokens) {
            if (token === q) {
              exactToken = true
              break
            }
            if (token.startsWith(q)) {
              const diff = token.length - q.length
              if (minPrefixDiff == null || diff < minPrefixDiff) minPrefixDiff = diff
            }
          }

          if (exactToken) {
            tier = 10
            if (pos > 0) penalty += Math.min(pos * 0.005, 0.5)
          } else if (minPrefixDiff != null) {
            tier = 20
            penalty += Math.min(minPrefixDiff * 0.1, 5)
            if (pos > 0) penalty += Math.min(pos * 0.005, 0.5)
          } else if (norm.startsWith(q)) {
            tier = 20
            penalty += Math.min((norm.length - q.length) * 0.05, 5)
          } else {
            tier = 30
            if (pos > 0) penalty += Math.min(pos * 0.005, 0.5)
          }
        }
      }
    }
    if (tier == null) continue
    const score = tier + weight + penalty
    if (best == null || score < best) best = score
  }
  return best
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

const NAME_CATEGORIES = new Set(['item', 'weapon', 'armor', 'skill', 'actor', 'enemy', 'state', 'map'])
const DESC_CATEGORIES = new Set(['item_desc', 'weapon_desc', 'armor_desc', 'skill_desc', 'actor_profile', 'actor_nickname'])
const SYSTEM_CATEGORIES = new Set(['system', 'state_msg', 'plugin', 'resource'])

export function filterTranslationListItems(
  items: ExtractedTranslationItem[],
  opts: { nature?: string; category?: string; status?: string; query?: string }
): ExtractedTranslationItem[] {
  let list = items
  const nature = opts.nature || 'all'
  if (nature !== 'all') {
    if (nature === 'dialogue' || nature === 'story' || nature === 'choice') list = list.filter((it) => it.meta.category === nature)
    else if (nature === 'name') list = list.filter((it) => NAME_CATEGORIES.has(it.meta.category))
    else if (nature === 'desc') list = list.filter((it) => DESC_CATEGORIES.has(it.meta.category))
    else if (nature === 'system') list = list.filter((it) => SYSTEM_CATEGORIES.has(it.meta.category))
    else if (nature === 'hardcoded') list = list.filter((it) => Boolean(it.meta.isHardcoded || !it.meta.localesKey))
    else if (nature === 'locales') list = list.filter((it) => Boolean(it.meta.localesKey))
  }
  if (opts.category && opts.category !== 'all') list = list.filter((it) => it.meta.category === opts.category)
  if (opts.status === 'failed') list = list.filter((it) => Boolean(it.translationFailure))
  else if (opts.status === 'untranslated') list = list.filter((it) => (!it.zh || !it.zh.trim()) && !it.translationFailure)
  else if (opts.status === 'translated') list = list.filter((it) => Boolean(it.zh && it.zh.trim()))
  else if (opts.status === 'manual') list = list.filter((it) => isManualTranslation(it))
  else if (opts.status && opts.status !== 'all') list = list.filter((it) => resolveItemSourceKind(it) === opts.status)
  return filterAndRankTranslationListItems(list, opts.query || '')
}
