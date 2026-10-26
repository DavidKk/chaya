import defaultGameTerms from './default-game-terms.json'
import { translationSegmentContent } from './segments'

export const GAME_TERM_LANGUAGES = ['zh', 'en', 'ja', 'ko'] as const
export type GameTermLanguage = (typeof GAME_TERM_LANGUAGES)[number]
type Term = {
  translations: Readonly<Record<GameTermLanguage, string>>
  aliases?: Partial<Record<GameTermLanguage, readonly string[]>>
  badTranslations?: Partial<Record<GameTermLanguage, readonly string[]>>
}

/** Conservative standalone game labels with explicit translations for every supported term language. */
export const GAME_TERMS: Readonly<Record<string, Term>> = defaultGameTerms

function key(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

const indexes = Object.fromEntries(GAME_TERM_LANGUAGES.map((language) => [language, new Map<string, Set<string>>()])) as Record<GameTermLanguage, Map<string, Set<string>>>
for (const [id, entry] of Object.entries(GAME_TERMS)) {
  for (const language of GAME_TERM_LANGUAGES) {
    for (const source of [entry.translations[language], ...(entry.aliases?.[language] || [])]) {
      const normalized = key(source)
      const ids = indexes[language].get(normalized) || new Set<string>()
      ids.add(id)
      indexes[language].set(normalized, ids)
    }
  }
}

/** Match complete labels only; ambiguous cross-language matches have no default translation. */
export function lookupGameTerm(source: string, targetLanguage: GameTermLanguage = 'zh', sourceLanguage?: GameTermLanguage): string | null {
  if (!GAME_TERM_LANGUAGES.includes(targetLanguage) || (sourceLanguage && !GAME_TERM_LANGUAGES.includes(sourceLanguage))) return null
  const { lead, core, trail } = translationSegmentContent(source)
  const normalized = key(core)
  const languages = sourceLanguage ? [sourceLanguage] : GAME_TERM_LANGUAGES
  const targets = new Set<string>()
  for (const language of languages) {
    for (const id of indexes[language].get(normalized) || []) targets.add(GAME_TERMS[id].translations[targetLanguage])
  }
  return targets.size === 1 ? lead + [...targets][0] + trail : null
}

/**
 * Identify and fix known flawed machine translations for game terms.
 * e.g. 'Save' translated as '节省' -> corrected to '保存'.
 * Preserves boundary wrappers, whitespace and control codes.
 */
export function fixKnownBadGameTermTranslation(source: string, currentTarget: string, targetLanguage: GameTermLanguage = 'zh'): string | null {
  if (!currentTarget || !source) return null
  const { core } = translationSegmentContent(source)
  const normalizedSource = key(core)
  for (const [_id, entry] of Object.entries(GAME_TERMS)) {
    const isMatch = GAME_TERM_LANGUAGES.some((lang) => {
      const candidates = [entry.translations[lang], ...(entry.aliases?.[lang] || [])]
      return candidates.some((cand) => key(cand) === normalizedSource)
    })
    if (!isMatch) continue
    const correctTarget = entry.translations[targetLanguage]
    if (!correctTarget) continue
    const targetContent = translationSegmentContent(currentTarget)
    const targetCoreNorm = key(targetContent.core)
    const badList = entry.badTranslations?.[targetLanguage] || []
    const isBad = badList.some((bad) => key(bad) === targetCoreNorm)
    if (isBad) {
      return targetContent.lead + correctTarget + targetContent.trail
    }
  }
  return null
}
