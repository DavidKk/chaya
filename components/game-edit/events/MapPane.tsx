'use client'

import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IoChevronBack, IoChevronForward } from 'react-icons/io5'

import type { SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { padXDense } from '@/components/layoutClasses'
import { EmptyState, ScrollArea, TextInput } from '@/components/sk'
import { flattenMapTree, type MapTreeRow } from '@/lib/game/events'
import { cn } from '@/lib/utils'

import { EventsDataState } from './CommonEventsPane'
import { MapDetail, NearToggle } from './MapDetail'
import type { EventsSlot } from './types'

type Props = {
  slot: EventsSlot
  filter: string
  session: SessionState
  /** Panel header spot (right of the search box) for the page-wide "nearby" switch */
  headSlot?: HTMLElement | null
}

const treeRow = cn(
  'flex w-full cursor-pointer items-center gap-2 border-none bg-transparent py-1.5 text-left text-[0.8125rem] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]',
  padXDense
)
const treeRowOn = 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]'
const sideTitle = 'm-0 px-3 pt-2 pb-1 text-[0.68rem] font-semibold tracking-[0.05em] text-ink-soft uppercase'

/** Map name / id / event names; returns the first matching event name for display */
function matchMap(row: MapTreeRow, q: string): { hit: boolean; eventHit?: string } {
  if (!q) return { hit: true }
  if (`${row.id} ${row.name} ${row.rawName}`.toLowerCase().includes(q)) return { hit: true }
  const eventHit = row.eventNames.find((name) => name.toLowerCase().includes(q))
  return eventHit ? { hit: true, eventHit } : { hit: false }
}

/**
 * 修改 › 地图: one level of the map tree at a time (drill in via ›, back via the breadcrumb),
 * so any depth or width keeps the same layout; search lists matches flat with their path. Map detail on the right.
 */
export function MapPane({ slot, filter, session, headSlot }: Props) {
  const t = useT()
  const [near, setNear] = useState(true)
  const data = slot.data
  const rows = useMemo(() => (data ? flattenMapTree(data.mapIndex.nodes) : []), [data])
  const [treeQuery, setTreeQuery] = useState('')
  const q = (treeQuery.trim() || filter.trim()).toLowerCase()
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const parentOf = useCallback(
    (id: number) => {
      const p = byId.get(id)?.parentId ?? 0
      return byId.has(p) && p !== id ? p : 0
    },
    [byId]
  )
  /** Ancestor ids from the root down to `id`'s parent */
  const ancestorsOf = useCallback(
    (id: number) => {
      const out: number[] = []
      for (let p = parentOf(id); p && !out.includes(p); p = parentOf(p)) out.unshift(p)
      return out
    },
    [parentOf]
  )
  const parents = useMemo(() => new Set(rows.map((r) => parentOf(r.id)).filter(Boolean)), [rows, parentOf])
  const nameOf = (id: number) => byId.get(id)?.name || `#${id}`
  const pathOf = (id: number) => ancestorsOf(id).map(nameOf).join(' › ')

  const currentId = slot.live ? (slot.player?.mapId ?? 0) : 0
  const currentAncestors = useMemo(() => new Set(currentId ? ancestorsOf(currentId) : []), [currentId, ancestorsOf])
  /** Level picked by drilling / breadcrumb; dropped once another map gets selected */
  const [nav, setNav] = useState<{ anchor: number | null; level: number } | null>(null)
  const autoLevel = slot.mapId != null ? parentOf(slot.mapId) : currentId ? parentOf(currentId) : 0
  const level = nav && nav.anchor === slot.mapId && (nav.level === 0 || byId.has(nav.level)) ? nav.level : autoLevel
  const goTo = (id: number) => {
    setTreeQuery('')
    setNav({ anchor: slot.mapId, level: id })
  }

  const visible = useMemo(() => {
    const out: Array<{ row: MapTreeRow; eventHit?: string }> = []
    for (const row of rows) {
      if (q) {
        const m = matchMap(row, q)
        if (m.hit) out.push({ row, eventHit: m.eventHit })
      } else if (parentOf(row.id) === level) out.push({ row })
    }
    return out
  }, [rows, q, level, parentOf])

  if (!data || !rows.length) return <EventsDataState slot={slot} />

  const selected = slot.mapId != null ? (byId.get(slot.mapId) ?? null) : null
  const recent = slot.live ? slot.recentMaps.filter((id) => id !== currentId && data.names.maps[id] != null).slice(0, 5) : []
  const crumbs = level ? [...ancestorsOf(level), level] : []

  const renderRow = (id: number, label: string, extra?: string, key?: string, drill = false) => {
    const kids = drill && parents.has(id)
    const path = pathOf(id)
    return (
      <div key={key ?? id} className={cn('flex items-center', id === selected?.id && treeRowOn)}>
        <button
          type="button"
          className={cn(treeRow, 'min-w-0 flex-1')}
          aria-current={id === selected?.id ? 'true' : undefined}
          title={path ? `${path} › ${label}` : label}
          onClick={() => slot.onSelectMap(id, null)}
        >
          <span className="min-w-0 flex-1 truncate text-ink">
            {label}
            {extra ? <span className="ml-1.5 text-[0.7rem] text-ink-soft">· {extra}</span> : null}
          </span>
          {id === currentId ? (
            <span className="shrink-0 text-[0.65rem] text-info">{t('events.map.current')}</span>
          ) : currentAncestors.has(id) ? (
            <span className="shrink-0 text-[0.65rem] text-ink-soft">{t('events.map.containsCurrent')}</span>
          ) : null}
        </button>
        {kids ? (
          <button
            type="button"
            className="m-0 inline-flex shrink-0 cursor-pointer items-center rounded-none border-none bg-transparent px-2 text-ink-soft hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] hover:text-ink"
            style={{ alignSelf: 'stretch' }}
            aria-label={t('events.map.enterChildren', { name: label })}
            title={t('events.map.enterChildren', { name: label })}
            onClick={() => goTo(id)}
          >
            <IoChevronForward size={13} aria-hidden />
          </button>
        ) : null}
      </div>
    )
  }

  const crumbBtn = 'm-0 min-w-0 shrink cursor-pointer truncate rounded-[0.2rem] border-none bg-transparent px-1 py-0.5 text-[0.72rem] text-ink-soft hover:text-ink'
  const breadcrumb = (
    <nav className="flex min-w-0 items-center gap-0.5 border-b border-line px-2 py-1.5" aria-label={t('events.map.levelAria')}>
      {level ? (
        <button type="button" className={cn(crumbBtn, 'shrink-0')} aria-label={t('events.map.levelUp')} title={t('events.map.levelUp')} onClick={() => goTo(parentOf(level))}>
          <IoChevronBack size={12} aria-hidden />
        </button>
      ) : null}
      <button type="button" className={cn(crumbBtn, 'shrink-0', !level && 'font-semibold text-ink')} onClick={() => goTo(0)}>
        {t('events.map.allMaps')}
      </button>
      {crumbs.length > 2 ? (
        <>
          <span className="text-[0.7rem] text-ink-soft">›</span>
          <button type="button" className={cn(crumbBtn, 'shrink-0')} title={crumbs.slice(0, -2).map(nameOf).join(' › ')} onClick={() => goTo(crumbs[crumbs.length - 3])}>
            …
          </button>
        </>
      ) : null}
      {crumbs.slice(-2).map((id) => (
        <span key={id} className="flex min-w-0 items-center gap-0.5">
          <span className="text-[0.7rem] text-ink-soft">›</span>
          <button type="button" className={cn(crumbBtn, id === level && 'font-semibold text-ink')} title={nameOf(id)} onClick={() => goTo(id)}>
            {nameOf(id)}
          </button>
        </span>
      ))}
    </nav>
  )

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn('min-h-0 w-full flex-col @4xl:w-[17rem] @4xl:shrink-0 @4xl:border-r @4xl:border-line', selected ? 'hidden @4xl:flex' : 'flex')}
          aria-label={t('events.map.treeAria')}
        >
          <div className="shrink-0 border-b border-line px-3 py-2">
            <TextInput
              search
              type="search"
              className="h-8 w-full min-w-0 text-[0.8125rem]"
              value={treeQuery}
              placeholder={t('events.map.treeSearch')}
              aria-label={t('events.map.treeSearch')}
              onChange={(e) => setTreeQuery(e.target.value)}
            />
          </div>
          {q ? null : breadcrumb}
          <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('events.map.treeAria') }}>
            {recent.length && !q && !level ? (
              <>
                <h3 className={sideTitle}>{t('events.map.recent')}</h3>
                {recent.map((id) => renderRow(id, nameOf(id), pathOf(id) || undefined, `recent-${id}`))}
                <h3 className={sideTitle}>{t('events.tabMap')}</h3>
              </>
            ) : null}
            {visible.length ? (
              visible.map(({ row, eventHit }) =>
                q
                  ? renderRow(row.id, row.name || `#${row.id}`, [pathOf(row.id), eventHit].filter(Boolean).join(' · ') || undefined, undefined, true)
                  : renderRow(row.id, row.name || `#${row.id}`, undefined, undefined, true)
              )
            ) : (
              <EmptyState title={t('edit.noMatch')} message={t('events.map.searchHint')} />
            )}
          </ScrollArea>
        </aside>
        <div className={cn('min-h-0 min-w-0 flex-1', selected ? 'flex' : 'hidden @4xl:flex')}>
          {selected ? <MapDetail key={selected.id} node={selected} data={data} slot={slot} session={session} near={near} /> : <EmptyState title={t('events.map.selectHint')} />}
        </div>
      </div>
      {headSlot ? createPortal(<NearToggle near={near} onChange={setNear} />, headSlot) : null}
    </div>
  )
}
