'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { useT } from '@/components/i18n/LocaleProvider'
import { padXDense } from '@/components/layoutClasses'
import { EmptyState, ScrollArea, TruncateText } from '@/components/sk'
import { filterToggle, filterToggleOn } from '@/components/sk/control'
import { matchesTroop, type TroopInfo } from '@/lib/game/events'
import { cn } from '@/lib/utils'

import { EventsDataState } from './CommonEventsPane'
import { CurrentBattle } from './CurrentBattle'
import { troopMemberSummary, troopName } from './labels'
import { TroopDetail } from './TroopDetail'
import type { EventsSlot } from './types'

type Props = {
  slot: EventsSlot
  filter: string
  /** Panel header spot (right of the search box) for the list filters */
  headSlot?: HTMLElement | null
}

const listRow = cn(
  'flex w-full cursor-pointer flex-col items-stretch gap-0.5 border-none border-b border-line bg-transparent py-1.5 text-left text-[0.8125rem] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]',
  padXDense
)
const listRowOn = 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]'

function TroopRow({ troop, selected, onSelect }: { troop: TroopInfo; selected: boolean; onSelect: () => void }) {
  const t = useT()
  const empty = !troop.members.length
  return (
    <button type="button" className={cn(listRow, selected && listRowOn)} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      <TruncateText text={troopName(troop, troop.id, t)} className={empty ? 'text-ink-soft' : 'text-ink'} />
      <TruncateText text={troopMemberSummary(troop.members, t)} className="text-[0.7rem] text-ink-soft" />
    </button>
  )
}

/** 修改 › 敌群: list + detail; narrow containers show one at a time */
export function TroopsPane({ slot, filter, headSlot }: Props) {
  const t = useT()
  const [showEmpty, setShowEmpty] = useState(false)
  const [onlyEncounter, setOnlyEncounter] = useState(false)
  const data = slot.data
  const troops = data?.troops
  const visible = useMemo(() => {
    const reachable = (id: number) => !!data?.troopEncounters?.[id]?.length || !!data?.troopRefs?.[id]?.length
    return (troops ?? []).filter((troop) => (showEmpty || troop.members.length > 0) && (!onlyEncounter || reachable(troop.id)) && matchesTroop(troop, filter))
  }, [troops, data, showEmpty, onlyEncounter, filter])
  const selected = troops && slot.troopId != null ? (troops.find((troop) => troop.id === slot.troopId) ?? null) : null

  if (!data || !troops?.length) return <EventsDataState slot={slot} head="troop" />

  const incomplete = !data.mapsScanned || data.mapsFailed > 0
  const filters = (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={onlyEncounter}
        className={cn(filterToggle, 'shrink-0', onlyEncounter && filterToggleOn)}
        onClick={() => setOnlyEncounter(!onlyEncounter)}
      >
        {t('events.troop.onlyEncounter')}
      </button>
      <button type="button" role="switch" aria-checked={showEmpty} className={cn(filterToggle, 'shrink-0', showEmpty && filterToggleOn)} onClick={() => setShowEmpty(!showEmpty)}>
        {t('events.troop.showEmpty')}
      </button>
    </div>
  )

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      {slot.battle ? <CurrentBattle battle={slot.battle} enemies={data.names.enemies} slot={slot} /> : null}
      {onlyEncounter && incomplete ? <p className="m-0 shrink-0 border-b border-line px-3 py-1 text-[0.7rem] text-warn">{t('events.troop.onlyEncounterIncomplete')}</p> : null}
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn('min-h-0 w-full flex-col @4xl:w-[17rem] @4xl:shrink-0 @4xl:border-r @4xl:border-line', selected ? 'hidden @4xl:flex' : 'flex')}
          aria-label={t('events.troop.listAria')}
        >
          {headSlot ? null : <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">{filters}</div>}
          {visible.length === 0 ? (
            <EmptyState title={t('edit.noMatch')} message={t('edit.noMatchMsg')} />
          ) : (
            <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('events.troop.listAria') }}>
              {visible.map((troop) => (
                <TroopRow key={troop.id} troop={troop} selected={troop.id === selected?.id} onSelect={() => slot.onSelectTroop(troop.id)} />
              ))}
            </ScrollArea>
          )}
        </aside>
        <div className={cn('min-h-0 min-w-0 flex-1', selected ? 'flex' : 'hidden @4xl:flex')}>
          {selected ? (
            <TroopDetail key={selected.id} troop={selected} data={data} slot={slot} onBack={() => slot.onSelectTroop(null)} />
          ) : (
            <EmptyState title={t('events.troop.selectHint')} />
          )}
        </div>
      </div>
      {headSlot ? createPortal(filters, headSlot) : null}
    </div>
  )
}
