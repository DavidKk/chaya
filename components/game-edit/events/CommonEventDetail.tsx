'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { IoArrowBack, IoPlayOutline } from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, ScrollArea, SwitchToggle } from '@/components/sk'
import { type CommonEventInfo, type CommonEventsData, type EventRef, isRiskyEffects, labelOf, summarizeEffects } from '@/lib/game/events'
import { cn } from '@/lib/utils'

import { EventScript } from './EventScript'
import { commonEventName, effectLabels, refLabel } from './labels'
import type { EventsSlot } from './types'

const TRIGGER_KEY = { 0: 'events.trigger0', 1: 'events.trigger1', 2: 'events.trigger2' } as const
const MAX_CONFIRM_REFS = 8

export const sectionTitle = 'm-0 px-3 pt-3 pb-1 text-[0.68rem] font-semibold tracking-[0.05em] text-ink-soft uppercase'
export const refLink =
  'm-0 block w-full cursor-pointer truncate rounded-[0.2rem] border-none bg-transparent px-2 py-1 text-left text-[0.78rem] text-ink hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]'

type Props = {
  event: CommonEventInfo
  data: CommonEventsData
  slot: EventsSlot
  switches: Readonly<Record<number, boolean>>
  onBack: () => void
}

export function RefList({ refs, data, slot }: { refs: readonly EventRef[]; data: CommonEventsData; slot: EventsSlot }) {
  const t = useT()
  return (
    <ul className="m-0 list-none px-1 pb-2 pl-1">
      {refs.map((ref, index) => {
        const label = refLabel(ref, data.names, t)
        const open = ref.kind === 'common' ? () => slot.onSelectCommon(ref.id) : ref.kind === 'map' ? () => slot.onSelectMap(ref.id, ref.eventId ?? null) : null
        return (
          <li key={`${ref.kind}-${ref.id}-${ref.eventId ?? ''}-${ref.page ?? ''}-${index}`}>
            {open ? (
              <button type="button" className={refLink} title={label} onClick={open}>
                {label}
              </button>
            ) : (
              <span className="block truncate px-2 py-1 text-[0.78rem] text-ink-soft" title={label}>
                {label}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ConfirmList({ intro, items, more }: { intro: string; items: string[]; more?: string }) {
  return (
    <div className="flex flex-col gap-1.5 text-xs leading-[1.55]">
      <p className="m-0">{intro}</p>
      <ul className="m-0 list-disc pl-5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      {more ? <p className="m-0 text-ink-soft">{more}</p> : null}
    </div>
  )
}

/** Header, run, trigger switch, effects, references and script of one common event */
export function CommonEventDetail({ event, data, slot, switches, onBack }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [running, setRunning] = useState(false)
  const name = commonEventName(event, t)
  const effects = useMemo(() => summarizeEffects(event.list), [event.list])
  const effectItems = useMemo(() => effectLabels(effects, data.names, t), [effects, data.names, t])
  const risky = isRiskyEffects(effects)
  const callers = data.calledBy[event.id] ?? []
  const incomplete = !data.mapsScanned || data.mapsFailed > 0
  const isRunning = slot.live && !!slot.runningCommon?.includes(event.id)

  const runBlocked = !slot.canAct ? t('events.runNeedLink') : !slot.onMap ? t('events.runNeedMap') : ''

  async function run() {
    if (risky) {
      const ok = await confirm({
        title: t('events.runRiskTitle', { name }),
        description: <ConfirmList intro={t('events.runRiskDesc')} items={effectItems.map((e) => e.text)} />,
        confirmLabel: t('events.runConfirm'),
        confirmVariant: 'warn',
      })
      if (!ok) return
    }
    setRunning(true)
    try {
      await slot.onAct({ op: 'commonEvent', id: event.id })
      notify.success(t('events.runOk', { name }))
      slot.afterRun?.()
    } catch (err) {
      notify.error(t('events.runFail', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setRunning(false)
    }
  }

  const switchId = event.switchId
  const switchOn = !!switches[switchId]
  const switchName = labelOf(data.names.switches, switchId)
  const switchRefs = data.switchRefs[switchId] ?? []

  async function toggleSwitch(next: boolean) {
    const items = switchRefs.slice(0, MAX_CONFIRM_REFS).map((ref) => refLabel(ref, data.names, t))
    const ok = await confirm({
      title: next ? t('events.switchOnTitle', { name: switchName }) : t('events.switchOffTitle', { name: switchName }),
      description: (
        <div className="flex flex-col gap-2">
          {items.length ? (
            <ConfirmList
              intro={t('events.switchRefsDesc')}
              items={items}
              more={switchRefs.length > items.length ? t('events.switchMore', { count: switchRefs.length }) : undefined}
            />
          ) : (
            <p className="m-0 text-xs">{t('events.switchNoRefs')}</p>
          )}
          {next && event.trigger === 1 ? <p className="m-0 text-xs text-warn">{t('events.switchAutorunWarn')}</p> : null}
        </div>
      ),
      confirmLabel: next ? t('events.switchConfirmOn') : t('events.switchConfirmOff'),
      confirmVariant: next ? 'warn' : 'default',
    })
    if (ok) slot.onSwitchChange(switchId, next)
  }

  let runButton: ReactNode = null
  if (event.trigger === 0) {
    runButton = (
      <Button variant="accent" loading={running} disabled={!!runBlocked} tooltip={runBlocked || undefined} onClick={() => void run()}>
        <IoPlayOutline size={15} aria-hidden />
        {t('events.run')}
      </Button>
    )
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('events.detailAria')}>
      <header className="flex min-h-[3rem] shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Button variant="ghost" size="icon" className="@4xl:hidden" aria-label={t('events.back')} tooltip={t('events.back')} onClick={onBack}>
          <IoArrowBack size={16} aria-hidden />
        </Button>
        <span className="font-mono text-[0.75rem] text-ink-soft">#{event.id}</span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[0.9rem] font-semibold text-ink" title={name}>
            {name}
          </h2>
          {event.rawName && event.rawName !== name ? <p className="m-0 truncate text-[0.7rem] text-ink-soft">{event.rawName}</p> : null}
        </div>
        <Badge tone={event.trigger === 0 ? 'neutral' : event.trigger === 1 ? 'warn' : 'info'}>{t(TRIGGER_KEY[event.trigger])}</Badge>
        {isRunning ? <Badge tone="ok">{t('events.running')}</Badge> : null}
        {runButton}
      </header>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('events.detailAria') }}>
        {event.trigger !== 0 ? (
          <>
            <h3 className={sectionTitle}>{t('events.triggerSwitch')}</h3>
            <div className="flex items-center gap-3 px-3 pb-2 text-[0.8125rem]">
              <span className="min-w-0 truncate text-ink">{switchName}</span>
              <span className="text-[0.7rem] text-ink-soft">{t('events.switchRefs', { count: switchRefs.length })}</span>
              <span className="ml-auto">
                {slot.live ? (
                  <SwitchToggle
                    checked={switchOn}
                    disabled={!slot.canAct}
                    aria-label={switchName}
                    tooltip={!slot.canAct ? t('events.runNeedLink') : switchOn ? t('edit.toggleOff', { name: switchName }) : t('edit.toggleOn', { name: switchName })}
                    onCheckedChange={(next) => void toggleSwitch(next)}
                  />
                ) : (
                  <span className="text-[0.7rem] text-ink-soft" title={t('events.switchOfflineTip')}>
                    —
                  </span>
                )}
              </span>
            </div>
          </>
        ) : null}
        <h3 className={sectionTitle}>{t('events.effects')}</h3>
        {effectItems.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 px-3 pb-2 pl-3">
            {effectItems.map((item, i) => (
              <li
                key={i}
                className={cn('rounded-full px-2 py-0.5 text-[0.7rem]', item.risky ? 'bg-[color-mix(in_oklab,var(--warn)_16%,transparent)] text-warn' : 'bg-inset text-ink-soft')}
              >
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 px-3 pb-2 text-xs text-ink-soft">{t('events.effectsNone')}</p>
        )}
        <h3 className={sectionTitle}>{t('events.refs')}</h3>
        {incomplete ? <p className="m-0 px-3 pb-1 text-[0.7rem] text-warn">{t('events.refsIncomplete')}</p> : null}
        {callers.length ? <RefList refs={callers} data={data} slot={slot} /> : <p className="m-0 px-3 pb-2 text-xs text-ink-soft">{t('events.refsNone')}</p>}
        <h3 className={sectionTitle}>
          {t('events.script')} · {t('events.commands', { count: event.commandCount })}
        </h3>
        <EventScript list={event.list} names={data.names} texts={data.texts} onOpenCommon={(id) => slot.onSelectCommon(id)} onOpenMap={(id) => slot.onSelectMap(id, null)} />
      </ScrollArea>
    </section>
  )
}
