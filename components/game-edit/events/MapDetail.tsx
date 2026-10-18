'use client'

import { useState } from 'react'
import { IoArrowBack, IoArrowUndoOutline } from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { countKey, type SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, EmptyState, ScrollArea, Select, TruncateText } from '@/components/sk'
import { filterToggle, filterToggleOn } from '@/components/sk/control'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { type CommonEventsData, estimateActivePage, type MapDetailData, type MapEventInfo, type MapNode, type SelfSwitchLetter } from '@/lib/game/events'
import type { MapOperationItem, MapOperationValue } from '@/lib/runtime/game-link-protocol'
import { cn } from '@/lib/utils'

import { type EventState, TYPE_KEY } from './event-meta'
import { MapEventsTableSkeleton } from './EventsSkeleton'
import { MapEncounters } from './MapEncounters'
import { MapEventDetail } from './MapEventDetail'
import { MapTeleportField } from './MapTeleportField'
import { MiniMap } from './MiniMap'
import type { EventsOp, EventsSlot } from './types'

export { type EventState, TYPE_KEY } from './event-meta'

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

/** Name · position · type · state */
const tableCols = { gridTemplateColumns: '2.25rem minmax(8rem, 1fr) 4.75rem 4.5rem 6rem' }

/** Page-wide "teleport beside the target when it is blocked" switch, shown in the panel header */
export function NearToggle({ near, onChange }: { near: boolean; onChange: (near: boolean) => void }) {
  const t = useT()
  return (
    <Tooltip content={t('events.map.teleportNear')}>
      <button
        type="button"
        role="switch"
        aria-checked={near}
        aria-label={t('events.map.teleportNear')}
        className={cn(filterToggle, 'shrink-0', near && filterToggleOn)}
        onClick={() => onChange(!near)}
      >
        {t('events.map.teleportNearShort')}
      </button>
    </Tooltip>
  )
}

/** Teleport target (follows the player until edited) and the send action */
function useTeleport(node: MapNode, slot: EventsSlot, near: boolean) {
  const t = useT()
  const notify = useNotification()
  const confirm = useConfirm()
  const player = slot.player?.mapId === node.id ? slot.player : null
  const [picked, setPicked] = useState<{ mapId: number; x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const own = picked?.mapId === node.id ? picked : null
  const target = own ?? (player ? { x: player.x, y: player.y } : { x: 0, y: 0 })
  const setTarget = (x: number, y: number) => setPicked({ mapId: node.id, x, y })
  const blocked = !slot.canAct ? t('events.runNeedLink') : !slot.onMap ? t('events.runNeedMap') : ''
  const name = node.name || `#${node.id}`

  /** Every teleport on the map page goes through here, so the "nearby" switch applies to all of them */
  const teleport = async (x: number, y: number) => {
    const op: EventsOp = { op: 'teleport', mapId: node.id, x, y, near }
    setBusy(true)
    try {
      await slot.onAct(op)
      notify.success(t('events.map.teleportOk', { name }))
    } catch (err) {
      notify.error(t('events.map.teleportFail', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  /** First click selects the tile as the target; clicking the selected tile again asks to teleport */
  const pickCell = async (x: number, y: number) => {
    if (own?.x !== x || own?.y !== y) return setTarget(x, y)
    if (blocked || busy) return
    const ok = await confirm({ title: t('events.map.minimapTeleportTitle', { name, x, y }) })
    if (ok) await teleport(x, y)
  }

  return { target, setTarget, near, busy, blocked, teleport, pickCell, player }
}

export type Teleport = ReturnType<typeof useTeleport>

function conditionChanges(event: MapEventInfo, detail: MapDetailData, session: SessionState): MapOperationValue[] {
  const state = eventStateOf(event, detail, session)
  const pageIndex = state.page > 0 ? state.page - 1 : event.pages.length - 1
  const conditions = event.pages[Math.max(0, pageIndex)]?.conditions
  if (!conditions) return []
  const changes: MapOperationValue[] = []
  if (conditions.switch1 && !session.switches[conditions.switch1]) changes.push({ kind: 'switch', id: conditions.switch1, value: true })
  if (conditions.switch2 && !session.switches[conditions.switch2]) changes.push({ kind: 'switch', id: conditions.switch2, value: true })
  if (conditions.variable && Number(session.vars[conditions.variable.id] ?? 0) < conditions.variable.value) {
    changes.push({ kind: 'variable', id: conditions.variable.id, value: conditions.variable.value })
  }
  if (conditions.selfSwitch && !detail.live?.selfSwitches[event.id]?.includes(conditions.selfSwitch)) {
    changes.push({ kind: 'selfSwitch', mapId: detail.mapId, eventId: event.id, letter: conditions.selfSwitch, value: true })
  }
  return changes
}

function targetConditionPage(event: MapEventInfo, detail: MapDetailData, session: SessionState) {
  const state = eventStateOf(event, detail, session)
  return event.pages[Math.max(0, state.page > 0 ? state.page - 1 : event.pages.length - 1)]
}

/** One map: header with the coordinate teleport, mini map, event table; selecting an event opens its detail in place */
export function MapDetail({ node, data, slot, session, near }: { node: MapNode; data: CommonEventsData; slot: EventsSlot; session: SessionState; near: boolean }) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [undoBusy, setUndoBusy] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [batchLetter, setBatchLetter] = useState<SelfSwitchLetter>('A')
  const [batchBusy, setBatchBusy] = useState(false)
  const detail = slot.mapDetail?.mapId === node.id ? slot.mapDetail : null
  const isCurrent = slot.live && slot.player?.mapId === node.id
  const selectedEvent = detail && slot.eventId != null ? (detail.events.find((ev) => ev.id === slot.eventId) ?? null) : null
  const tp = useTeleport(node, slot, near)

  const toggleSelected = (eventId: number, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (!checked) next.delete(eventId)
      else if (next.size < 50) next.add(eventId)
      else notify.error(t('events.map.batchLimit'))
      return next
    })
  }

  const runBatch = async (items: MapOperationItem[], title: string) => {
    if (!detail || !slot.onMapChanges || !selected.size) return
    const accepted = await confirm({
      title,
      description: items.map((item) => item.label).join('、'),
      confirmVariant: 'warn',
    })
    if (!accepted) return
    setBatchBusy(true)
    try {
      const reply = (await slot.onMapChanges(items, title)) as {
        status?: { completed?: number; failed?: number; skipped?: number; items?: Array<{ label: string; state: string; error?: string }> }
      }
      const completed = reply.status?.completed ?? items.length
      const failed = reply.status?.failed ?? 0
      const skipped = reply.status?.skipped ?? 0
      const problems = reply.status?.items?.filter((item) => item.state !== 'completed').map((item) => `${item.label}: ${item.error || item.state}`) ?? []
      const summary = t('events.map.batchSummary', { completed, failed, skipped })
      if (failed || skipped) notify.error(problems.length ? `${summary} · ${problems.join('；')}` : summary)
      else notify.success(summary)
      slot.onReloadMap?.()
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBatchBusy(false)
    }
  }

  const batchSelfSwitch = (value: boolean) => {
    if (!detail) return
    const title = t(value ? 'events.map.batchSelfOn' : 'events.map.batchSelfOff', { ch: batchLetter })
    const items = detail.events
      .filter((event) => selected.has(event.id))
      .map((event) => ({
        label: `${event.name || `#${event.id}`} (#${event.id})${event.pages.some((page) => page.trigger === 3 && page.conditions.selfSwitch === batchLetter) && value ? ` · ${t('events.map.batchAutorun')}` : ''}`,
        changes: [{ kind: 'selfSwitch' as const, mapId: node.id, eventId: event.id, letter: batchLetter, value }],
      }))
    return runBatch(items, title)
  }

  const satisfyConditions = () => {
    if (!detail) return
    const items = detail.events
      .filter((event) => selected.has(event.id))
      .map((event) => ({
        label: `${event.name || `#${event.id}`} (#${event.id})${targetConditionPage(event, detail, session)?.trigger === 3 ? ` · ${t('events.map.batchAutorun')}` : ''}`,
        changes: conditionChanges(event, detail, session),
      }))
    return runBatch(items, t('events.map.batchSatisfy'))
  }

  const undo = async () => {
    if (!slot.onMapUndo || !slot.mapUndo) return
    setUndoBusy(true)
    try {
      let result = await slot.onMapUndo(false)
      if (result.conflicts?.length) {
        const force = await confirm({
          title: t('data.undoConflictTitle'),
          description: t('data.undoConflictDesc'),
          confirmLabel: t('data.undoForce'),
          confirmVariant: 'warn',
        })
        if (!force) return
        result = await slot.onMapUndo(true)
      }
      notify.success(t('data.undoDone'))
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      setUndoBusy(false)
    }
  }

  if (selectedEvent && detail) {
    return <MapEventDetail key={selectedEvent.id} ev={selectedEvent} node={node} detail={detail} data={data} slot={slot} session={session} tp={tp} />
  }

  const miniMap = detail ? (
    <MiniMap
      inline
      detail={detail}
      player={tp.player}
      target={tp.target}
      stateOf={(id) => {
        const ev = detail.events.find((e) => e.id === id)
        return ev ? eventStateOf(ev, detail, session) : { kind: 'unknown', page: 0, exact: false }
      }}
      near={tp.near}
      disabled={!!tp.blocked || tp.busy}
      onPickCell={(x, y) => void tp.pickCell(x, y)}
      onSelectEvent={(id) => slot.onSelectMap(node.id, id)}
    />
  ) : null

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-line px-3">
        <Button variant="ghost" size="icon" className="@4xl:hidden" aria-label={t('events.back')} tooltip={t('events.back')} onClick={() => slot.onSelectMap(null)}>
          <IoArrowBack size={16} aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="m-0 flex min-w-0 text-[0.9rem] font-semibold text-ink">
              <TruncateText text={node.name || `#${node.id}`} />
            </h2>
            {isCurrent ? (
              <Badge dot={false} tone="info" className="shrink-0">
                {t('events.map.current')}
              </Badge>
            ) : null}
          </div>
          <p className="m-0 flex min-w-0 text-[0.7rem] text-ink-soft">
            <TruncateText
              text={[
                detail?.displayName,
                detail ? t('events.map.size', { width: detail.width, height: detail.height }) : '',
                detail ? t('events.map.eventsCount', { count: detail.events.length }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          loading={undoBusy}
          disabled={!slot.mapUndo || !slot.onMapUndo}
          aria-label={slot.mapUndo ? t('data.undoTip', { summary: slot.mapUndo.summary }) : t('data.undoEmpty')}
          tooltip={slot.mapUndo ? t('data.undoTip', { summary: slot.mapUndo.summary }) : t('data.undoEmpty')}
          onClick={() => void undo()}
        >
          <IoArrowUndoOutline size={16} aria-hidden />
        </Button>
        <MapTeleportField
          x={tp.target.x}
          y={tp.target.y}
          width={detail?.width ?? null}
          height={detail?.height ?? null}
          busy={tp.busy}
          blocked={tp.blocked}
          onChange={tp.setTarget}
          onTeleport={() => void tp.teleport(tp.target.x, tp.target.y)}
        />
      </header>
      <ScrollArea className="min-h-0 flex-1" indicator="both" reserveGutter={false} scrollProps={{ 'aria-label': t('events.map.events') }}>
        {miniMap}
        {!detail ? (
          slot.mapError ? (
            <EmptyState title={t('events.map.loadFail')} message={slot.mapError}>
              {slot.onReloadMap ? (
                <Button loading={slot.mapLoading} onClick={slot.onReloadMap}>
                  {t('common.retry')}
                </Button>
              ) : null}
            </EmptyState>
          ) : (
            <MapEventsTableSkeleton />
          )
        ) : (
          <MapEncounters detail={detail} data={data} slot={slot} />
        )}
        {!detail ? null : !detail.events.length ? (
          <EmptyState title={t('events.map.emptyMap')} />
        ) : (
          <div className="text-[0.8125rem]" style={{ minWidth: '28rem' }} role="list" aria-label={t('events.map.events')}>
            {selected.size ? (
              <div className="sticky top-0 z-[3] flex h-10 items-center gap-2 border-b border-line bg-panel-2 px-2">
                <span className="mr-auto text-xs text-ink-soft">{t('events.map.batchSelected', { count: selected.size })}</span>
                <Select
                  className="w-16"
                  value={batchLetter}
                  options={(['A', 'B', 'C', 'D'] as const).map((letter) => ({ value: letter, label: letter }))}
                  onChange={(letter) => setBatchLetter(letter as SelfSwitchLetter)}
                  aria-label={t('data.selfSwitchLetter')}
                />
                <Button size="mini" loading={batchBusy} disabled={!slot.onMapChanges} onClick={() => void batchSelfSwitch(true)}>
                  {t('events.stateOn')}
                </Button>
                <Button size="mini" loading={batchBusy} disabled={!slot.onMapChanges} onClick={() => void batchSelfSwitch(false)}>
                  {t('events.stateOff')}
                </Button>
                <Button size="mini" loading={batchBusy} disabled={!slot.onMapChanges} onClick={() => void satisfyConditions()}>
                  {t('events.map.batchSatisfyShort')}
                </Button>
              </div>
            ) : null}
            <div className="sticky top-0 z-[2] grid h-9 items-center border-b border-line bg-paper-2" style={tableCols} role="presentation">
              <div className={editHeadCell} data-list-heading="">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === Math.min(50, detail.events.length)}
                  aria-label={t('events.map.batchSelected', { count: selected.size })}
                  onChange={(event) => setSelected(event.target.checked ? new Set(detail.events.slice(0, 50).map((item) => item.id)) : new Set())}
                />
              </div>
              <div className={editHeadCell} data-list-heading="">
                {t('events.map.colName')}
              </div>
              <div className={editHeadCell} data-list-heading="">
                {t('events.map.colPos')}
              </div>
              <div className={editHeadCell} data-list-heading="">
                {t('events.map.colType')}
              </div>
              <div className={editHeadCell} data-list-heading="">
                {t('events.map.colState')}
              </div>
            </div>
            {detail.events.map((ev, index) => {
              const name = ev.name || `#${ev.id}`
              return (
                <div
                  key={ev.id}
                  data-navigation-id={`map-event:${node.id}:${ev.id}`}
                  className={cn('grid items-center border-t border-line hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]', index === 0 && 'border-t-0')}
                  style={tableCols}
                  role="listitem"
                >
                  <div className={editCell} data-list-cell="">
                    <input type="checkbox" checked={selected.has(ev.id)} aria-label={name} onChange={(event) => toggleSelected(ev.id, event.target.checked)} />
                  </div>
                  <div className={cn(editCell, 'min-w-0')} data-list-cell="">
                    <button
                      type="button"
                      className="m-0 flex w-full min-w-0 cursor-pointer border-none bg-transparent p-0 text-left font-medium text-ink underline-offset-2 hover:underline"
                      aria-label={t('events.map.openDetail', { name })}
                      data-navigation-trigger=""
                      onClick={() => slot.onSelectMap(node.id, ev.id)}
                    >
                      <TruncateText text={name} />
                    </button>
                  </div>
                  <div className={cn(editCell, 'font-mono text-[0.72rem] text-ink-soft')} data-list-cell="">
                    <Tooltip content={tp.blocked || t(tp.near ? 'events.map.teleportBeside' : 'events.map.teleportTo', { name })}>
                      <button
                        type="button"
                        className="m-0 cursor-pointer border-none bg-transparent p-0 font-mono text-[0.72rem] text-ink-soft underline-offset-2 hover:text-accent hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:hover:text-ink-soft"
                        disabled={!!tp.blocked || tp.busy}
                        aria-label={t(tp.near ? 'events.map.teleportBeside' : 'events.map.teleportTo', { name })}
                        onClick={() => void tp.teleport(ev.x, ev.y)}
                      >
                        {ev.x},{ev.y}
                      </button>
                    </Tooltip>
                  </div>
                  <div className={cn(editCell, 'text-[0.75rem] text-ink-soft')} data-list-cell="">
                    {t(TYPE_KEY[ev.type])}
                  </div>
                  <div className={editCell} data-list-cell="">
                    <StateBadge state={eventStateOf(ev, detail, session)} />
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
