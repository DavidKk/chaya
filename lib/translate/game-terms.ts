import { translationSegmentContent } from './segments'

export const GAME_TERM_LANGUAGES = ['zh', 'en', 'ja', 'ko'] as const
export type GameTermLanguage = (typeof GAME_TERM_LANGUAGES)[number]
type Term = { translations: Readonly<Record<GameTermLanguage, string>>; aliases?: Partial<Record<GameTermLanguage, readonly string[]>> }

/** Conservative standalone game labels with explicit translations for every supported term language. */
export const GAME_TERMS: Readonly<Record<string, Term>> = {
  flame: { translations: { zh: '炎', en: 'Flame', ja: '炎', ko: '화염' }, aliases: { en: ['Fire'] } },
  lightning: { translations: { zh: '雷', en: 'Lightning', ja: '雷', ko: '번개' } },
  water: { translations: { zh: '水', en: 'Water', ja: '水', ko: '물' } },
  earth: { translations: { zh: '土', en: 'Earth', ja: '土', ko: '대지' } },
  light: { translations: { zh: '光', en: 'Light', ja: '光', ko: '빛' } },
  sword: { translations: { zh: '剑', en: 'Sword', ja: '剣', ko: '검' } },
  axe: { translations: { zh: '斧', en: 'Axe', ja: '斧', ko: '도끼' } },
  staff: { translations: { zh: '杖', en: 'Staff', ja: '杖', ko: '지팡이' } },
  bow: { translations: { zh: '弓', en: 'Bow', ja: '弓', ko: '활' } },
  gun: { translations: { zh: '枪', en: 'Gun', ja: '銃', ko: '총' } },
  claw: { translations: { zh: '爪', en: 'Claw', ja: '爪', ko: '발톱' } },
  spear: { translations: { zh: '长枪', en: 'Spear', ja: '槍', ko: '창' } },
}

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
