'use client'

import { useCallback, useMemo, useState } from 'react'
import { IoArrowBack, IoArrowUndoOutline, IoChatbubbleEllipsesOutline, IoEnterOutline, IoExitOutline, IoGiftOutline, IoNavigateOutline, IoPersonOutline } from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { countKey, type SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, EmptyState, FilterToggle, ScrollArea, SegmentedNav, type SegmentedNavItem, Select, TruncateText } from '@/components/sk'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { type CommonEventsData, estimateActivePage, type MapDetailData, type MapEventInfo, type MapNode, type SelfSwitchLetter } from '@/lib/game/events'
import type { MapOperationItem, MapOperationValue } from '@/lib/runtime/game-link-protocol'
import { cn } from '@/lib/utils'

import {
  type EntranceResolvedInfo,
  type EventState,
  isChestEvent,
  isNpcEvent,
  isTransferEvent,
  resolveChestInfo,
  resolveEntranceInfo,
  resolveNpcInfo,
  resolveTransferInfo,
  TYPE_KEY,
} from './event-meta'
import { MapEventsTableSkeleton } from './EventsSkeleton'
import { MapEncounters } from './MapEncounters'
import { MapEventDetail } from './MapEventDetail'
import { MapTeleportField } from './MapTeleportField'
import { MiniMap } from './MiniMap'
import type { EventsOp, EventsSlot } from './types'

export {
  type EntranceResolvedInfo,
  type EventState,
  isChestEvent,
  isGenericEventName,
  isNpcEvent,
  isTransferEvent,
  resolveChestInfo,
  resolveEntranceInfo,
  resolveNpcInfo,
  resolveTransferInfo,
  TYPE_KEY,
} from './event-meta'

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
      <FilterToggle pressed={near} onPressedChange={onChange} aria-label={t('events.map.teleportNear')}>
        {t('events.map.teleportNearShort')}
      </FilterToggle>
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
export type MapEventTab = 'all' | 'npc' | 'chest' | 'transfer' | 'entrance'

export type MapNpcItem = {
  key: string
  name: string
  rawName: string
  isGeneric: boolean
  npcInfo: ReturnType<typeof resolveNpcInfo>
  primaryEvent: MapEventInfo
  events: MapEventInfo[]
  state: EventState
  teleportX: number
  teleportY: number
}

export type MapChestItem = {
  event: MapEventInfo
  name: string
  rewardText: string
  rewards: string[]
  isOpened: boolean
  state: EventState
}

export type MapTransferItem = {
  event: MapEventInfo
  name: string
  targetMapId: number
  targetMapName: string
  targetCoords?: { x: number; y: number }
  state: EventState
}

export type MapEntranceItem = EntranceResolvedInfo & {
  key: string
}

export function MapDetail({
  node,
  data,
  slot,
  session,
  near,
  filter,
}: {
  node: MapNode
  data: CommonEventsData
  slot: EventsSlot
  session: SessionState
  near: boolean
  filter?: string
}) {
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

  const query = filter?.trim().toLowerCase() || ''
  const isMatch = useCallback(
    (ev: MapEventInfo) => {
      if (!query) return false
      const npcInfo = resolveNpcInfo(ev, detail?.texts, data.names.actors)
      const chestInfo = resolveChestInfo(ev, data.names, detail ?? undefined)
      const transferInfo = resolveTransferInfo(ev, data.names.maps)
      return (
        (npcInfo.name && npcInfo.name.toLowerCase().includes(query)) ||
        (ev.name && ev.name.toLowerCase().includes(query)) ||
        (ev.rawName && ev.rawName.toLowerCase().includes(query)) ||
        (npcInfo.faceName && npcInfo.faceName.toLowerCase().includes(query)) ||
        (npcInfo.characterName && npcInfo.characterName.toLowerCase().includes(query)) ||
        (npcInfo.dialogueSnippet && npcInfo.dialogueSnippet.toLowerCase().includes(query)) ||
        (chestInfo.name && chestInfo.name.toLowerCase().includes(query)) ||
        (chestInfo.rewardText && chestInfo.rewardText.toLowerCase().includes(query)) ||
        (transferInfo.name && transferInfo.name.toLowerCase().includes(query)) ||
        (transferInfo.targetMapName && transferInfo.targetMapName.toLowerCase().includes(query)) ||
        String(ev.id) === query
      )
    },
    [data.names, detail, query]
  )

  const sortedEvents: MapEventInfo[] = useMemo(() => {
    const list = detail?.events
    if (!list) return []
    if (!query) return list
    return [...list].sort((a, b) => {
      const aHit = isMatch(a) ? 1 : 0
      const bHit = isMatch(b) ? 1 : 0
      if (aHit !== bHit) return bHit - aHit
      return a.id - b.id
    })
  }, [detail?.events, isMatch, query])

  const [eventTab, setEventTab] = useState<MapEventTab>('all')

  const npcList: MapNpcItem[] = useMemo(() => {
    if (!detail?.events) return []
    const map = new Map<string, MapNpcItem>()

    for (const ev of sortedEvents) {
      if (!isNpcEvent(ev, detail.texts, data.names.actors)) continue
      const info = resolveNpcInfo(ev, detail.texts, data.names.actors)
      const evState = eventStateOf(ev, detail, session)
      const groupKey = info.name.trim() || `#${ev.id}`

      const existing = map.get(groupKey)
      if (!existing) {
        map.set(groupKey, {
          key: groupKey,
          name: info.name,
          rawName: info.rawName,
          isGeneric: info.isGeneric,
          npcInfo: info,
          primaryEvent: ev,
          events: [ev],
          state: evState,
          teleportX: ev.x,
          teleportY: ev.y,
        })
      } else {
        existing.events.push(ev)
        if (evState.kind === 'shown' && existing.state.kind !== 'shown') {
          existing.primaryEvent = ev
          existing.state = evState
          existing.teleportX = ev.x
          existing.teleportY = ev.y
          if (info.dialogueSnippet && !existing.npcInfo.dialogueSnippet) {
            existing.npcInfo = info
          }
        }
      }
    }
    return Array.from(map.values())
  }, [data.names.actors, detail, session, sortedEvents])

  const chestList: MapChestItem[] = useMemo(() => {
    if (!detail?.events) return []
    return sortedEvents.filter(isChestEvent).map((ev) => {
      const info = resolveChestInfo(ev, data.names, detail)
      return {
        event: ev,
        name: info.name,
        rewardText: info.rewardText,
        rewards: info.rewards,
        isOpened: info.isOpened,
        state: eventStateOf(ev, detail, session),
      }
    })
  }, [data.names, detail, session, sortedEvents])

  const transferList: MapTransferItem[] = useMemo(() => {
    if (!detail?.events) return []
    return sortedEvents.filter(isTransferEvent).map((ev) => {
      const info = resolveTransferInfo(ev, data.names.maps)
      return {
        event: ev,
        name: info.name,
        targetMapId: info.targetMapId,
        targetMapName: info.targetMapName,
        targetCoords: info.targetCoords,
        state: eventStateOf(ev, detail, session),
      }
    })
  }, [data.names.maps, detail, session, sortedEvents])

  const rawEntrances = useMemo(() => {
    return data.mapIndex.entrances[node.id] || []
  }, [data.mapIndex.entrances, node.id])

  const entranceList: MapEntranceItem[] = useMemo(() => {
    return rawEntrances.map((ent, idx) => {
      const resolved = resolveEntranceInfo(ent, data.names)
      return {
        ...resolved,
        key: `${ent.from.kind}:${ent.from.id}:${ent.from.eventId ?? 0}:${ent.from.page ?? 0}:${ent.x}:${ent.y}:${idx}`,
      }
    })
  }, [data.names, rawEntrances])

  const isEntranceMatch = useCallback(
    (item: MapEntranceItem) => {
      if (!query) return false
      const q = query.toLowerCase()
      return (
        item.sourceName.toLowerCase().includes(q) ||
        (item.sourceEventName && item.sourceEventName.toLowerCase().includes(q)) ||
        item.title.toLowerCase().includes(q) ||
        String(item.sourceId) === q ||
        String(item.sourceEventId) === q ||
        `${item.x},${item.y}`.includes(q)
      )
    },
    [query]
  )

  const displayedEntrances = useMemo(() => {
    if (!query) return entranceList
    return entranceList.filter(isEntranceMatch)
  }, [entranceList, isEntranceMatch, query])

  const displayedEvents = sortedEvents

  const navItems: readonly SegmentedNavItem<MapEventTab>[] = useMemo(
    () => [
      { id: 'all', label: `${t('events.map.tabAllEvents')} (${detail?.events.length ?? 0})` },
      { id: 'npc', label: `${t('events.map.tabNpc')} (${npcList.length})` },
      { id: 'chest', label: `${t('events.map.tabChest')} (${chestList.length})` },
      { id: 'transfer', label: `${t('events.map.tabTransfer')} (${transferList.length})` },
      { id: 'entrance', label: `${t('events.map.tabEntrance')} (${entranceList.length})` },
    ],
    [t, detail?.events.length, npcList.length, chestList.length, transferList.length, entranceList.length]
  )

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
      activeFilter={filter}
      subTab={eventTab}
      entrances={rawEntrances}
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
          <EmptyState title={t('events.map.emptyMap')} className="min-h-full" />
        ) : (
          <div className="flex min-h-full flex-1 flex-col text-[0.8125rem]" style={{ minWidth: '28rem' }} role="list" aria-label={t('events.map.events')}>
            <div className="flex items-center justify-between border-b border-line bg-paper-2 px-3 py-1.5">
              <SegmentedNav items={navItems} value={eventTab} onChange={setEventTab} aria-label={t('events.map.events')} />
            </div>
            {eventTab === 'npc' ? (
              npcList.length === 0 ? (
                <EmptyState title={t('events.map.emptyNpc')} message={t('events.map.emptyNpcMsg')} className="min-h-full flex-1" />
              ) : (
                <div className="flex flex-col divide-y divide-line/60">
                  <div className="flex items-center justify-between border-b border-line bg-paper-2 px-3 py-1.5 text-xs text-ink-soft">
                    <span className="font-medium text-ink">
                      {t('events.map.colNpc')} ({npcList.length})
                    </span>
                    <span className="text-[0.7rem] text-ink-soft/75">点击卡片可查看对应事件详情</span>
                  </div>
                  {npcList.map((npc) => {
                    const hit = isMatch(npc.primaryEvent)
                    return (
                      <div
                        key={npc.key}
                        data-navigation-id={`map-event:${node.id}:${npc.primaryEvent.id}`}
                        role="listitem"
                        className={cn('group flex items-start gap-3 p-3 transition-colors hover:bg-paper-2/70', hit && 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]')}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line/80 bg-paper-1 text-accent shadow-xs">
                          <IoPersonOutline className="text-[1.2rem]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              className="m-0 cursor-pointer border-none bg-transparent p-0 text-left font-semibold text-ink text-[0.875rem] underline-offset-2 hover:text-accent hover:underline"
                              onClick={() => slot.onSelectMap(node.id, npc.primaryEvent.id)}
                              aria-label={t('events.map.openDetail', { name: npc.name })}
                            >
                              {npc.name}
                            </button>
                            <StateBadge state={npc.state} />
                            {npc.events.map((ev) => (
                              <button
                                key={ev.id}
                                type="button"
                                onClick={() => slot.onSelectMap(node.id, ev.id)}
                                className="shrink-0 rounded-[0.2rem] border border-line/60 bg-paper-1/80 px-1.5 py-0.5 font-mono text-[0.68rem] text-ink-soft hover:border-accent hover:text-accent"
                                title={t('events.map.openDetail', { name: `${npc.name} #${ev.id}` })}
                              >
                                #{ev.id} ({ev.x},{ev.y})
                              </button>
                            ))}
                            {(npc.npcInfo.faceName || npc.npcInfo.characterName) && (
                              <span className="shrink-0 rounded-[0.2rem] bg-accent/10 px-1.5 py-0.5 font-mono text-[0.65rem] text-accent">
                                {npc.npcInfo.faceName || npc.npcInfo.characterName}
                              </span>
                            )}
                            {hit && <span className="shrink-0 rounded-[0.2rem] bg-accent/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent">NPC 匹配</span>}
                          </div>
                          {npc.npcInfo.dialogueSnippet ? (
                            <div className="mt-1 flex items-start gap-1 text-[0.76rem] text-ink-soft">
                              <IoChatbubbleEllipsesOutline className="mt-0.5 shrink-0 text-accent/70" />
                              <span className="italic line-clamp-2">“{npc.npcInfo.dialogueSnippet}”</span>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          <Tooltip content={tp.blocked || t(tp.near ? 'events.map.teleportBeside' : 'events.map.teleportTo', { name: npc.name })}>
                            <Button
                              size="mini"
                              variant="ghost"
                              disabled={!!tp.blocked || tp.busy}
                              onClick={() => void tp.teleport(npc.teleportX, npc.teleportY)}
                              className="flex items-center gap-1 font-mono text-[0.72rem]"
                            >
                              <IoNavigateOutline className="text-accent text-[0.85rem]" />
                              <span>
                                {npc.teleportX},{npc.teleportY}
                              </span>
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : eventTab === 'chest' ? (
              chestList.length === 0 ? (
                <EmptyState title={t('events.map.emptyChest')} message={t('events.map.emptyChestMsg')} className="min-h-full flex-1" />
              ) : (
                <div className="flex flex-col divide-y divide-line/60">
                  <div className="flex items-center justify-between border-b border-line bg-paper-2 px-3 py-1.5 text-xs text-ink-soft">
                    <span className="font-medium text-ink">
                      {t('events.map.tabChest')} ({chestList.length})
                    </span>
                    <span className="text-[0.7rem] text-ink-soft/75">点击卡片可查看对应事件详情</span>
                  </div>
                  {chestList.map((chest) => {
                    const hit = isMatch(chest.event)
                    return (
                      <div
                        key={chest.event.id}
                        data-navigation-id={`map-event:${node.id}:${chest.event.id}`}
                        role="listitem"
                        className={cn('group flex items-start gap-3 p-3 transition-colors hover:bg-paper-2/70', hit && 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]')}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-500 shadow-xs">
                          <IoGiftOutline className="text-[1.2rem]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              className="m-0 cursor-pointer border-none bg-transparent p-0 text-left font-semibold text-ink text-[0.875rem] underline-offset-2 hover:text-accent hover:underline"
                              onClick={() => slot.onSelectMap(node.id, chest.event.id)}
                              aria-label={t('events.map.openDetail', { name: chest.name })}
                            >
                              {chest.name}
                            </button>
                            <Badge dot={false} tone={chest.isOpened ? 'neutral' : 'ok'} className="text-[0.68rem]">
                              {chest.isOpened ? t('events.map.chestOpened') : t('events.map.chestUnopened')}
                            </Badge>
                            <button
                              type="button"
                              onClick={() => slot.onSelectMap(node.id, chest.event.id)}
                              className="shrink-0 rounded-[0.2rem] border border-line/60 bg-paper-1/80 px-1.5 py-0.5 font-mono text-[0.68rem] text-ink-soft hover:border-accent hover:text-accent"
                              title={t('events.map.openDetail', { name: `${chest.name} #${chest.event.id}` })}
                            >
                              #{chest.event.id} ({chest.event.x},{chest.event.y})
                            </button>
                            {hit && <span className="shrink-0 rounded-[0.2rem] bg-accent/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent">宝箱匹配</span>}
                          </div>
                          {chest.rewardText ? (
                            <div className="mt-1 flex items-center gap-1.5 text-[0.76rem] text-ink-soft">
                              <span className="font-medium text-amber-500/90">{t('events.map.chestReward')}:</span>
                              <span>{chest.rewardText}</span>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          <Tooltip content={tp.blocked || t(tp.near ? 'events.map.teleportBeside' : 'events.map.teleportTo', { name: chest.name })}>
                            <Button
                              size="mini"
                              variant="ghost"
                              disabled={!!tp.blocked || tp.busy}
                              onClick={() => void tp.teleport(chest.event.x, chest.event.y)}
                              className="flex items-center gap-1 font-mono text-[0.72rem]"
                            >
                              <IoNavigateOutline className="text-accent text-[0.85rem]" />
                              <span>
                                {chest.event.x},{chest.event.y}
                              </span>
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : eventTab === 'transfer' ? (
              transferList.length === 0 ? (
                <EmptyState title={t('events.map.emptyTransfer')} message={t('events.map.emptyTransferMsg')} className="min-h-full flex-1" />
              ) : (
                <div className="flex flex-col divide-y divide-line/60">
                  <div className="flex items-center justify-between border-b border-line bg-paper-2 px-3 py-1.5 text-xs text-ink-soft">
                    <span className="font-medium text-ink">
                      {t('events.map.tabTransfer')} ({transferList.length})
                    </span>
                    <span className="text-[0.7rem] text-ink-soft/75">点击卡片可查看对应事件详情</span>
                  </div>
                  {transferList.map((transfer) => {
                    const hit = isMatch(transfer.event)
                    return (
                      <div
                        key={transfer.event.id}
                        data-navigation-id={`map-event:${node.id}:${transfer.event.id}`}
                        role="listitem"
                        className={cn('group flex items-start gap-3 p-3 transition-colors hover:bg-paper-2/70', hit && 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]')}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 shadow-xs">
                          <IoExitOutline className="text-[1.2rem]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              className="m-0 cursor-pointer border-none bg-transparent p-0 text-left font-semibold text-ink text-[0.875rem] underline-offset-2 hover:text-accent hover:underline"
                              onClick={() => slot.onSelectMap(node.id, transfer.event.id)}
                              aria-label={t('events.map.openDetail', { name: transfer.name })}
                            >
                              {transfer.name}
                            </button>
                            {transfer.targetMapName && (
                              <span className="shrink-0 rounded-[0.2rem] bg-emerald-500/10 px-1.5 py-0.5 text-[0.68rem] font-medium text-emerald-600 dark:text-emerald-400">
                                {t('events.map.transferTo')} {transfer.targetMapName}
                              </span>
                            )}
                            {transfer.targetCoords && (
                              <span className="shrink-0 rounded-[0.2rem] border border-line/60 bg-paper-1/80 px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-soft">
                                目标: {transfer.targetCoords.x},{transfer.targetCoords.y}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => slot.onSelectMap(node.id, transfer.event.id)}
                              className="shrink-0 rounded-[0.2rem] border border-line/60 bg-paper-1/80 px-1.5 py-0.5 font-mono text-[0.68rem] text-ink-soft hover:border-accent hover:text-accent"
                              title={t('events.map.openDetail', { name: `${transfer.name} #${transfer.event.id}` })}
                            >
                              #{transfer.event.id} ({transfer.event.x},{transfer.event.y})
                            </button>
                            {hit && <span className="shrink-0 rounded-[0.2rem] bg-accent/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent">传送匹配</span>}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[0.74rem] text-ink-soft">
                            <span>
                              当前位置: ({transfer.event.x}, {transfer.event.y})
                            </span>
                            {transfer.targetMapId > 0 && transfer.targetMapId !== node.id && (
                              <button
                                type="button"
                                onClick={() => slot.onSelectMap(transfer.targetMapId)}
                                className="m-0 cursor-pointer border-none bg-transparent p-0 text-accent underline-offset-2 hover:underline"
                              >
                                查看目标地图 →
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          <Tooltip content={tp.blocked || t(tp.near ? 'events.map.teleportBeside' : 'events.map.teleportTo', { name: transfer.name })}>
                            <Button
                              size="mini"
                              variant="ghost"
                              disabled={!!tp.blocked || tp.busy}
                              onClick={() => void tp.teleport(transfer.event.x, transfer.event.y)}
                              className="flex items-center gap-1 font-mono text-[0.72rem]"
                            >
                              <IoNavigateOutline className="text-accent text-[0.85rem]" />
                              <span>
                                {transfer.event.x},{transfer.event.y}
                              </span>
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : eventTab === 'entrance' ? (
              displayedEntrances.length === 0 ? (
                <EmptyState title={t('events.map.emptyEntrance')} message={t('events.map.emptyEntranceMsg')} className="min-h-full flex-1" />
              ) : (
                <div className="flex flex-col divide-y divide-line/60">
                  <div className="flex items-center justify-between border-b border-line bg-paper-2 px-3 py-1.5 text-xs text-ink-soft">
                    <span className="font-medium text-ink">
                      {t('events.map.tabEntrance')} ({displayedEntrances.length})
                    </span>
                    <span className="text-[0.7rem] text-ink-soft/75">点击落点坐标可传送，点击来源可查看对应地图</span>
                  </div>
                  {displayedEntrances.map((entrance) => {
                    const hit = isEntranceMatch(entrance)
                    const isFromMap = entrance.sourceKind === 'map'
                    return (
                      <div
                        key={entrance.key}
                        data-navigation-id={`map-entrance:${node.id}:${entrance.key}`}
                        role="listitem"
                        className={cn('group flex items-start gap-3 p-3 transition-colors hover:bg-paper-2/70', hit && 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]')}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-sky-500/20 bg-sky-500/10 text-sky-500 shadow-xs">
                          <IoEnterOutline className="text-[1.2rem]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isFromMap ? (
                              <button
                                type="button"
                                className="m-0 cursor-pointer border-none bg-transparent p-0 text-left font-semibold text-ink text-[0.875rem] underline-offset-2 hover:text-accent hover:underline"
                                onClick={() => slot.onSelectMap(entrance.sourceId, entrance.sourceEventId)}
                                aria-label={t('events.map.openDetail', { name: entrance.sourceName })}
                              >
                                {t('events.map.entranceFrom')}「{entrance.sourceName}」
                              </button>
                            ) : (
                              <span className="font-semibold text-ink text-[0.875rem]">
                                {t('events.map.entranceFrom')}「{entrance.sourceName}」
                              </span>
                            )}
                            <span className="shrink-0 rounded-[0.2rem] bg-sky-500/10 px-1.5 py-0.5 text-[0.68rem] font-medium text-sky-600 dark:text-sky-400">
                              {isFromMap ? t('events.map.entranceSourceMap') : t('events.map.entranceCommonEvent')}
                            </span>
                            {entrance.sourceEventId && (
                              <button
                                type="button"
                                onClick={() => slot.onSelectMap(entrance.sourceId, entrance.sourceEventId)}
                                className="shrink-0 rounded-[0.2rem] border border-line/60 bg-paper-1/80 px-1.5 py-0.5 font-mono text-[0.68rem] text-ink-soft hover:border-accent hover:text-accent"
                                title={t('events.map.openDetail', { name: `${entrance.sourceName} #${entrance.sourceEventId}` })}
                              >
                                #{entrance.sourceEventId} {entrance.sourceEventName || ''}
                              </button>
                            )}
                            {entrance.directionArrow && (
                              <span className="shrink-0 rounded-[0.2rem] border border-line/60 bg-paper-1/80 px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-soft">
                                {t('events.map.entranceFacing')}: {entrance.directionArrow}
                              </span>
                            )}
                            {hit && <span className="shrink-0 rounded-[0.2rem] bg-accent/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent">入口匹配</span>}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[0.74rem] text-ink-soft">
                            <span>
                              {t('events.map.entranceLanding')}: ({entrance.x}, {entrance.y})
                            </span>
                            {isFromMap && entrance.sourceId !== node.id && (
                              <button
                                type="button"
                                onClick={() => slot.onSelectMap(entrance.sourceId, entrance.sourceEventId)}
                                className="m-0 cursor-pointer border-none bg-transparent p-0 text-accent underline-offset-2 hover:underline"
                              >
                                {t('events.map.entranceViewSourceMap')}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          <Tooltip content={tp.blocked || t(tp.near ? 'events.map.teleportBeside' : 'events.map.teleportTo', { name: entrance.title })}>
                            <Button
                              size="mini"
                              variant="ghost"
                              disabled={!!tp.blocked || tp.busy}
                              onClick={() => void tp.teleport(entrance.x, entrance.y)}
                              className="flex items-center gap-1 font-mono text-[0.72rem]"
                            >
                              <IoNavigateOutline className="text-accent text-[0.85rem]" />
                              <span>
                                {entrance.x},{entrance.y}
                              </span>
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              <>
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
                      checked={selected.size > 0 && selected.size === Math.min(50, displayedEvents.length)}
                      aria-label={t('events.map.batchSelected', { count: selected.size })}
                      onChange={(event) => setSelected(event.target.checked ? new Set(displayedEvents.slice(0, 50).map((item) => item.id)) : new Set())}
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
                {displayedEvents.map((ev, index) => {
                  const hit = isMatch(ev)
                  const name = ev.name || `#${ev.id}`
                  return (
                    <div
                      key={ev.id}
                      data-navigation-id={`map-event:${node.id}:${ev.id}`}
                      className={cn(
                        'grid items-center border-t border-line hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]',
                        index === 0 && 'border-t-0',
                        hit && 'bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]'
                      )}
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
                          <TruncateText text={name} className="min-w-0 flex-1" />
                          {hit && <span className="ml-1.5 shrink-0 rounded-[0.2rem] bg-accent/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent">NPC 匹配</span>}
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
                        {slot.live && slot.eventActivity?.entries.some((entry) => entry.mapId === node.id && entry.eventId === ev.id && entry.commonEventId == null) ? (
                          <Badge dot={false} tone="ok">
                            {t('events.running')}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}
