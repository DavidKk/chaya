import { normalizeTranslateKey, type TranslateExtraGet, translateWithLookup } from '@/lib/translate/lookup'
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
export function loadGameTranslateLookup(contentRoot: string): Record<string, string> {
  const lookup: Record<string, string> = Object.create(null)
  try {
    for (const record of loadGameTranslationRecords(contentRoot)) applyPair(lookup, record.src, record.zh)
  } catch {
    /* Missing or invalid local files leave an empty library. */
  }
  return lookup
}
