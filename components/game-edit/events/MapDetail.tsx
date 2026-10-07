'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { IoArrowBack } from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { countKey, type SessionState } from '@/components/game-edit/types'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, EmptyState, ScrollArea, TruncateText } from '@/components/sk'
import { filterToggle, filterToggleOn } from '@/components/sk/control'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { type CommonEventsData, estimateActivePage, type MapDetailData, type MapEventInfo, type MapNode } from '@/lib/game/events'
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
const tableCols = { gridTemplateColumns: 'minmax(8rem, 1fr) 4.75rem 4.5rem 6rem' }

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

/** One map: header with the coordinate teleport, mini map, event table; selecting an event opens its detail in place */
export function MapDetail({
  node,
  data,
  slot,
  session,
  near,
  toolRequest,
  showMiniMap = true,
}: {
  node: MapNode
  data: CommonEventsData
  slot: EventsSlot
  session: SessionState
  near: boolean
  toolRequest?: GameAgentRequest
  showMiniMap?: boolean
}) {
  const t = useT()
  const detail = slot.mapDetail?.mapId === node.id ? slot.mapDetail : null
  const isCurrent = slot.live && slot.player?.mapId === node.id
  const selectedEvent = detail && slot.eventId != null ? (detail.events.find((ev) => ev.id === slot.eventId) ?? null) : null
  const tp = useTeleport(node, slot, near)
  const toolSettings = useToolSettings(toolRequest)
  const panel = useToolPanelVisibility('miniMap', toolSettings.settings.miniMapEnabled)
  const miniMap =
    showMiniMap && detail && panel.visible ? (
      <MiniMap
        detail={detail}
        player={tp.player}
        target={tp.target}
        stateOf={(id) => {
          const ev = detail.events.find((e) => e.id === id)
          return ev ? eventStateOf(ev, detail, session) : { kind: 'unknown', page: 0, exact: false }
        }}
        near={tp.near}
        disabled={!!tp.blocked || tp.busy}
        onClose={panel.dismiss}
        onPickCell={(x, y) => void tp.pickCell(x, y)}
        onSelectEvent={(id) => slot.onSelectMap(node.id, id)}
      />
    ) : null
  const overlayRoot = typeof document !== 'undefined' ? document.getElementById('chaya-game-edit-host')?.shadowRoot : null
  const floatingMap = miniMap && overlayRoot ? createPortal(miniMap, overlayRoot) : miniMap

  if (selectedEvent && detail) {
    return (
      <>
        {floatingMap}
        <MapEventDetail key={selectedEvent.id} ev={selectedEvent} node={node} detail={detail} data={data} slot={slot} session={session} tp={tp} />
      </>
    )
  }

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
        {floatingMap}
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
          <div className="text-[0.8125rem]" style={{ minWidth: '24rem' }} role="table" aria-label={t('events.map.events')}>
            <div className="sticky top-0 z-[2] grid h-9 items-center border-b border-line bg-paper-2" style={tableCols} role="row">
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
            </div>
            {detail.events.map((ev, index) => {
              const name = ev.name || `#${ev.id}`
              return (
                <div
                  key={ev.id}
                  className={cn('grid items-center border-t border-line hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]', index === 0 && 'border-t-0')}
                  style={tableCols}
                  role="row"
                >
                  <div className={cn(editCell, 'min-w-0')} role="cell">
                    <button
                      type="button"
                      className="m-0 flex w-full min-w-0 cursor-pointer border-none bg-transparent p-0 text-left font-medium text-ink underline-offset-2 hover:underline"
                      aria-label={t('events.map.openDetail', { name })}
                      onClick={() => slot.onSelectMap(node.id, ev.id)}
                    >
                      <TruncateText text={name} />
                    </button>
                  </div>
                  <div className={cn(editCell, 'font-mono text-[0.72rem] text-ink-soft')} role="cell">
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
                  <div className={cn(editCell, 'text-[0.75rem] text-ink-soft')} role="cell">
                    {t(TYPE_KEY[ev.type])}
                  </div>
                  <div className={editCell} role="cell">
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
