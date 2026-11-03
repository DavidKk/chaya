'use client'

import { useEffect, useState } from 'react'
import {
  IoArrowBackOutline,
  IoChevronDownOutline,
  IoChevronUpOutline,
  IoFlashOutline,
  IoLocateOutline,
  IoPlayForwardOutline,
  IoPlayOutline,
  IoPlaySkipForwardOutline,
  IoRefreshOutline,
  IoShieldCheckmarkOutline,
} from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, ScrollArea, TruncateText } from '@/components/sk'
import type { CandidateEvent, CurrentEvent, EventControlAction } from '@/lib/game/events/runtime'
import { cn } from '@/lib/utils'

import type { EventsSlot } from './types'

export function CurrentEventActions({ event, slot }: { event: CurrentEvent; slot: EventsSlot }) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [busy, setBusy] = useState(false)

  async function act(action: EventControlAction) {
    let applied = false
    const titles = {
      advance: 'events.current.advanceTitle',
      skip: 'events.current.skipTitle',
      restart: 'events.current.restartTitle',
    } as const
    const warnings = {
      advance: 'events.current.advanceWarning',
      skip: 'events.current.skipWarning',
      restart: 'events.current.restartWarning',
    } as const
    const labels = {
      advance: 'events.current.advance',
      skip: 'events.current.skip',
      restart: 'events.current.restart',
    } as const

    await confirm({
      title: t(titles[action], { name: event.name || event.path }),
      description: t(warnings[action]),
      confirmLabel: t(labels[action]),
      confirmVariant: action === 'advance' ? 'accent' : 'fail',
      onConfirm: async () => {
        setBusy(true)
        try {
          await slot.onAct({
            op: 'eventControl',
            action,
            target: {
              path: event.path,
              token: event.token,
              index: event.index,
              waitMode: event.waitMode,
              waiting: event.waiting,
            },
          })
          applied = true
          notify.success(t('events.current.applied'))
        } catch {
          notify.error(t('events.current.changed'))
        } finally {
          setBusy(false)
        }
      },
    })
    if (applied) slot.afterRun?.()
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      {(['advance', 'skip', 'restart'] as const).map((action) => {
        const blocked = action === 'advance' ? event.advanceBlocked : action === 'skip' ? event.skipBlocked : event.restartBlocked
        const label = t(`events.current.${action}`)
        const hint = !slot.canAct ? t('events.runNeedLink') : blocked ? t(`events.current.${blocked}`) : label
        return (
          <Button key={action} size="icon" variant="ghost" disabled={!slot.canAct || !!blocked || busy} tooltip={hint} aria-label={label} onClick={() => void act(action)}>
            {action === 'advance' ? (
              <IoPlayForwardOutline size={15} aria-hidden />
            ) : action === 'skip' ? (
              <IoPlaySkipForwardOutline size={15} aria-hidden />
            ) : (
              <IoRefreshOutline size={15} aria-hidden />
            )}
          </Button>
        )
      })}
    </span>
  )
}

/** Always outside the filtered event list, so live callers cannot be hidden by search or groups. */
export function CurrentEventsPanel({ slot }: { slot: EventsSlot }) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [unstucking, setUnstucking] = useState(false)
  const [runningCandidate, setRunningCandidate] = useState(false)
  const [advancingCandidate, setAdvancingCandidate] = useState(false)
  const [returningMap, setReturningMap] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const activity = slot.eventActivity
  const candidateCount = activity?.candidates?.length ?? 0
  const runningCount = activity?.entries.length ?? 0

  const [activeTab, setActiveTab] = useState<'running' | 'candidates'>('candidates')

  // Sync tab if running events appear or candidates change
  useEffect(() => {
    if (runningCount > 0) {
      setActiveTab('running')
    } else if (candidateCount > 0) {
      setActiveTab('candidates')
    }
  }, [runningCount, candidateCount])

  if (!slot.live || !activity) return null

  const hasAbnormal = activity.faded || activity.transparent || activity.movementLocked
  const prevMapId = slot.recentMaps?.length && slot.player?.mapId && slot.recentMaps[0] !== slot.player.mapId ? slot.recentMaps[0] : null

  async function handleUnstuck() {
    setUnstucking(true)
    try {
      await slot.onAct({ op: 'runAction', id: 'fix:unstuck' })
      notify.success(t('events.current.unstuckSuccess'))
      slot.afterRun?.()
    } catch {
      notify.error(t('events.current.changed'))
    } finally {
      setUnstucking(false)
    }
  }

  async function handleReturnPreviousMap() {
    if (!prevMapId) return
    await confirm({
      title: t('events.current.returnPrevMapTitle', { map: `#${prevMapId}` }),
      description: t('events.current.returnPrevMapWarning'),
      confirmLabel: t('events.current.returnPrevMap', { map: `#${prevMapId}` }),
      confirmVariant: 'accent',
      onConfirm: async () => {
        setReturningMap(true)
        try {
          await slot.onAct({ op: 'teleport', mapId: prevMapId, x: 0, y: 0, near: true })
          await slot.onAct({ op: 'runAction', id: 'fix:unstuck' })
          notify.success(t('events.current.unstuckSuccess'))
          slot.afterRun?.()
        } catch (error) {
          notify.error(error instanceof Error ? error.message : t('events.current.changed'))
        } finally {
          setReturningMap(false)
        }
      },
    })
  }

  async function handleRunCandidate(cand: CandidateEvent) {
    await confirm({
      title: t('events.current.runCandidateTitle', { name: cand.name || `#${cand.eventId}` }),
      description: t('events.current.runCandidateWarning'),
      confirmLabel: t('events.current.runCandidate'),
      confirmVariant: 'accent',
      onConfirm: async () => {
        setRunningCandidate(true)
        try {
          if (cand.missingSwitches?.length) {
            for (const swId of cand.missingSwitches) slot.onSwitchChange(swId, true)
          }
          await slot.onAct({ op: 'mapEvent', mapId: cand.mapId, eventId: cand.eventId, page: cand.page, from: 0 })
          notify.success(t('events.current.applied'))
          slot.afterRun?.()
        } catch (error) {
          notify.error(error instanceof Error ? error.message : t('events.current.changed'))
        } finally {
          setRunningCandidate(false)
        }
      },
    })
  }

  async function handleAdvanceCandidate(cand: CandidateEvent) {
    await confirm({
      title: t('events.current.advanceCandidateTitle', { name: cand.name || `#${cand.eventId}` }),
      description: t('events.current.advanceCandidateWarning'),
      confirmLabel: t('events.current.advanceCandidate'),
      confirmVariant: 'accent',
      onConfirm: async () => {
        setAdvancingCandidate(true)
        try {
          if (cand.missingSwitches?.length) {
            for (const swId of cand.missingSwitches) slot.onSwitchChange(swId, true)
          }
          if (cand.outcome?.switches?.length) {
            for (const item of cand.outcome.switches) slot.onSwitchChange(item.id, item.value)
          }
          if (cand.outcome?.variables?.length) {
            for (const item of cand.outcome.variables) slot.onVarChange(item.id, item.value)
          }
          if (cand.outcome?.transfer) {
            await slot.onAct({
              op: 'teleport',
              mapId: cand.outcome.transfer.mapId,
              x: cand.outcome.transfer.x,
              y: cand.outcome.transfer.y,
              near: true,
            })
          }
          await slot.onAct({ op: 'runAction', id: 'fix:unstuck' })
          notify.success(t('events.current.applied'))
          slot.afterRun?.()
        } catch (error) {
          notify.error(error instanceof Error ? error.message : t('events.current.changed'))
        } finally {
          setAdvancingCandidate(false)
        }
      },
    })
  }

  return (
    <section className="shrink-0 border-b border-line bg-paper-2" aria-label={t('events.current.title')}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2 pb-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {candidateCount > 0 ? (
            <div role="tablist" aria-label={t('events.current.title')} className="flex items-center gap-1 rounded-[0.25rem] bg-paper-1/60 p-0.5 border border-line/50">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'running'}
                onClick={() => {
                  setActiveTab('running')
                  setCollapsed(false)
                }}
                className={cn(
                  'inline-flex cursor-pointer items-center rounded-[0.2rem] px-2 py-0.5 text-xs font-medium transition-colors border-0',
                  activeTab === 'running' ? 'bg-paper text-ink shadow-[0_1px_2px_rgb(0_0_0/0.2)] font-semibold' : 'bg-transparent text-ink-soft hover:text-ink'
                )}
              >
                <span>{t('events.current.tabRunning')}</span>
                {runningCount > 0 ? (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-accent/15 px-1.5 py-0.2 text-[0.65rem] font-mono text-accent">{runningCount}</span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'candidates'}
                onClick={() => {
                  setActiveTab('candidates')
                  setCollapsed(false)
                }}
                className={cn(
                  'inline-flex cursor-pointer items-center rounded-[0.2rem] px-2 py-0.5 text-xs font-medium transition-colors border-0',
                  activeTab === 'candidates' ? 'bg-paper text-ink shadow-[0_1px_2px_rgb(0_0_0/0.2)] font-semibold' : 'bg-transparent text-ink-soft hover:text-ink'
                )}
              >
                <span>{t('events.current.tabCandidates')}</span>
                <span className="ml-1.5 inline-flex items-center rounded-full bg-warn/15 px-1.5 py-0.2 text-[0.65rem] font-mono text-warn">{candidateCount}</span>
              </button>
            </div>
          ) : (
            <h3 className="m-0 text-xs font-semibold text-ink">{t('events.current.title')}</h3>
          )}
          {activity.faded ? (
            <Badge dot={false} tone="warn">
              {t('events.current.badgeFaded')}
            </Badge>
          ) : null}
          {activity.transparent ? (
            <Badge dot={false} tone="warn">
              {t('events.current.badgeTransparent')}
            </Badge>
          ) : null}
          {activity.movementLocked ? (
            <Badge dot={false} tone="warn">
              {t('events.current.badgeLocked')}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {prevMapId ? (
            <Button
              size="xs"
              variant="ghost"
              loading={returningMap}
              disabled={!slot.canAct || returningMap}
              onClick={() => void handleReturnPreviousMap()}
              tooltip={t('events.current.returnPrevMapWarning')}
            >
              <IoArrowBackOutline className="mr-1 shrink-0" size={13} aria-hidden />
              {t('events.current.returnPrevMap', { map: `#${prevMapId}` })}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant={hasAbnormal ? 'accent' : 'default'}
            loading={unstucking}
            disabled={!slot.canAct || unstucking}
            onClick={() => void handleUnstuck()}
            tooltip={t('events.current.unstuck')}
          >
            <IoShieldCheckmarkOutline className="mr-1 shrink-0" size={13} aria-hidden />
            {t('events.current.unstuck')}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? t('events.current.expand') : t('events.current.collapse')}
            tooltip={collapsed ? t('events.current.expand') : t('events.current.collapse')}
          >
            {collapsed ? <IoChevronDownOutline size={14} aria-hidden /> : <IoChevronUpOutline size={14} aria-hidden />}
          </Button>
        </div>
      </div>

      {!collapsed ? (
        <>
          {hasAbnormal && !activity.entries.length ? (
            <div className="px-3 pt-1 pb-1">
              <p className="m-0 text-xs text-warn">{t('events.current.orphaned')}</p>
            </div>
          ) : null}

          {candidateCount === 0 || activeTab === 'running' ? (
            activity.entries.length ? (
              <ScrollArea className="max-h-44 @md:max-h-52" indicator="vertical" reserveGutter={false}>
                {activity.entries.map((event) => {
                  const canOpen = event.commonEventId != null || (event.mapId > 0 && event.eventId > 0 && event.page != null)
                  return (
                    <div key={event.path} className="flex min-w-0 items-center gap-2 px-3 py-1">
                      <button
                        type="button"
                        disabled={!canOpen}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-xs text-ink hover:text-accent disabled:cursor-default"
                        onClick={() => {
                          if (event.commonEventId != null) slot.onSelectCommon(event.commonEventId)
                          else slot.onSelectMap(event.mapId, event.eventId, event.page ?? undefined)
                        }}
                        aria-label={t('events.current.locate', { name: event.name || event.path })}
                      >
                        <IoLocateOutline className="shrink-0" size={14} aria-hidden />
                        <TruncateText
                          text={
                            event.commonEventId != null
                              ? t('events.refCommon', { target: `#${event.commonEventId} ${event.name}` })
                              : t('events.refMap', {
                                  map: `#${event.mapId}`,
                                  event: `#${event.eventId} ${event.name}`,
                                  page: (event.page ?? 0) + 1,
                                })
                          }
                        />
                      </button>
                      <Badge dot={false} tone="ok">
                        {t('events.running')}
                      </Badge>
                      <span className="hidden shrink-0 font-mono text-[0.65rem] text-ink-soft @sm:inline">
                        {t('events.current.position', {
                          index: (event.waitMode || event.waiting || event.child ? Math.max(0, event.index - 1) : event.index) + 1,
                          code: (event.waitMode || event.waiting || event.child ? event.previousCode : event.code) ?? '—',
                        })}
                      </span>
                      <CurrentEventActions event={event} slot={slot} />
                    </div>
                  )
                })}
              </ScrollArea>
            ) : (
              <div className="px-3 pb-2">
                <p className="m-0 text-xs text-ink-soft">{t('events.current.none')}</p>
              </div>
            )
          ) : (
            <ScrollArea className="max-h-44 @md:max-h-52" indicator="vertical" reserveGutter={false}>
              <div className="space-y-1 px-3 pt-1 pb-2">
                {activity.candidates!.map((cand) => (
                  <div key={`${cand.mapId}:${cand.eventId}:${cand.page}`} className="flex min-w-0 flex-wrap items-center gap-2 py-0.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left text-xs text-ink hover:text-accent"
                      onClick={() => slot.onSelectMap(cand.mapId, cand.eventId, cand.page)}
                      aria-label={t('events.current.locate', { name: cand.name || `#${cand.eventId}` })}
                    >
                      <IoLocateOutline className="shrink-0" size={13} aria-hidden />
                      <TruncateText text={`#${cand.eventId} ${cand.name || t('events.unnamed', { id: cand.eventId })}`} />
                      <span className="shrink-0 text-[0.65rem] text-ink-soft">P{cand.page + 1}</span>
                    </button>
                    {cand.trigger === 3 ? (
                      <Badge dot={false} tone="warn">
                        {t('events.trigger1')}
                      </Badge>
                    ) : null}
                    {cand.missingConditions.slice(0, 2).map((cond) => (
                      <Badge key={cond} dot={false} tone="neutral">
                        {t('events.current.missingCondition', { condition: cond })}
                      </Badge>
                    ))}
                    <span className="flex shrink-0 items-center gap-1">
                      {cand.outcome?.transfer || cand.outcome?.variables?.length ? (
                        <Button
                          size="xs"
                          variant="accent"
                          disabled={!slot.canAct || advancingCandidate}
                          onClick={() => void handleAdvanceCandidate(cand)}
                          tooltip={t('events.current.advanceCandidateWarning')}
                        >
                          <IoFlashOutline className="mr-0.5" size={12} aria-hidden />
                          {t('events.current.advanceCandidate')}
                        </Button>
                      ) : null}
                      <Button size="xs" variant="default" disabled={!slot.canAct || runningCandidate} onClick={() => void handleRunCandidate(cand)}>
                        <IoPlayOutline className="mr-0.5" size={12} aria-hidden />
                        {t('events.current.runCandidate')}
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </>
      ) : null}
    </section>
  )
}
