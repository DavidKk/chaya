import { currentAgentRuntimeIdentity } from '../identity'

export const STORY_BENCHMARK_GAME_ID = 'cfbafc20-c4d9-4b96-ad07-21ce55722678'

export function isBenchmarkStoryGame(): boolean {
  if (currentAgentRuntimeIdentity()?.libraryGameId === STORY_BENCHMARK_GAME_ID) return true
  const g = globalThis as any
  const title = g.$dataSystem?.gameTitle || (typeof document !== 'undefined' ? document.title : '')
  if (typeof title === 'string' && /Heroines\s+of\s+Swords/i.test(title)) return true
  if (typeof window !== 'undefined' && /Heroines\.of\.Swords/i.test(window.location?.href || '')) return true
  return false
}
