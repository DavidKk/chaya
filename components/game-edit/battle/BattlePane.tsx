'use client'

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GiCheckeredFlag, GiRunningShoe, GiTombstone, GiTrophyCup } from 'react-icons/gi'
import { IoStopCircleOutline } from 'react-icons/io5'

import type { RunActionId, SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { Button, EmptyState, ScrollArea } from '@/components/sk'
import { cn } from '@/lib/utils'

import type { EventsSlot } from '../events/types'
import { BattleEnemies } from './BattleEnemies'
import { BattleParty } from './BattleParty'
import { cardClass, SectionHead, useBattleRun } from './controls'

type Props = {
  slot?: EventsSlot
  session: Pick<SessionState, 'locks' | 'god'>
  onRunAction: (id: RunActionId) => void
  onOpenTroops: () => void
  onOpenActor?: (actorId: number) => void
  /** Panel header slot; the battle flow buttons render there when present */
  headSlot?: HTMLElement | null
}

const FLOW: {
  id: RunActionId
  labelKey: 'edit.actVictoryLong' | 'edit.actEscapeLong' | 'edit.actDefeatLong' | 'edit.actAbortLong' | 'edit.actSettleLong'
  icon: ReactNode
  variant?: 'ok' | 'fail'
}[] = [
  { id: 'battle:victory', labelKey: 'edit.actVictoryLong', icon: <GiTrophyCup size={16} aria-hidden />, variant: 'ok' },
  { id: 'battle:escape', labelKey: 'edit.actEscapeLong', icon: <GiRunningShoe size={16} aria-hidden /> },
  { id: 'battle:defeat', labelKey: 'edit.actDefeatLong', icon: <GiTombstone size={16} aria-hidden />, variant: 'fail' },
  { id: 'battle:abort', labelKey: 'edit.actAbortLong', icon: <IoStopCircleOutline size={16} aria-hidden /> },
  { id: 'battle:settle', labelKey: 'edit.actSettleLong', icon: <GiCheckeredFlag size={16} aria-hidden /> },
]

/** 修改 › 战斗: the running battle's flow, enemies and party */
export function BattlePane({ slot, session, onRunAction, onOpenTroops, onOpenActor, headSlot }: Props) {
  const t = useT()
  if (!slot) return <EmptyState title={t('events.needLink')} message={t('events.needLinkMsg')} />
  if (!slot.battle)
    return (
      <EmptyState title={t('events.battle.emptyTitle')} message={t('events.battle.emptyMsg')}>
        <Button className="mt-3" onClick={onOpenTroops}>
          {t('events.battle.goTroop')}
        </Button>
      </EmptyState>
    )
  return <BattleBody slot={slot} session={session} onRunAction={onRunAction} onOpenActor={onOpenActor} headSlot={headSlot} />
}

function BattleBody({ slot, session, onRunAction, onOpenActor, headSlot }: Omit<Props, 'onOpenTroops'> & { slot: EventsSlot }) {
  const t = useT()
  const { busy, run } = useBattleRun(slot)
  const battle = slot.battle!
  const blocked = !slot.canAct ? t('events.runNeedLink') : battle.ended ? t('events.troop.battleEnded') : ''
  const flowBlocked = !slot.canAct ? t('events.runNeedLink') : battle.settling ? t('events.troop.battleEnded') : ''
  const stuck = battle.ended && !battle.settling

  const flow = (
    <div role="group" aria-label={t('events.battle.flow')} className="flex shrink-0 items-center gap-2">
      {FLOW.map((a) => {
        const label = t(a.labelKey)
        const nudge = stuck && a.id === 'battle:settle'
        const note = flowBlocked || (nudge ? t('events.battle.stuck') : '')
        return (
          <Button
            key={a.id}
            variant={nudge ? 'accent' : (a.variant ?? 'default')}
            size="icon"
            aria-label={label}
            tooltip={note ? `${label} · ${note}` : label}
            disabled={!!flowBlocked}
            onClick={() => onRunAction(a.id)}
          >
            {a.icon}
          </Button>
        )
      })}
    </div>
  )

  return (
    <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('events.battle.aria') }}>
      <div className="flex w-full max-w-4xl flex-col gap-3 p-3">
        {headSlot ? (
          createPortal(flow, headSlot)
        ) : (
          <div className={cn(cardClass, '[&>div]:border-b-0')}>
            <SectionHead title={t('events.battle.flow')}>{flow}</SectionHead>
          </div>
        )}
        <BattleEnemies battle={battle} enemies={slot.data?.names.enemies ?? null} blocked={blocked} busy={busy} run={run} onRunAction={onRunAction} />
        <BattleParty
          battle={battle}
          actors={slot.data?.names.actors ?? null}
          session={session}
          blocked={blocked}
          busy={busy}
          run={run}
          onRunAction={onRunAction}
          onOpenActor={onOpenActor}
        />
      </div>
    </ScrollArea>
  )
}
