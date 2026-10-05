'use client'

import { useMemo, useState } from 'react'
import { IoArrowBack, IoNavigateOutline, IoPlayOutline } from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import type { SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, ScrollArea } from '@/components/sk'
import {
  type CommonEventsData,
  isRiskyEffects,
  labelOf,
  type MapDetailData,
  type MapEventInfo,
  type MapEventTrigger,
  type MapNode,
  type PageConditions,
  summarizeEffects,
} from '@/lib/game/events'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { sectionTitle } from './CommonEventDetail'
import { EventScript } from './EventScript'
import { effectLabels } from './labels'
import { eventStateOf, SelfSwitches, StateBadge, TYPE_KEY } from './MapDetail'
import type { EventsOp, EventsSlot } from './types'

const TRIGGER_KEY: Record<MapEventTrigger, MessageKey> = {
  0: 'events.map.triggerAction',
  1: 'events.map.triggerTouch',
  2: 'events.map.triggerEventTouch',
  3: 'events.map.triggerAuto',
  4: 'events.map.triggerParallel',
}

function conditionLines(c: PageConditions, data: CommonEventsData, t: ReturnType<typeof useT>): string[] {
  const n = data.names
  const refs = (count: number) => (count ? ` · ${t('events.switchRefs', { count })}` : '')
  const out: string[] = []
  if (c.switch1) out.push(t('events.map.condSwitch', { target: labelOf(n.switches, c.switch1) }) + refs(data.switchRefs[c.switch1]?.length ?? 0))
  if (c.switch2) out.push(t('events.map.condSwitch', { target: labelOf(n.switches, c.switch2) }) + refs(data.switchRefs[c.switch2]?.length ?? 0))
  if (c.variable)
    out.push(t('events.map.condVariable', { target: labelOf(n.variables, c.variable.id), value: c.variable.value }) + refs(data.variableRefs[c.variable.id]?.length ?? 0))
  if (c.selfSwitch) out.push(t('events.map.condSelf', { ch: c.selfSwitch }))
  if (c.item) out.push(t('events.map.condItem', { target: labelOf(n.items, c.item) }))
  if (c.actor) out.push(t('events.map.condActor', { target: labelOf(n.actors, c.actor) }))
  return out
}

type Props = { ev: MapEventInfo; node: MapNode; detail: MapDetailData; data: CommonEventsData; slot: EventsSlot; session: SessionState }

/** Map event: state, trigger now, teleport next to it, self switches and every page's conditions and script */
export function MapEventDetail({ ev, node, detail, data, slot, session }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [busy, setBusy] = useState(false)
  const name = ev.name || `#${ev.id}`
  const state = eventStateOf(ev, detail, session)
  const texts = useMemo(() => ({ ...data.texts, ...detail.texts }), [data.texts, detail.texts])
  const activePage = state.page || 1
  const effects = useMemo(() => summarizeEffects(ev.pages[activePage - 1]?.list ?? []), [ev.pages, activePage])

  const onThisMap = slot.live && slot.player?.mapId === node.id
  const runBlocked = !slot.canAct
    ? t('events.runNeedLink')
    : !onThisMap
      ? t('events.map.runEventOnlyCurrent')
      : !slot.onMap
        ? t('events.runNeedMap')
        : state.kind === 'hidden' && state.exact
          ? t('events.map.runEventHidden')
          : ''
  const moveBlocked = !slot.canAct ? t('events.runNeedLink') : !slot.onMap ? t('events.runNeedMap') : ''

  const act = async (op: EventsOp, ok: string, risky = false) => {
    if (risky) {
      const confirmed = await confirm({
        title: t('events.runRiskTitle', { name }),
        description: (
          <div className="flex flex-col gap-1.5 text-xs leading-[1.55]">
            <p className="m-0">{t('events.runRiskDesc')}</p>
            <ul className="m-0 list-disc pl-5">
              {effectLabels(effects, data.names, t).map((e, i) => (
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

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={name}>
      <header className="flex min-h-[3rem] shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Button variant="ghost" size="icon" aria-label={t('events.map.closeDetail')} tooltip={t('events.map.closeDetail')} onClick={() => slot.onSelectMap(node.id, null)}>
          <IoArrowBack size={16} aria-hidden />
        </Button>
        <span className="font-mono text-[0.75rem] text-ink-soft">#{ev.id}</span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[0.9rem] font-semibold text-ink">{name}</h2>
          <p className="m-0 truncate text-[0.7rem] text-ink-soft">
            {node.name || `#${node.id}`} · ({ev.x}, {ev.y}) · {t(TYPE_KEY[ev.type])}
          </p>
        </div>
        <StateBadge state={state} />
        <Button
          loading={busy}
          disabled={!!moveBlocked}
          tooltip={moveBlocked || t('events.map.teleportTo', { name })}
          onClick={() => void act({ op: 'teleport', mapId: node.id, x: ev.x, y: ev.y, near: true }, t('events.map.teleportOk', { name }))}
        >
          <IoNavigateOutline size={15} aria-hidden />
          {t('events.map.teleport')}
        </Button>
        <Button
          variant="accent"
          loading={busy}
          disabled={!!runBlocked}
          tooltip={runBlocked || undefined}
          onClick={() => void act({ op: 'mapEvent', mapId: node.id, eventId: ev.id }, t('events.runOk', { name }), isRiskyEffects(effects))}
        >
          <IoPlayOutline size={15} aria-hidden />
          {t('events.map.runEvent')}
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': name }}>
        <h3 className={sectionTitle}>{t('events.map.colSelf')}</h3>
        <div className="px-3 pb-2">
          <SelfSwitches mapId={node.id} eventId={ev.id} on={detail.live ? (detail.live.selfSwitches[ev.id] ?? '') : null} slot={slot} />
        </div>
        {ev.pages.map((page, index) => {
          const conds = conditionLines(page.conditions, data, t)
          const active = state.kind !== 'unknown' && state.page === index + 1
          return (
            <div key={index} className={cn('border-t border-line', active && 'bg-[color-mix(in_oklab,var(--ok)_5%,transparent)]')}>
              <h3 className={cn(sectionTitle, 'flex items-center gap-2')}>
                {t('events.map.page', { page: index + 1 })}
                <span className="font-normal normal-case tracking-normal">· {t(TRIGGER_KEY[page.trigger])}</span>
                {active ? <Badge tone="ok">{state.exact ? t('events.map.stateShown') : t('events.map.stateGuess')}</Badge> : null}
              </h3>
              <p className="m-0 flex flex-wrap gap-x-2 px-3 pb-1 text-[0.72rem] text-ink-soft">
                <span className="font-medium text-ink">{t('events.map.pageCond')}</span>
                {(conds.length ? conds : [t('events.map.condNone')]).map((c, i) => (
                  <span key={i}>{c}</span>
                ))}
              </p>
              <EventScript list={page.list} names={data.names} texts={texts} onOpenCommon={(id) => slot.onSelectCommon(id)} onOpenMap={(id) => slot.onSelectMap(id, null)} />
            </div>
          )
        })}
      </ScrollArea>
    </section>
  )
}
