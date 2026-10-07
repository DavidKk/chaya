'use client'

import { useMemo, useState } from 'react'
import { IoChevronDown, IoChevronForward } from 'react-icons/io5'

import type { SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { padXDense } from '@/components/layoutClasses'
import { EmptyState, ScrollArea, SegmentedNav, TruncateText } from '@/components/sk'
import { filterToggle, filterToggleOn } from '@/components/sk/control'
import { type CommonEventFilter, type CommonEventInfo, filterCommonEventGroups } from '@/lib/game/events'
import { cn } from '@/lib/utils'

import { CommonEventDetail } from './CommonEventDetail'
import { EventsPaneSkeleton, type EventsSkeletonHead } from './EventsSkeleton'
import { commonEventName } from './labels'
import type { EventsSlot } from './types'

type TriggerFilter = 'all' | '0' | '1' | '2'

type Props = {
  slot: EventsSlot
  filter: string
  session: SessionState
}

const listRow = cn(
  'flex w-full cursor-pointer items-center gap-2 border-none border-b border-line bg-transparent py-1.5 text-left text-[0.8125rem] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]',
  padXDense
)
const listRowOn = 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]'

/** Status pane shared by both events pages: unavailable / failed / loading / empty */
export function EventsDataState({ slot, head }: { slot: EventsSlot; head: EventsSkeletonHead }) {
  const t = useT()
  if (slot.unavailable) return <EmptyState title={t('events.needLink')} message={t('events.needLinkMsg')} />
  if (slot.error && !slot.data) return <EmptyState title={t('events.loadFail')} message={slot.error} />
  if (!slot.data) return <EventsPaneSkeleton head={head} />
  if (head === 'troop') return <EmptyState title={t('events.troop.empty')} message={t('events.troop.emptyMsg')} />
  return <EmptyState title={t('events.noData')} message={t('events.noDataMsg')} />
}

function EventRow({
  ev,
  selected,
  live,
  switchOn,
  running,
  onSelect,
}: {
  ev: CommonEventInfo
  selected: boolean
  live: boolean
  switchOn: boolean
  running: boolean
  onSelect: () => void
}) {
  const t = useT()
  const name = commonEventName(ev, t)
  return (
    <button type="button" className={cn(listRow, selected && listRowOn)} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      <TruncateText text={name} className={cn('flex-1', ev.commandCount === 0 ? 'text-ink-soft' : 'text-ink')} />
      {ev.commandCount === 0 ? <span className="shrink-0 text-[0.65rem] text-ink-soft">{t('events.emptyEvent')}</span> : null}
      {ev.trigger !== 0 ? (
        <span className={cn('shrink-0 text-[0.65rem]', ev.trigger === 1 ? 'text-warn' : 'text-info')}>
          {t(ev.trigger === 1 ? 'events.trigger1' : 'events.trigger2')}
          {live ? ` · ${running ? t('events.running') : switchOn ? t('events.stateOn') : t('events.stateOff')}` : ''}
        </span>
      ) : null}
    </button>
  )
}

/** 修改 › 公共事件: grouped list + detail; narrow containers show one at a time */
export function CommonEventsPane({ slot, filter, session }: Props) {
  const switches = session.switches
  const t = useT()
  const [trigger, setTrigger] = useState<TriggerFilter>('all')
  const [showEmpty, setShowEmpty] = useState(false)
  const [onlyUncalled, setOnlyUncalled] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
  const data = slot.data

  const criteria: CommonEventFilter = useMemo(
    () => ({ trigger: trigger === 'all' ? 'all' : (Number(trigger) as 0 | 1 | 2), query: filter, showEmpty, onlyUncalled }),
    [trigger, filter, showEmpty, onlyUncalled]
  )
  const groups = useMemo(() => (data ? filterCommonEventGroups(data, criteria) : []), [data, criteria])
  const visibleCount = groups.reduce((n, g) => n + g.events.length, 0)
  const selected = data && slot.commonId != null ? (data.events.find((ev) => ev.id === slot.commonId) ?? null) : null

  if (!data || !data.events.length) return <EventsDataState slot={slot} head="common" />

  const triggerItems = [
    { id: 'all' as const, label: t('events.filterAll') },
    { id: '0' as const, label: t('events.trigger0') },
    { id: '1' as const, label: t('events.trigger1') },
    { id: '2' as const, label: t('events.trigger2') },
  ]
  const uncalledHint = onlyUncalled && (!data.mapsScanned || data.mapsFailed > 0)

  const toggleGroup = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn('min-h-0 w-full flex-col @4xl:w-[17rem] @4xl:shrink-0 @4xl:border-r @4xl:border-line', selected ? 'hidden @4xl:flex' : 'flex')}
          aria-label={t('events.listAria')}
        >
          <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2">
            <SegmentedNav items={triggerItems} value={trigger} onChange={setTrigger} aria-label={t('events.filterAria')} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" role="switch" aria-checked={showEmpty} className={cn(filterToggle, showEmpty && filterToggleOn)} onClick={() => setShowEmpty(!showEmpty)}>
                {t('events.showEmpty')}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={onlyUncalled}
                className={cn(filterToggle, onlyUncalled && filterToggleOn)}
                onClick={() => setOnlyUncalled(!onlyUncalled)}
              >
                {t('events.onlyUncalled')}
              </button>
            </div>
            {uncalledHint ? <p className="m-0 text-[0.7rem] leading-[1.45] text-warn">{t('events.uncalledMayOver')}</p> : null}
          </div>
          {visibleCount === 0 ? (
            <EmptyState title={t('edit.noMatch')} message={t('edit.noMatchMsg')} />
          ) : (
            <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('events.listAria') }}>
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.id)
                return (
                  <div key={group.id} role="group" aria-label={group.title || undefined}>
                    {group.title ? (
                      <button
                        type="button"
                        className="sticky top-0 z-[1] flex w-full cursor-pointer items-center gap-1 border-none border-b border-line bg-paper-2 px-3 py-1 text-left text-[0.68rem] font-semibold tracking-[0.04em] text-ink-soft hover:text-ink"
                        aria-expanded={!isCollapsed}
                        aria-label={t('events.groupToggle', { name: group.title })}
                        onClick={() => toggleGroup(group.id)}
                      >
                        {isCollapsed ? <IoChevronForward size={11} aria-hidden /> : <IoChevronDown size={11} aria-hidden />}
                        <TruncateText text={group.title} className="flex-1" />
                        <span className="font-mono font-normal">{group.events.length}</span>
                      </button>
                    ) : null}
                    {isCollapsed
                      ? null
                      : group.events.map((ev) => (
                          <EventRow
                            key={ev.id}
                            ev={ev}
                            selected={ev.id === selected?.id}
                            live={slot.live}
                            switchOn={!!switches[ev.switchId]}
                            running={!!slot.runningCommon?.includes(ev.id)}
                            onSelect={() => slot.onSelectCommon(ev.id)}
                          />
                        ))}
                  </div>
                )
              })}
            </ScrollArea>
          )}
        </aside>
        <div className={cn('min-h-0 min-w-0 flex-1', selected ? 'flex' : 'hidden @4xl:flex')}>
          {selected ? (
            <CommonEventDetail key={selected.id} event={selected} data={data} slot={slot} session={session} onBack={() => slot.onSelectCommon(null)} />
          ) : (
            <EmptyState title={t('events.selectHint')} />
          )}
        </div>
      </div>
    </div>
  )
}
