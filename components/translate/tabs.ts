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

export function translateTabHref(tab: TranslateTabId): string {
  return `/translate/${tab}`
}
