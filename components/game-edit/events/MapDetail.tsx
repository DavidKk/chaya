'use client'

import { useState } from 'react'
import { IoArrowBack, IoNavigateOutline } from 'react-icons/io5'

import { countKey, type SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, EmptyState, NumberInput, ScrollArea, Spinner } from '@/components/sk'
import { filterToggle, filterToggleOn } from '@/components/sk/control'
import {
  type CommonEventsData,
  estimateActivePage,
  type MapDetailData,
  type MapEventInfo,
  type MapEventType,
  type MapNode,
  SELF_SWITCH_LETTERS,
  type SelfSwitchLetter,
} from '@/lib/game/events'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { refLabel } from './labels'
import { MapEventDetail } from './MapEventDetail'
import type { EventsOp, EventsSlot } from './types'

export const TYPE_KEY: Record<MapEventType, MessageKey> = {
  npc: 'events.map.typeNpc',
  transfer: 'events.map.typeTransfer',
  chest: 'events.map.typeChest',
  trigger: 'events.map.typeTrigger',
  other: 'events.map.typeOther',
}

export type EventState = { kind: 'shown' | 'hidden' | 'unknown'; page: number; exact: boolean }

/** Exact on the player's map, estimated from page conditions elsewhere, unknown offline */
export function eventStateOf(ev: MapEventInfo, detail: MapDetailData, session: SessionState): EventState {
  const live = detail.live
  if (!live) return { kind: 'unknown', page: 0, exact: false }
  if (live.onThisMap) {
    const page = live.activePage[ev.id] ?? 0
    return { kind: page > 0 ? 'shown' : 'hidden', page, exact: true }
  }
  const { page, exact } = estimateActivePage(ev.pages, {
    switches: session.switches,
    variables: session.vars,
    selfOn: live.selfSwitches[ev.id] ?? '',
    itemCount: (id) => session.counts[countKey('item', id)],
  })
  return { kind: page > 0 ? 'shown' : 'hidden', page, exact }
}

export function StateBadge({ state }: { state: EventState }) {
  const t = useT()
  if (state.kind === 'unknown') return <span className="text-ink-soft">{t('events.map.stateUnknown')}</span>
  const label = state.kind === 'shown' ? t('events.map.stateShown') : t('events.map.stateHidden')
  return (
    <span className={cn('whitespace-nowrap text-[0.75rem]', state.kind === 'shown' ? 'text-ok' : 'text-ink-soft')}>
      {label}
      {!state.exact ? <span className="ml-1 text-[0.65rem] text-warn">{t('events.map.stateGuess')}</span> : null}
    </span>
  )
}

const selfBtn =
  'm-0 inline-flex size-6 cursor-pointer items-center justify-center rounded-[0.2rem] border border-line bg-transparent p-0 font-mono text-[0.68rem] text-ink-soft hover:enabled:text-ink disabled:cursor-not-allowed disabled:opacity-60'
const selfBtnOn = 'border-transparent bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] text-accent'

export function SelfSwitches({ mapId, eventId, on, slot }: { mapId: number; eventId: number; on: string | null; slot: EventsSlot }) {
  const t = useT()
  const notify = useNotification()
  const [busy, setBusy] = useState(false)
  if (on == null) return <span className="text-ink-soft">{t('events.map.stateUnknown')}</span>
  const set = async (letter: SelfSwitchLetter, value: boolean) => {
    setBusy(true)
    try {
      await slot.onAct({ op: 'selfSwitch', mapId, eventId, letter, value })
    } catch (err) {
      notify.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex gap-1">
      {SELF_SWITCH_LETTERS.map((letter) => {
        const active = on.includes(letter)
        return (
          <button
            key={letter}
            type="button"
            role="switch"
            aria-checked={active}
            aria-label={t('events.map.selfSwitch', { ch: letter })}
            title={!slot.canAct ? t('events.runNeedLink') : t('events.map.selfSwitch', { ch: letter })}
            disabled={!slot.canAct || busy}
            className={cn(selfBtn, active && selfBtnOn)}
            onClick={() => void set(letter, !active)}
          >
            {letter}
          </button>
        )
      })}
    </span>
  )
}

const tableCols = 'grid-cols-[2.75rem_minmax(8rem,1fr)_4.75rem_4.5rem_6rem_max-content]'

function TeleportSection({ node, data, detail, slot }: { node: MapNode; data: CommonEventsData; detail: MapDetailData | null; slot: EventsSlot }) {
  const t = useT()
  const notify = useNotification()
  const onThisMap = slot.player?.mapId === node.id
  const [x, setX] = useState(onThisMap ? slot.player!.x : 0)
  const [y, setY] = useState(onThisMap ? slot.player!.y : 0)
  const [near, setNear] = useState(true)
  const [busy, setBusy] = useState(false)
  const entrances = data.mapIndex.entrances[node.id] ?? []
  const blocked = !slot.canAct ? t('events.runNeedLink') : !slot.onMap ? t('events.runNeedMap') : ''
  const maxX = detail ? detail.width - 1 : null
  const maxY = detail ? detail.height - 1 : null
  const outOfRange = maxX != null && maxY != null && (x < 0 || y < 0 || x > maxX || y > maxY)
  const name = node.name || `#${node.id}`

  const go = async (op: EventsOp) => {
    setBusy(true)
    try {
      await slot.onAct(op)
      notify.success(t('events.map.teleportOk', { name }))
      slot.afterRun?.()
    } catch (err) {
      notify.error(t('events.map.teleportFail', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  const dir = (d: number) => (d === 2 || d === 4 || d === 6 || d === 8 ? { direction: d as 2 | 4 | 6 | 8 } : {})

  return (
    <section className="border-b border-line px-3 py-2">
      <h3 className="m-0 pb-1.5 text-[0.68rem] font-semibold tracking-[0.05em] text-ink-soft uppercase">{t('events.map.teleport')}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.75rem] text-ink-soft">{t('events.map.teleportCoords')}</span>
        <NumberInput className="w-[6.5rem]" value={x} min={0} max={maxX ?? undefined} aria-label="X" onValueChange={(v) => setX(Math.max(0, Math.floor(v)))} />
        <NumberInput className="w-[6.5rem]" value={y} min={0} max={maxY ?? undefined} aria-label="Y" onValueChange={(v) => setY(Math.max(0, Math.floor(v)))} />
        <button type="button" role="switch" aria-checked={near} className={cn(filterToggle, near && filterToggleOn)} onClick={() => setNear(!near)}>
          {t('events.map.teleportNear')}
        </button>
        <Button
          variant="accent"
          loading={busy}
          disabled={!!blocked || outOfRange}
          tooltip={blocked || (outOfRange ? t('events.map.teleportOutOfRange', { maxX: maxX ?? 0, maxY: maxY ?? 0 }) : undefined)}
          onClick={() => void go({ op: 'teleport', mapId: node.id, x, y, near })}
        >
          <IoNavigateOutline size={15} aria-hidden />
          {t('events.map.teleport')}
        </Button>
      </div>
      <p className="m-0 pt-2 pb-1 text-[0.7rem] text-ink-soft">{t('events.map.teleportEntrances')}</p>
      {entrances.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 pl-0">
          {entrances.slice(0, 12).map((e, i) => {
            const from = refLabel(e.from, data.names, t)
            return (
              <li key={`${e.x}-${e.y}-${i}`}>
                <Button
                  disabled={!!blocked || busy}
                  tooltip={blocked || t('events.map.entranceFrom', { from })}
                  onClick={() => void go({ op: 'teleport', mapId: node.id, x: e.x, y: e.y, ...dir(e.direction) })}
                >
                  ({e.x}, {e.y})
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="m-0 text-xs text-ink-soft">{t('events.map.noEntrances')}</p>
      )}
    </section>
  )
}

/** One map: header, teleport, event table; selecting an event opens its detail in place */
export function MapDetail({ node, data, slot, session }: { node: MapNode; data: CommonEventsData; slot: EventsSlot; session: SessionState }) {
  const t = useT()
  const detail = slot.mapDetail?.mapId === node.id ? slot.mapDetail : null
  const isCurrent = slot.live && slot.player?.mapId === node.id
  const selectedEvent = detail && slot.eventId != null ? (detail.events.find((ev) => ev.id === slot.eventId) ?? null) : null

  if (selectedEvent && detail) {
    return <MapEventDetail key={selectedEvent.id} ev={selectedEvent} node={node} detail={detail} data={data} slot={slot} session={session} />
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-[3rem] shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Button variant="ghost" size="icon" className="@4xl:hidden" aria-label={t('events.back')} tooltip={t('events.back')} onClick={() => slot.onSelectMap(null)}>
          <IoArrowBack size={16} aria-hidden />
        </Button>
        <span className="font-mono text-[0.75rem] text-ink-soft">#{node.id}</span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[0.9rem] font-semibold text-ink">{node.name || `#${node.id}`}</h2>
          <p className="m-0 truncate text-[0.7rem] text-ink-soft">
            {[
              detail?.displayName,
              detail ? t('events.map.size', { width: detail.width, height: detail.height }) : '',
              detail ? t('events.map.eventsCount', { count: detail.events.length }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {isCurrent ? <Badge tone="ok">{t('events.map.current')}</Badge> : null}
      </header>
      <ScrollArea className="min-h-0 flex-1" indicator="both" scrollProps={{ 'aria-label': t('events.map.events') }}>
        <TeleportSection node={node} data={data} detail={detail} slot={slot} />
        {!detail ? (
          slot.mapError ? (
            <EmptyState title={t('events.map.loadFail')} message={slot.mapError} />
          ) : (
            <Spinner size="sm" label={t('events.loading')} />
          )
        ) : !detail.events.length ? (
          <EmptyState title={t('events.map.emptyMap')} />
        ) : (
          <div className="min-w-[36rem] text-[0.8125rem]" role="table" aria-label={t('events.map.events')}>
            <div className={cn('sticky top-0 z-[2] grid items-center border-b border-line bg-paper-2', tableCols)} role="row">
              <div className={editHeadCell} role="columnheader">
                {t('events.map.colId')}
              </div>
              <div className={editHeadCell} role="columnheader">
                {t('events.map.colName')}
              </div>
              <div className={editHeadCell} role="columnheader">
                {t('events.map.colPos')}
              </div>
              <div className={editHeadCell} role="columnheader">
                {t('events.map.colType')}
              </div>
              <div className={editHeadCell} role="columnheader">
                {t('events.map.colState')}
              </div>
              <div className={editHeadCell} role="columnheader">
                {t('events.map.colSelf')}
              </div>
            </div>
            {detail.events.map((ev) => {
              const name = ev.name || `#${ev.id}`
              return (
                <div
                  key={ev.id}
                  className={cn('grid items-center border-t border-line first:border-t-0 hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]', tableCols)}
                  role="row"
                >
                  <div className={cn(editCell, 'font-mono text-[0.75rem] text-ink-soft')} role="cell">
                    {ev.id}
                  </div>
                  <div className={cn(editCell, 'min-w-0')} role="cell">
                    <button
                      type="button"
                      className="m-0 block w-full cursor-pointer truncate border-none bg-transparent p-0 text-left font-medium text-ink underline-offset-2 hover:underline"
                      title={t('events.map.openDetail', { name })}
                      onClick={() => slot.onSelectMap(node.id, ev.id)}
                    >
                      {name}
                    </button>
                  </div>
                  <div className={cn(editCell, 'font-mono text-[0.72rem] text-ink-soft')} role="cell">
                    {ev.x}, {ev.y}
                  </div>
                  <div className={cn(editCell, 'text-[0.75rem] text-ink-soft')} role="cell">
                    {t(TYPE_KEY[ev.type])}
                  </div>
                  <div className={editCell} role="cell">
                    <StateBadge state={eventStateOf(ev, detail, session)} />
                  </div>
                  <div className={editCell} role="cell">
                    <SelfSwitches mapId={node.id} eventId={ev.id} on={detail.live ? (detail.live.selfSwitches[ev.id] ?? '') : null} slot={slot} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}
