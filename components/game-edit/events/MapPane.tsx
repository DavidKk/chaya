'use client'

import { useMemo } from 'react'

import type { SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { padXDense } from '@/components/layoutClasses'
import { EmptyState, ScrollArea } from '@/components/sk'
import { flattenMapTree, type MapTreeRow } from '@/lib/game/events'
import { cn } from '@/lib/utils'

import { EventsDataState } from './CommonEventsPane'
import { MapDetail } from './MapDetail'
import type { EventsSlot } from './types'

type Props = {
  slot: EventsSlot
  filter: string
  session: SessionState
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

/** 修改 › 地图: map tree (current / recent on top) + map detail; narrow containers show one at a time */
export function MapPane({ slot, filter, session }: Props) {
  const t = useT()
  const data = slot.data
  const rows = useMemo(() => (data ? flattenMapTree(data.mapIndex.nodes) : []), [data])
  const q = filter.trim().toLowerCase()
  const visible = useMemo(() => {
    const out: Array<{ row: MapTreeRow; eventHit?: string }> = []
    for (const row of rows) {
      const m = matchMap(row, q)
      if (m.hit) out.push({ row, eventHit: m.eventHit })
    }
    return out
  }, [rows, q])

  if (!data || !rows.length) return <EventsDataState slot={slot} />

  const selected = slot.mapId != null ? (rows.find((r) => r.id === slot.mapId) ?? null) : null
  const currentId = slot.live ? (slot.player?.mapId ?? 0) : 0
  const recent = slot.live ? slot.recentMaps.filter((id) => id !== currentId && data.names.maps[id] != null).slice(0, 5) : []

  const renderRow = (id: number, label: string, depth: number, extra?: string, key?: string) => (
    <button
      key={key ?? id}
      type="button"
      className={cn(treeRow, id === selected?.id && treeRowOn)}
      style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}
      aria-current={id === selected?.id ? 'true' : undefined}
      onClick={() => slot.onSelectMap(id, null)}
    >
      <span className="w-8 shrink-0 font-mono text-[0.7rem] text-ink-soft">{id}</span>
      <span className="min-w-0 flex-1 truncate text-ink" title={label}>
        {label}
        {extra ? <span className="ml-1.5 text-[0.7rem] text-ink-soft">· {extra}</span> : null}
      </span>
      {id === currentId ? <span className="shrink-0 text-[0.65rem] text-ok">{t('events.map.current')}</span> : null}
    </button>
  )

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn('min-h-0 w-full flex-col @4xl:w-[17rem] @4xl:shrink-0 @4xl:border-r @4xl:border-line', selected ? 'hidden @4xl:flex' : 'flex')}
          aria-label={t('events.map.treeAria')}
        >
          <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('events.map.treeAria') }}>
            {currentId && !q ? (
              <>
                <h3 className={sideTitle}>{t('events.map.current')}</h3>
                {renderRow(currentId, data.names.maps[currentId] || `#${currentId}`, 0, slot.player ? `(${slot.player.x}, ${slot.player.y})` : undefined, `cur-${currentId}`)}
              </>
            ) : null}
            {recent.length && !q ? (
              <>
                <h3 className={sideTitle}>{t('events.map.recent')}</h3>
                {recent.map((id) => renderRow(id, data.names.maps[id] || `#${id}`, 0, undefined, `recent-${id}`))}
              </>
            ) : null}
            {(currentId || recent.length) && !q ? <h3 className={sideTitle}>{t('events.tabMap')}</h3> : null}
            {visible.length ? (
              visible.map(({ row, eventHit }) => renderRow(row.id, row.name || `#${row.id}`, q ? 0 : row.depth, eventHit))
            ) : (
              <EmptyState title={t('edit.noMatch')} message={t('events.map.searchHint')} />
            )}
          </ScrollArea>
        </aside>
        <div className={cn('min-h-0 min-w-0 flex-1', selected ? 'flex' : 'hidden @4xl:flex')}>
          {selected ? <MapDetail key={selected.id} node={selected} data={data} slot={slot} session={session} /> : <EmptyState title={t('events.map.selectHint')} />}
        </div>
      </div>
    </div>
  )
}
