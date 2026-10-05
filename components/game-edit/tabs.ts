import type { MessageKey } from '@/lib/i18n'

export const TABS = [
  { id: 'run', labelKey: 'edit.run' },
  { id: 'bag', labelKey: 'edit.bag' },
  { id: 'item', labelKey: 'edit.item' },
  { id: 'weapon', labelKey: 'edit.weapon' },
  { id: 'armor', labelKey: 'edit.armor' },
  { id: 'var', labelKey: 'edit.var' },
  { id: 'sw', labelKey: 'edit.sw' },
  { id: 'actor', labelKey: 'edit.actor' },
  { id: 'trans', labelKey: 'edit.tabTranslate' },
  { id: 'logs', labelKey: 'edit.tabLogs' },
  { id: 'mcp', labelKey: 'nav.integration' },
  { id: 'hotkeys', labelKey: 'edit.hotkeys' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey }>

export type TabId = (typeof TABS)[number]['id']

export type GameEditSurface = 'page' | 'overlay'

/** Overlay-only main pages: not part of the「修改」sub navigation */
const MAIN_PAGES = new Set<string>(['trans', 'logs', 'mcp'])

export const EDIT_TABS = TABS.filter((tab) => !MAIN_PAGES.has(tab.id))

export function isEditTab(tab: TabId): boolean {
  return !MAIN_PAGES.has(tab)
}

/**
 * Web 控制台（page）不展示「翻译」——走顶栏 `/translate`；
 * 局内浮层（overlay）和网页共用「修改」的二级分类。
 */
export function tabsForSurface(_surface: GameEditSurface = 'page'): ReadonlyArray<(typeof TABS)[number]> {
  return EDIT_TABS
}

export const DEFAULT_TAB: TabId = 'run'

const TAB_IDS = new Set<string>(TABS.map((t) => t.id))

export function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && TAB_IDS.has(value)
}

export function parseTabId(value: unknown, fallback: TabId = DEFAULT_TAB): TabId {
  return isTabId(value) ? value : fallback
}

/**
 * 角色四级路径：
 * - 二级 `/cheat/actor`
 * - 三级 `/cheat/actor/:id`（选中人物，默认四级「角色」）
 * - 四级 `/cheat/actor/:id/states` · `/cheat/actor/:id/skills`
 */
export const ACTOR_PANES = [
  { id: 'actor', labelKey: 'edit.actorPane', segment: null },
  { id: 'states', labelKey: 'edit.states', segment: 'states' },
  { id: 'skills', labelKey: 'edit.skills', segment: 'skills' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; segment: string | null }>

export type ActorPaneId = (typeof ACTOR_PANES)[number]['id']

export const DEFAULT_ACTOR_PANE: ActorPaneId = 'actor'

const ACTOR_PANE_BY_SEGMENT = new Map<string, ActorPaneId>([
  ['states', 'states'],
  ['skills', 'skills'],
])

export function isActorPaneId(value: unknown): value is ActorPaneId {
  return value === 'actor' || value === 'states' || value === 'skills'
}

/** 人物 id：正整数；非法返回 null */
export function parseActorIdSegment(segment: string | undefined | null): number | null {
  if (segment == null || segment === '') return null
  if (!/^\d+$/.test(segment)) return null
  const n = Number(segment)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** `undefined` / 空 → 角色主表单；非法 segment 返回 null */
export function parseActorPaneSegment(segment: string | undefined | null): ActorPaneId | null {
  if (segment == null || segment === '') return DEFAULT_ACTOR_PANE
  return ACTOR_PANE_BY_SEGMENT.get(segment) ?? null
}

/** 无人物 id 时退回 `/cheat/actor` */
export function editActorPaneHref(pane: ActorPaneId = DEFAULT_ACTOR_PANE): string {
  return editActorHref(null, pane)
}

/** `/cheat/actor` · `/cheat/actor/12` · `/cheat/actor/12/states` */
export function editActorHref(actorId: number | null | undefined, pane: ActorPaneId = DEFAULT_ACTOR_PANE): string {
  if (actorId == null || actorId <= 0) return '/cheat/actor'
  const base = `/cheat/actor/${actorId}`
  const meta = ACTOR_PANES.find((p) => p.id === pane)
  if (!meta?.segment) return base
  return `${base}/${meta.segment}`
}

/** 控制台作弊页路径，如 `/cheat/run`；角色默认进 `/cheat/actor` */
export function editTabHref(tab: TabId): string {
  if (tab === 'actor') return '/cheat/actor'
  return `/cheat/${tab}`
}
