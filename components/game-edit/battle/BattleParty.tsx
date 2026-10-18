'use client'

import { useEffect, useRef, useState } from 'react'
import { GiHealthIncrease, GiHeartPlus } from 'react-icons/gi'
import { IoAddOutline, IoSkullOutline } from 'react-icons/io5'

import { type BattleLockChange, lockKeyForActorVital, type RunActionId, type SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { DataList, type DataListColumn, TextAction, TruncateText } from '@/components/sk'
import type { ActorVitalKey, BattleState } from '@/lib/game/battle'

import { EnemyPicker } from '../events/EnemyPicker'
import type { EventsOp } from '../events/types'
import { type BattleBusy, cardClass, IconAction, PARTY_COLS, PlainInput, portalHost, SectionHead, tableClass, VitalInput } from './controls'

type Props = {
  battle: BattleState
  /** Actor names by id; null while the event index loads */
  actors: readonly string[] | null
  session: Pick<SessionState, 'locks' | 'god'>
  blocked: string
  busy: BattleBusy
  run: (key: string, op: EventsOp, ok: string) => Promise<void>
  onRunAction: (id: RunActionId) => void
  onLock: (change: BattleLockChange) => void
  onOpenActor?: (actorId: number) => void
}

/** 战斗 › 我方: HP / MP (current and cap), TP, knock out / revive, full heal, add an ally */
export function BattleParty({ battle, actors, session, blocked, busy, run, onRunAction, onLock, onOpenActor }: Props) {
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

  const columns: DataListColumn[] = [
    { key: 'actor', label: t('events.battle.colActor'), width: PARTY_COLS.actor },
    { key: 'hp', label: t('events.troop.colHp'), width: PARTY_COLS.hp },
    { key: 'mp', label: t('events.battle.colMp'), width: PARTY_COLS.mp },
    { key: 'tp', label: t('events.battle.colTp'), width: PARTY_COLS.tp },
    { key: 'status', label: t('events.troop.colStatus'), width: PARTY_COLS.status },
    { key: 'actions', label: t('events.troop.colActions'), width: PARTY_COLS.actions, align: 'right' },
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
      <DataList columns={columns} className={tableClass}>
        {party.map((actor) => {
          const { actorId } = actor
          const name = actor.name || t('events.unnamed', { id: actorId })
          const reason = blocked || (actor.alive ? '' : t('events.troop.enemyDown'))
          const hpHold = vitalHold('hp', actorId)
          const mpHold = vitalHold('mp', actorId)
          const lockOf = (kind: 'hp' | 'mhp' | 'mp' | 'mmp' | 'tp', label: string, value: number) => ({
            locked: lockKeyForActorVital(kind, actorId) in session.locks,
            name: `${label} ${name}`,
            disabled: !!blocked,
            onChange: (on: boolean) => onLock({ side: 'actor', id: actorId, kind, on, value }),
          })
          const set = (key: ActorVitalKey, label: string) => (value: number) =>
            void run(`${key}:${actorId}`, { op: 'actorVital', actorId, key, value }, t('events.battle.setOk', { name, label, value }))
          return (
            <div role="listitem" data-list-row="" key={actorId} data-navigation-id={actorId}>
              <div data-list-cell="">
                {onOpenActor ? (
                  <TextAction
                    className="max-w-full min-w-0 font-normal text-ink"
                    aria-label={t('events.battle.openActor', { name })}
                    data-navigation-trigger=""
                    onClick={() => onOpenActor(actorId)}
                  >
                    <TruncateText text={name} className={actor.alive ? 'block text-ink' : 'block text-ink-soft'} />
                  </TextAction>
                ) : (
                  <TruncateText text={name} className={actor.alive ? 'block text-ink' : 'block text-ink-soft'} />
                )}
              </div>
              <div data-list-cell="">
                <VitalInput
                  value={actor.hp}
                  max={actor.mhp}
                  maxCap={actor.mhpCap}
                  label={`${t('events.troop.hpEdit')} ${name}`}
                  maxLabel={`${t('events.troop.mhpEdit')} ${name}`}
                  disabled={!!reason || !!hpHold}
                  maxDisabled={!!reason || session.god || lockKeyForActorVital('mhp', actorId) in session.locks}
                  disabledReason={hpHold || undefined}
                  lock={lockOf('hp', t('events.troop.hpEdit'), actor.hp)}
                  maxLock={lockOf('mhp', t('events.troop.mhpEdit'), actor.mhp)}
                  onValue={set('hp', 'HP')}
                  onMax={set('mhp', t('events.troop.mhpEdit'))}
                />
              </div>
              <div data-list-cell="">
                <VitalInput
                  value={actor.mp}
                  max={actor.mmp}
                  maxCap={actor.mmpCap}
                  minMax={0}
                  label={`${t('events.battle.mpEdit')} ${name}`}
                  maxLabel={`${t('events.battle.mmpEdit')} ${name}`}
                  disabled={!!reason || !!mpHold}
                  maxDisabled={!!reason || session.god || lockKeyForActorVital('mmp', actorId) in session.locks}
                  disabledReason={mpHold || undefined}
                  lock={lockOf('mp', t('events.battle.mpEdit'), actor.mp)}
                  maxLock={lockOf('mmp', t('events.battle.mmpEdit'), actor.mmp)}
                  onValue={set('mp', 'MP')}
                  onMax={set('mmp', t('events.battle.mmpEdit'))}
                />
              </div>
              <div data-list-cell="">
                <PlainInput
                  value={actor.tp}
                  max={actor.maxTp}
                  label={`${t('events.battle.tpEdit')} ${name}`}
                  disabled={!!reason || lockKeyForActorVital('tp', actorId) in session.locks}
                  lock={lockOf('tp', t('events.battle.tpEdit'), actor.tp)}
                  onValue={set('tp', 'TP')}
                />
              </div>
              <div data-list-cell="" className="whitespace-nowrap text-ink-soft">
                <span className="flex h-8 items-center">{actor.alive ? t('events.troop.statusOk') : t('events.troop.enemyDown')}</span>
              </div>
              <div data-list-cell="">
                <span className="flex h-8 items-center justify-end gap-0.5">
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
              </div>
            </div>
          )
        })}
      </DataList>
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
