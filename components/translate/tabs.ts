import type { MessageKey } from '@/lib/i18n'

export const TRANSLATE_TABS = [
  { id: 'run', labelKey: 'translate.tabRun' },
  { id: 'cache', labelKey: 'translate.tabCache' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey }>

export type TranslateTabId = (typeof TRANSLATE_TABS)[number]['id']

export const DEFAULT_TRANSLATE_TAB: TranslateTabId = 'run'

const TAB_IDS = new Set<string>(TRANSLATE_TABS.map((t) => t.id))

export function parseTranslateTab(raw: string | undefined | null): TranslateTabId {
  if (raw && TAB_IDS.has(raw)) return raw as TranslateTabId
  return DEFAULT_TRANSLATE_TAB
}

/** `/translate/{tab}/…` → tab is the second segment (not the last — detail row ids must not win). */
export function translatePathTab(pathname: string): TranslateTabId {
  const seg = pathname.split('/').filter(Boolean)[1]
  return parseTranslateTab(seg === 'translate' ? undefined : seg)
}

export function translateTabHref(tab: TranslateTabId): string {
  return `/translate/${tab}`
}

export type TranslateRunMode = 'seed' | 'play'
export const TRANSLATE_RUN_MODES = ['seed', 'play'] as const
export const translateRunHref = (mode: TranslateRunMode) => `/translate/run/${mode}`

/** Deep link: `/translate/cache/detail/{rowid}` — edit + optimize. */
export const TRANSLATE_CACHE_DETAIL_MODE = 'detail' as const

export function translateCacheDetailHref(id: number): string {
  const n = Math.floor(Number(id) || 0)
  return `/translate/cache/${TRANSLATE_CACHE_DETAIL_MODE}/${n}`
}

/** True for `/translate/cache/detail/{id}` (panel head uses detail title/desc). */
export function isTranslateCacheDetailPath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  return parts[0] === 'translate' && parts[1] === 'cache' && parts[2] === TRANSLATE_CACHE_DETAIL_MODE
}
