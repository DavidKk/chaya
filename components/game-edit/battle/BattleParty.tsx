'use client'

import { useEffect, useRef, useState } from 'react'
import { GiHealthIncrease, GiHeartPlus } from 'react-icons/gi'
import { IoAddOutline, IoSkullOutline } from 'react-icons/io5'

import { lockKeyForActorVital, type RunActionId, type SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { DataTable, type DataTableColumn, TextAction, TruncateText } from '@/components/sk'
import type { ActorVitalKey, BattleState } from '@/lib/game/battle'

import { EnemyPicker } from '../events/EnemyPicker'
import type { EventsOp } from '../events/types'
import { ACTIONS_COL, type BattleBusy, cardClass, IconAction, PlainInput, portalHost, SectionHead, STATUS_COL, tableClass, VITAL_COL, VitalInput } from './controls'

type Props = {
  battle: BattleState
  /** Actor names by id; null while the event index loads */
  actors: readonly string[] | null
  session: Pick<SessionState, 'locks' | 'god'>
  blocked: string
  busy: BattleBusy
  run: (key: string, op: EventsOp, ok: string) => Promise<void>
  onRunAction: (id: RunActionId) => void
  onOpenActor?: (actorId: number) => void
}

/** 战斗 › 我方: HP / MP (current and cap), TP, knock out / revive, full heal, add an ally */
export function BattleParty({ battle, actors, session, blocked, busy, run, onRunAction, onOpenActor }: Props) {
  const t = useT()
  const { party, partyIds, partyMax } = battle
  const rootRef = useRef<HTMLElement>(null)
  const [picking, setPicking] = useState(false)
  const joinBlocked = blocked || (party.length >= partyMax ? t('events.battle.joinFull', { max: partyMax }) : actors ? '' : t('events.loading'))
  useEffect(() => {
    if (joinBlocked) setPicking(false)
  }, [joinBlocked])

  function join(actorId: number) {
    setPicking(false)
    const name = actors?.[actorId] || t('events.unnamed', { id: actorId })
    void run('join', { op: 'actorJoin', actorId }, t('events.battle.joinOk', { name }))
  }

  const columns: DataTableColumn[] = [
    { key: 'actor', label: t('events.battle.colActor') },
    { key: 'hp', label: t('events.troop.colHp'), width: VITAL_COL },
    { key: 'mp', label: t('events.battle.colMp'), width: VITAL_COL },
    { key: 'tp', label: t('events.battle.colTp'), width: '5.5rem' },
    { key: 'status', label: t('events.troop.colStatus'), width: STATUS_COL },
    { key: 'actions', label: t('events.troop.colActions'), width: ACTIONS_COL, align: 'right' },
  ]
  const locked = (kind: 'hp' | 'mp', actorId: number) => lockKeyForActorVital(kind, actorId) in session.locks
  /** Invincibility refills HP / MP every tick, so edits would snap back */
  const vitalHold = (kind: 'hp' | 'mp', actorId: number) => (session.god ? t('events.battle.godOn') : locked(kind, actorId) ? t('events.battle.locked') : '')

  return (
    <section ref={rootRef} className={cardClass} aria-label={t('events.battle.party')}>
      <SectionHead title={t('events.battle.party')}>
        <TextAction disabled={!!blocked} onClick={() => onRunAction('battle:partyHeal')}>
          {t('edit.actPartyHeal')}
        </TextAction>
        <TextAction disabled={!!blocked} onClick={() => onRunAction('battle:partyHp1')}>
          {t('edit.actPartyHp1')}
        </TextAction>
        <TextAction disabled={!!blocked} onClick={() => onRunAction('battle:partyHp0')}>
          {t('edit.actPartyHp0')}
        </TextAction>
        <IconAction label={t('events.battle.join')} reason={joinBlocked} busy={busy.has('join')} disabled={busy.size > 0} onClick={() => setPicking(true)}>
          <IoAddOutline size={15} aria-hidden />
        </IconAction>
      </SectionHead>
      <DataTable columns={columns} className={tableClass}>
        {party.map((actor) => {
          const { actorId } = actor
          const name = actor.name || t('events.unnamed', { id: actorId })
          const reason = blocked || (actor.alive ? '' : t('events.troop.enemyDown'))
          const hpHold = vitalHold('hp', actorId)
          const mpHold = vitalHold('mp', actorId)
          const set = (key: ActorVitalKey, label: string) => (value: number) =>
            void run(`${key}:${actorId}`, { op: 'actorVital', actorId, key, value }, t('events.battle.setOk', { name, label, value }))
          return (
            <tr key={actorId}>
              <td>
                {onOpenActor ? (
                  <TextAction className="max-w-full min-w-0 font-normal text-ink" aria-label={t('events.battle.openActor', { name })} onClick={() => onOpenActor(actorId)}>
                    <TruncateText text={name} className={actor.alive ? 'block text-ink' : 'block text-ink-soft'} />
                  </TextAction>
                ) : (
                  <TruncateText text={name} className={actor.alive ? 'block text-ink' : 'block text-ink-soft'} />
                )}
              </td>
              <td>
                <VitalInput
                  value={actor.hp}
                  max={actor.mhp}
                  maxCap={actor.mhpCap}
                  label={`${t('events.troop.hpEdit')} ${name}`}
                  maxLabel={`${t('events.troop.mhpEdit')} ${name}`}
                  disabled={!!reason || !!hpHold}
                  disabledReason={hpHold || undefined}
                  onValue={set('hp', 'HP')}
                  onMax={set('mhp', t('events.troop.mhpEdit'))}
                />
              </td>
              <td>
                <VitalInput
                  value={actor.mp}
                  max={actor.mmp}
                  maxCap={actor.mmpCap}
                  minMax={0}
                  label={`${t('events.battle.mpEdit')} ${name}`}
                  maxLabel={`${t('events.battle.mmpEdit')} ${name}`}
                  disabled={!!reason || !!mpHold}
                  disabledReason={mpHold || undefined}
                  onValue={set('mp', 'MP')}
                  onMax={set('mmp', t('events.battle.mmpEdit'))}
                />
              </td>
              <td>
                <PlainInput value={actor.tp} max={actor.maxTp} label={`${t('events.battle.tpEdit')} ${name}`} disabled={!!reason} onValue={set('tp', 'TP')} />
              </td>
              <td className="whitespace-nowrap text-ink-soft">{actor.alive ? t('events.troop.statusOk') : t('events.troop.enemyDown')}</td>
              <td>
                <span className="flex items-center justify-end gap-0.5">
                  {actor.alive ? (
                    <IconAction
                      label={`${t('events.battle.knockOut')} ${name}`}
                      tip={t('events.battle.knockOut')}
                      reason={blocked || hpHold}
                      busy={busy.has(`knock:${actorId}`)}
                      disabled={busy.size > 0}
                      onClick={() => void run(`knock:${actorId}`, { op: 'actorVital', actorId, key: 'hp', value: 0 }, t('events.battle.knockOutOk', { name }))}
                    >
                      <IoSkullOutline size={15} aria-hidden />
                    </IconAction>
                  ) : (
                    <IconAction
                      label={`${t('events.troop.revive')} ${name}`}
                      tip={t('events.troop.revive')}
                      reason={blocked}
                      busy={busy.has(`revive:${actorId}`)}
                      disabled={busy.size > 0}
                      onClick={() => void run(`revive:${actorId}`, { op: 'actorRevive', actorId }, t('events.troop.reviveOk', { name }))}
                    >
                      <GiHeartPlus size={15} aria-hidden />
                    </IconAction>
                  )}
                  <IconAction
                    label={`${t('events.battle.recover')} ${name}`}
                    tip={t('events.battle.recover')}
                    reason={blocked}
                    busy={busy.has(`recover:${actorId}`)}
                    disabled={busy.size > 0}
                    onClick={() => void run(`recover:${actorId}`, { op: 'actorRecover', actorId }, t('events.battle.recoverOk', { name }))}
                  >
                    <GiHealthIncrease size={15} aria-hidden />
                  </IconAction>
                </span>
              </td>
            </tr>
          )
        })}
      </DataTable>
      <EnemyPicker
        open={picking}
        title={t('events.battle.join')}
        note={t('events.battle.joinNote')}
        enemies={actors ?? []}
        exclude={partyIds}
        search={t('events.battle.joinSearch')}
        empty={t('events.battle.joinEmpty')}
        portalContainer={portalHost(rootRef.current)}
        onPick={join}
        onClose={() => setPicking(false)}
      />
    </section>
  )
}
