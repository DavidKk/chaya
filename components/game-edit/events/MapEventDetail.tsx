'use client'

import { useMemo, useState } from 'react'
import { IoArrowBack, IoNavigateOutline } from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { countKey, type SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, ScrollArea, SegmentedNav, TruncateText } from '@/components/sk'
import { type CommonEventsData, type EventEffects, isRiskyEffects, type MapDetailData, type MapEventInfo, type MapNode, reachableFrom, summarizeEffects } from '@/lib/game/events'

import { EventScript } from './EventScript'
import { effectLabels } from './labels'
import { eventStateOf, type Teleport, TYPE_KEY } from './MapDetail'
import type { ScriptLive } from './ScriptValue'
import type { EventsOp, EventsSlot } from './types'

type Props = { ev: MapEventInfo; node: MapNode; detail: MapDetailData; data: CommonEventsData; slot: EventsSlot; session: SessionState; tp: Teleport }

/** Map event: state, teleport next to it, self switches and each page's script (run from any line) */
export function MapEventDetail({ ev, node, detail, data, slot, session, tp }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [busy, setBusy] = useState(false)
  const name = ev.name || `#${ev.id}`
  const state = eventStateOf(ev, detail, session)
  const texts = useMemo(() => ({ ...data.texts, ...detail.texts }), [data.texts, detail.texts])
  const activeIndex = state.kind !== 'unknown' && state.page > 0 ? state.page - 1 : -1
  /** Follows the live active page until a tab is picked */
  const pickedPage = slot.eventPage != null && slot.eventPage < ev.pages.length ? slot.eventPage : null
  const shownIndex = pickedPage ?? Math.max(0, activeIndex)
  const shownPage = ev.pages[shownIndex]
  const pageTabs = ev.pages.map((_, i) => ({
    id: String(i),
    label: t('events.map.page', { page: i + 1 }) + (i === activeIndex ? ` · ${t(state.exact ? 'events.map.pageActive' : 'events.map.stateGuess')}` : ''),
  }))
  const onThisMap = slot.live && slot.player?.mapId === node.id
  const fromBlocked = !slot.canAct ? t('events.runNeedLink') : !onThisMap ? t('events.map.runEventOnlyCurrent') : !slot.onMap ? t('events.runNeedMap') : ''
  const act = async (op: EventsOp, ok: string, opEffects: EventEffects) => {
    if (isRiskyEffects(opEffects)) {
      const confirmed = await confirm({
        title: t('events.runRiskTitle', { name }),
        description: (
          <div className="flex flex-col gap-1.5 text-xs leading-[1.55]">
            <p className="m-0">{t('events.runRiskDesc')}</p>
            <ul className="m-0 list-disc pl-5">
              {effectLabels(opEffects, data.names, t).map((e, i) => (
                <li key={i}>{e.text}</li>
              ))}
            </ul>
          </div>
        ),
        confirmLabel: t('events.runConfirm'),
        confirmVariant: 'warn',
      })
      if (!confirmed) return
    }
    setBusy(true)
    try {
      await slot.onAct(op)
      notify.success(ok)
      slot.afterRun?.()
    } catch (err) {
      notify.error(t('events.runFail', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }
  const selfOn = detail.live ? (detail.live.selfSwitches[ev.id] ?? '') : null
  const live = useMemo(
    (): ScriptLive | null =>
      slot.live
        ? {
            state: {
              switches: session.switches,
              vars: session.vars,
              self: selfOn,
              gold: session.gold,
              itemCount: (id) => session.counts[countKey('item', id)],
            },
            canEdit: slot.canAct,
            onSwitch: slot.onSwitchChange,
            onVar: slot.onVarChange,
          }
        : null,
    [slot, session.switches, session.vars, session.gold, session.counts, selfOn]
  )
  const runFrom = (at: number) =>
    void act(
      { op: 'mapEvent', mapId: node.id, eventId: ev.id, page: shownIndex, from: at },
      t('events.runOk', { name }),
      summarizeEffects(reachableFrom(shownPage?.list ?? [], at))
    )

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={name}>
      <header className="flex min-h-[3.25rem] shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1">
        <Button variant="ghost" size="icon" aria-label={t('events.map.closeDetail')} tooltip={t('events.map.closeDetail')} onClick={() => slot.onSelectMap(node.id, null)}>
          <IoArrowBack size={16} aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="m-0 flex min-w-0 text-[0.9rem] font-semibold text-ink">
              <TruncateText text={name} />
            </h2>
            {onThisMap ? (
              <Badge dot={false} tone="info" className="shrink-0">
                {t('events.map.current')}
              </Badge>
            ) : null}
            {state.kind !== 'unknown' ? (
              <Badge dot={false} tone={state.kind === 'shown' ? 'ok' : 'neutral'} className="shrink-0">
                {t(state.kind === 'shown' ? 'events.map.stateShown' : 'events.map.stateHidden')}
                {state.exact ? null : ` · ${t('events.map.stateGuess')}`}
              </Badge>
            ) : null}
          </div>
          <p className="m-0 flex min-w-0 text-[0.7rem] text-ink-soft">
            <TruncateText text={`${node.name || `#${node.id}`} · (${ev.x},${ev.y}) · ${t(TYPE_KEY[ev.type])}`} />
          </p>
        </div>
        <Button
          loading={tp.busy}
          disabled={!!tp.blocked || busy}
          tooltip={tp.blocked || t(tp.near ? 'events.map.teleportBeside' : 'events.map.teleportTo', { name })}
          onClick={() => void tp.teleport(ev.x, ev.y)}
        >
          <IoNavigateOutline size={15} aria-hidden />
          {t('events.map.teleport')}
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': name }}>
        <div>
          {ev.pages.length > 1 ? (
            <div className="px-3 py-2.5">
              <SegmentedNav items={pageTabs} value={String(shownIndex)} onChange={(id) => slot.onSelectEventPage(Number(id))} aria-label={t('events.map.pagesAria')} />
            </div>
          ) : null}
          {shownPage ? (
            <EventScript
              key={shownIndex}
              list={shownPage.list}
              names={data.names}
              texts={texts}
              onOpenCommon={(id) => slot.onSelectCommon(id)}
              onOpenMap={(id) => slot.onSelectMap(id, null)}
              onRunFrom={runFrom}
              runBlocked={fromBlocked}
              busy={busy}
              live={live}
            />
          ) : null}
        </div>
      </ScrollArea>
    </section>
  )
}
