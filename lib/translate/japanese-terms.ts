import { GAME_TERMS, lookupGameTerm } from './game-terms'

/** Compatibility view for callers using Japanese labels and Simplified Chinese targets. */
export const JAPANESE_GAME_TERMS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.values(GAME_TERMS).map(({ translations }) => [translations.ja, translations.zh]))
)

export function lookupJapaneseGameTerm(source: string): string | null {
  return lookupGameTerm(source, 'zh', 'ja')
}
