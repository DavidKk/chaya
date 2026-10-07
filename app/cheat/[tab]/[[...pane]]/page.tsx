import { redirect } from 'next/navigation'

import { DEFAULT_TAB, editActorHref, editMapHref, editTabHref, isTabId, parseActorIdSegment, parseActorPaneSegment, parseDataSegments } from '@/components/game-edit'

type CheatTabPageProps = {
  params: Promise<{ tab: string; pane?: string[] }>
}

/**
 * 校验 `/cheat/[tab]` 与角色四级路径：
 * `/cheat/actor` · `/cheat/actor/:id` · `/cheat/actor/:id/{states|skills}`
 * UI 在 layout。
 */
export default async function CheatTabPage({ params }: CheatTabPageProps) {
  const { tab, pane } = await params
  if (!isTabId(tab)) redirect(editTabHref(DEFAULT_TAB))
  if (tab === 'hotkeys') redirect('/assist/hotkeys')
  if (tab === 'trans' || tab === 'logs') redirect(editTabHref(DEFAULT_TAB))

  const segments = pane ?? []
  if (tab === 'actor') {
    if (segments.length === 0) return null

    // 兼容旧链 `/cheat/actor/states|skills` → 回角色根，等客户端补人物 id
    if (segments.length === 1) {
      const only = segments[0]!
      if (parseActorPaneSegment(only) != null && parseActorIdSegment(only) == null) {
        redirect(editActorHref(null))
      }
      if (parseActorIdSegment(only) == null) redirect(editActorHref(null))
      return null
    }

    if (segments.length === 2) {
      const id = parseActorIdSegment(segments[0])
      const detail = parseActorPaneSegment(segments[1])
      if (id == null || detail == null || detail === 'actor') redirect(editActorHref(id))
      return null
    }

    redirect(editActorHref(null))
  }

  if (tab === 'common') {
    if (segments.length === 0) return null
    if (segments.length > 1 || parseActorIdSegment(segments[0]) == null) redirect(editTabHref(tab))
    return null
  }

  if (tab === 'map') {
    if (segments.length === 0) return null
    const mapId = parseActorIdSegment(segments[0])
    if (mapId == null || segments.length > 3) redirect(editTabHref(tab))
    const eventId = segments.length >= 2 ? parseActorIdSegment(segments[1]) : null
    if (segments.length >= 2 && eventId == null) redirect(editMapHref(mapId))
    if (segments.length === 3 && parseActorIdSegment(segments[2]) == null) redirect(editMapHref(mapId, eventId))
    return null
  }

  if (tab === 'data') {
    if (parseDataSegments(segments) == null) redirect(editTabHref(tab))
    return null
  }

  if (segments.length > 0) redirect(editTabHref(tab))
  return null
}
