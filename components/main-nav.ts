import type { MessageKey } from '@/lib/i18n'

/**
 * 一级模块的唯一顺序与名称。网页顶栏与局内浮层都从这里取；
 * 各端只能隐藏某些项，不能重排或改名。
 */
export const MAIN_NAV = [
  { id: 'library', labelKey: 'nav.library' },
  { id: 'edit', labelKey: 'nav.edit' },
  { id: 'translate', labelKey: 'nav.translate' },
  { id: 'assist', labelKey: 'nav.assist' },
  { id: 'logs', labelKey: 'nav.logs' },
  { id: 'integration', labelKey: 'nav.integration' },
  { id: 'about', labelKey: 'nav.about' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey }>

export type MainNavId = (typeof MAIN_NAV)[number]['id']
export type MainNavItem = (typeof MAIN_NAV)[number]
export type MainNavSurface = 'web' | 'overlay'

/** 各端不展示的模块；只列例外 */
const HIDDEN: Record<MainNavSurface, ReadonlySet<MainNavId>> = {
  web: new Set<MainNavId>(['about']),
  overlay: new Set<MainNavId>(['library']),
}

export function mainNavFor(surface: MainNavSurface): MainNavItem[] {
  return MAIN_NAV.filter((item) => !HIDDEN[surface].has(item.id))
}
