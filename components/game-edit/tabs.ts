import { type DataPath, decodePathSegments, encodeSegment, PATH_DEPTH_MAX } from '@/lib/game/save-data'
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
  { id: 'common', labelKey: 'events.tabCommon' },
  { id: 'map', labelKey: 'events.tabMap' },
  { id: 'data', labelKey: 'data.tab' },
  { id: 'trans', labelKey: 'edit.tabTranslate' },
  { id: 'logs', labelKey: 'edit.tabLogs' },
  { id: 'mcp', labelKey: 'nav.integration' },
  { id: 'settings', labelKey: 'nav.settings' },
  { id: 'about', labelKey: 'nav.about' },
  { id: 'hotkeys', labelKey: 'edit.hotkeys' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey }>

export type TabId = (typeof TABS)[number]['id']

export type GameEditSurface = 'page' | 'overlay'

/** Overlay-only main pages: not part of the「修改」sub navigation */
const MAIN_PAGES = new Set<string>(['trans', 'logs', 'mcp', 'settings', 'about', 'hotkeys'])

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

/** `/cheat/common` · `/cheat/common/12` */
export function editCommonHref(id: number | null | undefined): string {
  return id != null && id > 0 ? `/cheat/common/${id}` : '/cheat/common'
}

/** `/cheat/map` · `/cheat/map/3` · `/cheat/map/3/14` · `/cheat/map/3/14/2` (`page` is 1-based) */
export function editMapHref(mapId: number | null | undefined, eventId?: number | null, page?: number | null): string {
  if (mapId == null || mapId <= 0) return '/cheat/map'
  if (eventId == null || eventId <= 0) return `/cheat/map/${mapId}`
  return page != null && page > 0 ? `/cheat/map/${mapId}/${eventId}/${page}` : `/cheat/map/${mapId}/${eventId}`
}

/** `/cheat/data` · `/cheat/data/party/_items` (segments use the reversible URL-safe encoding) */
export function editDataHref(path: readonly string[]): string {
  return path.length ? `/cheat/data/${path.map(encodeSegment).join('/')}` : '/cheat/data'
}

/** Route segments → data path; null when malformed (too deep, too long, bad encoding, reserved names) */
export function parseDataSegments(segments: readonly string[] | undefined): DataPath | null {
  if (!segments?.length) return []
  if (segments.length > PATH_DEPTH_MAX) return null
  return decodePathSegments(segments)
}

export function isEventsTab(tab: TabId): tab is 'common' | 'map' {
  return tab === 'common' || tab === 'map'
}

/** 控制台作弊页路径，如 `/cheat/run`；角色默认进 `/cheat/actor` */
export function editTabHref(tab: TabId): string {
  if (tab === 'actor') return '/cheat/actor'
  return `/cheat/${tab}`
}
