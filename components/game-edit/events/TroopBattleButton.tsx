'use client'

import { useState } from 'react'
import { GiCrossedSwords } from 'react-icons/gi'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Button } from '@/components/sk'
import type { TroopInfo } from '@/lib/game/events'

import { readBattleOptions } from './battle-options'
import { troopMemberSummary, troopName } from './labels'
import type { EventsSlot } from './types'

type Props = {
  troopId: number
  troop: TroopInfo | undefined
  slot: EventsSlot
  /** Defaults to 立即开战; the map encounter list uses 立即遇敌 */
  label?: string
  /** Extra reason to disable (e.g. not the current map) */
  blocked?: string
  compact?: boolean
}

/** Confirm, then start a battle with the remembered options (set in the troop detail) */
export function TroopBattleButton({ troopId, troop, slot, label, blocked, compact = false }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [busy, setBusy] = useState(false)
  const name = troopName(troop, troopId, t)
  const reason = !slot.canAct ? t('events.runNeedLink') : !slot.onMap ? t('events.troop.needMap') : blocked || (troop && !troop.members.length ? t('events.troop.noMembers') : '')
  const text = label ?? t('events.troop.start')

  async function start() {
    const options = readBattleOptions()
    const yesNo = (on: boolean) => t(on ? 'events.troop.yes' : 'events.troop.no')
    const ok = await confirm({
      title: t('events.troop.confirmTitle', { name }),
      description: (
        <div className="flex flex-col gap-1.5 text-xs leading-[1.55]">
          <p className="m-0">{t('events.troop.confirmMembers', { list: troop ? troopMemberSummary(troop.members, t, Infinity) : `#${troopId}` })}</p>
          <p className="m-0 text-ink-soft">{t('events.troop.confirmOptions', { escape: yesNo(options.canEscape), lose: yesNo(options.canLose) })}</p>
          {options.count != null ? <p className="m-0 text-ink-soft">{t('events.troop.confirmCount', { count: options.count })}</p> : null}
          {options.canLose ? null : <p className="m-0 text-warn">{t('events.troop.loseWarn')}</p>}
        </div>
      ),
      confirmLabel: t('events.troop.confirm'),
      confirmVariant: 'warn',
    })
    if (!ok) return
    setBusy(true)
    try {
      await slot.onAct({ op: 'troop', id: troopId, canEscape: options.canEscape, canLose: options.canLose, ...(options.count != null ? { count: options.count } : {}) })
      notify.success(t('events.troop.startOk', { name }))
      slot.afterRun?.()
    } catch (err) {
      notify.error(t('events.troop.startFail', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  return compact ? (
    <Button variant="plain" size="mini" loading={busy} disabled={!!reason} aria-label={`${text} ${name}`} tooltip={reason || text} onClick={() => void start()}>
      <GiCrossedSwords size={14} aria-hidden />
    </Button>
  ) : (
    <Button variant="accent" loading={busy} disabled={!!reason} tooltip={reason || undefined} onClick={() => void start()}>
      <GiCrossedSwords size={15} aria-hidden />
      {text}
    </Button>
  )
}
