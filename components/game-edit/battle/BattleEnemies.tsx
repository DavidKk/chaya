'use client'

import { useEffect, useRef, useState } from 'react'
import { GiHealthIncrease, GiHeartPlus, GiShadowFollower } from 'react-icons/gi'
import { IoAddOutline, IoSkullOutline } from 'react-icons/io5'
import { RiExchange2Line } from 'react-icons/ri'

import type { RunActionId } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { DataTable, type DataTableColumn, TextAction, TruncateText } from '@/components/sk'
import { aliveEnemyCount, type BattleEnemyState, type BattleState, MAX_BATTLE_ENEMIES } from '@/lib/game/battle'

import { EnemyPicker } from '../events/EnemyPicker'
import type { EventsOp } from '../events/types'
import { ACTIONS_COL, cardClass, IconAction, portalHost, SectionHead, STATUS_COL, tableClass, VITAL_COL, VitalInput } from './controls'

/** RPG Maker's enemy max HP cap (`Game_Enemy.paramMax`) */
const MAX_ENEMY_MHP = 999999

type Props = {
  battle: BattleState
  /** Enemy names by id; null while the event index loads */
  enemies: readonly string[] | null
  /** Why nothing can be edited ('' when editable) */
  blocked: string
  busy: string | null
  run: (key: string, op: EventsOp, ok: string) => Promise<void>
  onRunAction: (id: RunActionId) => void
}

type Picking = { mode: 'transform'; enemy: BattleEnemyState } | { mode: 'add' } | null

/** 战斗 › 敌方: edit HP, kill / revive, copy, replace, add */
export function BattleEnemies({ battle, enemies, blocked, busy, run, onRunAction }: Props) {
  const t = useT()
  const rootRef = useRef<HTMLElement>(null)
  const [picking, setPicking] = useState<Picking>(null)
  const full = aliveEnemyCount(battle) >= MAX_BATTLE_ENEMIES
  const addBlocked = blocked || (full ? t('events.troop.addFull', { max: MAX_BATTLE_ENEMIES }) : '')
  const pickBlocked = enemies ? '' : t('events.loading')
  const enemyName = (id: number) => enemies?.[id] || t('events.unnamed', { id })
  const columns: DataTableColumn[] = [
    { key: 'enemy', label: t('events.troop.colEnemy') },
    { key: 'hp', label: t('events.troop.colHp'), width: VITAL_COL },
    { key: 'status', label: t('events.troop.colStatus'), width: STATUS_COL },
    { key: 'actions', label: t('events.troop.colActions'), width: ACTIONS_COL, align: 'right' },
  ]
  const reasonFor = (enemy: BattleEnemyState) => blocked || (!enemy.appeared ? t('events.troop.enemyHidden') : !enemy.alive ? t('events.troop.enemyDown') : '')

  const target = picking?.mode === 'transform' ? battle.enemies.find((e) => e.index === picking.enemy.index && e.enemyId === picking.enemy.enemyId) : null
  const stale = picking?.mode === 'transform' ? !target || !!reasonFor(target) : picking?.mode === 'add' ? !!addBlocked : false
  useEffect(() => {
    if (stale) setPicking(null)
  }, [stale])

  function pick(enemyId: number) {
    const current = picking
    setPicking(null)
    if (!current) return
    const name = enemyName(enemyId)
    if (current.mode === 'add') void run('add', { op: 'enemyAdd', enemyId }, t('events.troop.addOk', { name }))
    else {
      const { index, enemyId: fromEnemyId } = current.enemy
      void run(`replace:${index}`, { op: 'enemyTransform', index, fromEnemyId, enemyId }, t('events.troop.transformOk', { name }))
    }
  }

  return (
    <section ref={rootRef} className={cardClass} aria-label={t('events.battle.enemies')}>
      <SectionHead title={t('events.battle.enemies')}>
        <TextAction disabled={!!blocked} onClick={() => onRunAction('battle:enemyHp1')}>
          {t('edit.actEnemyHp1')}
        </TextAction>
        <TextAction disabled={!!blocked} onClick={() => onRunAction('battle:enemyHpMax')}>
          {t('edit.actEnemyHpMax')}
        </TextAction>
        <IconAction label={t('events.troop.add')} reason={addBlocked || pickBlocked} busy={busy === 'add'} disabled={busy != null} onClick={() => setPicking({ mode: 'add' })}>
          <IoAddOutline size={15} aria-hidden />
        </IconAction>
      </SectionHead>
      <DataTable columns={columns} className={tableClass}>
        {battle.enemies.map((enemy) => {
          const reason = reasonFor(enemy)
          const name = enemy.name || enemyName(enemy.enemyId)
          const status = !enemy.appeared ? t('events.troop.enemyHidden') : !enemy.alive ? t('events.troop.enemyDown') : t('events.troop.statusOk')
          const { index, enemyId } = enemy
          const fromEnemyId = enemyId
          return (
            <tr key={`${index}-${enemyId}`}>
              <td>
                <TruncateText text={name} className={reason ? 'block text-ink-soft' : 'block text-ink'} />
              </td>
              <td>
                <VitalInput
                  value={enemy.hp}
                  max={enemy.mhp}
                  maxCap={MAX_ENEMY_MHP}
                  label={`${t('events.troop.hpEdit')} ${name}`}
                  maxLabel={`${t('events.troop.mhpEdit')} ${name}`}
                  disabled={!!reason}
                  onValue={(hp) => void run(`hp:${index}`, { op: 'enemyHp', index, fromEnemyId, hp }, t('events.troop.hpOk', { name, hp }))}
                  onMax={(mhp) => void run(`mhp:${index}`, { op: 'enemyMhp', index, fromEnemyId, mhp }, t('events.troop.mhpOk', { name, mhp }))}
                />
              </td>
              <td className="whitespace-nowrap text-ink-soft">{status}</td>
              <td>
                <span className="flex items-center justify-end gap-0.5">
                  {enemy.appeared && !enemy.alive ? (
                    <IconAction
                      label={`${t('events.troop.revive')} ${name}`}
                      tip={t('events.troop.revive')}
                      reason={blocked}
                      busy={busy === `revive:${index}`}
                      disabled={busy != null}
                      onClick={() => void run(`revive:${index}`, { op: 'enemyRevive', index, fromEnemyId }, t('events.troop.reviveOk', { name }))}
                    >
                      <GiHeartPlus size={15} aria-hidden />
                    </IconAction>
                  ) : (
                    <IconAction
                      label={`${t('events.troop.kill')} ${name}`}
                      tip={t('events.troop.kill')}
                      reason={reason}
                      busy={busy === `kill:${index}`}
                      disabled={busy != null}
                      onClick={() => void run(`kill:${index}`, { op: 'enemyKill', index, fromEnemyId }, t('events.troop.killOk', { name }))}
                    >
                      <IoSkullOutline size={15} aria-hidden />
                    </IconAction>
                  )}
                  <IconAction
                    label={`${t('events.battle.recover')} ${name}`}
                    tip={t('events.battle.recover')}
                    reason={blocked || (enemy.appeared ? '' : t('events.troop.enemyHidden'))}
                    busy={busy === `recover:${index}`}
                    disabled={busy != null}
                    onClick={() => void run(`recover:${index}`, { op: 'enemyRecover', index, fromEnemyId }, t('events.battle.recoverOk', { name }))}
                  >
                    <GiHealthIncrease size={15} aria-hidden />
                  </IconAction>
                  <IconAction
                    label={`${t('events.troop.copy')} ${name}`}
                    tip={t('events.troop.copy')}
                    reason={addBlocked}
                    busy={busy === `copy:${index}`}
                    disabled={busy != null}
                    onClick={() => void run(`copy:${index}`, { op: 'enemyAdd', enemyId }, t('events.troop.addOk', { name: enemyName(enemyId) }))}
                  >
                    <GiShadowFollower size={15} aria-hidden />
                  </IconAction>
                  <IconAction
                    label={`${t('events.troop.transform')} ${name}`}
                    tip={t('events.troop.transform')}
                    reason={reason || pickBlocked}
                    busy={busy === `replace:${index}`}
                    disabled={busy != null}
                    onClick={() => setPicking({ mode: 'transform', enemy })}
                  >
                    <RiExchange2Line size={15} aria-hidden />
                  </IconAction>
                </span>
              </td>
            </tr>
          )
        })}
      </DataTable>
      <EnemyPicker
        open={picking != null && !!enemies}
        title={picking?.mode === 'transform' ? t('events.troop.transformTitle', { name: picking.enemy.name || enemyName(picking.enemy.enemyId) }) : t('events.troop.add')}
        note={picking?.mode === 'transform' ? t('events.troop.transformNote') : t('events.troop.addNote')}
        enemies={enemies ?? []}
        portalContainer={portalHost(rootRef.current)}
        onPick={pick}
        onClose={() => setPicking(null)}
      />
    </section>
  )
}
