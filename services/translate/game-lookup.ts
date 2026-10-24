import { normalizeTranslateKey, type TranslateExtraGet, translateWithLookup } from '@/lib/translate/lookup'
import type { SentenceRecord } from '@/lib/translate/sentence-plan'
import { isReusableTranslation } from '@/services/translate/text-classify'

import { loadGameTranslationRecords } from './game-records'

export { normalizeTranslateKey, translateWithLookup }
export type { TranslateExtraGet }

function applyPair(lookup: Record<string, string>, src: unknown, zh: unknown) {
  if (src == null || zh == null) return
  const k = String(src)
  const v = String(zh)
  if (!isReusableTranslation(k, v)) return
  lookup[k] = v
  const nk = normalizeTranslateKey(k)
  if (nk && nk !== k) lookup[nk] = v
}

/** Load seed and cache.ndjson from the game content root, with cache entries taking precedence. Return an empty lookup when files are missing. */
export function createGameTranslateLookup(records: SentenceRecord[]): Record<string, string> {
  const lookup: Record<string, string> = Object.create(null)
  try {
    for (const record of records) applyPair(lookup, record.src, record.zh)
  } catch {
    /* Missing or invalid local files leave an empty library. */
  }
  return lookup
}

export function loadGameTranslateLookup(contentRoot: string): Record<string, string> {
  try {
    return createGameTranslateLookup(loadGameTranslationRecords(contentRoot))
  } catch {
    return Object.create(null)
  }
}

/** Deliberate edits override translated RGSS Data; ordinary machine caches only fill missing values. */
export function loadRgssTranslationLookup(contentRoot: string) {
  const records = loadGameTranslationRecords(contentRoot)
  const lookup = createGameTranslateLookup(records)
  const overrides = createGameTranslateLookup(
    records.filter(
      ({ engine }) => engine === 'manual' || engine === 'import' || engine?.startsWith('import:') || engine === 'live:optimize' || engine?.startsWith('live:optimize:')
    )
  )
  return { lookup, overrides }
}

export function resolveRgssTranslation(src: string, current: string, translations: ReturnType<typeof loadRgssTranslationLookup>): string {
  return translations.overrides[src] || current || translations.lookup[src] || ''
}
