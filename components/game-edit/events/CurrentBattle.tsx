'use client'

import { useEffect, useRef, useState } from 'react'
import { IoAddOutline, IoSwapHorizontalOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, TruncateText } from '@/components/sk'
import { aliveEnemyCount, type BattleEnemyState, type BattleState, MAX_BATTLE_ENEMIES } from '@/lib/game/battle'

import { sectionTitle } from './CommonEventDetail'
import { EnemyPicker } from './EnemyPicker'
import type { EventsOp, EventsSlot } from './types'

type Props = {
  battle: BattleState
  enemies: readonly string[]
  slot: EventsSlot
}

type Picking = { mode: 'transform'; enemy: BattleEnemyState } | { mode: 'add' } | null
/** 'add', or the index of the enemy being transformed */
type Busy = 'add' | number | null

function portalHost(el: HTMLElement | null): Element | null {
  const root = el?.getRootNode()
  return typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? (root as unknown as Element) : null
}

/** Enemies of the running battle: transform one, or add another */
export function CurrentBattle({ battle, enemies, slot }: Props) {
  const t = useT()
  const notify = useNotification()
  const rootRef = useRef<HTMLElement>(null)
  const [picking, setPicking] = useState<Picking>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const blocked = !slot.canAct ? t('events.runNeedLink') : battle.ended ? t('events.troop.battleEnded') : ''
  const full = aliveEnemyCount(battle) >= MAX_BATTLE_ENEMIES
  const addBlocked = blocked || (full ? t('events.troop.addFull', { max: MAX_BATTLE_ENEMIES }) : '')
  const enemyName = (id: number) => enemies[id] || t('events.unnamed', { id })
  const reasonFor = (enemy: BattleEnemyState) => blocked || (!enemy.appeared ? t('events.troop.enemyHidden') : !enemy.alive ? t('events.troop.enemyDown') : '')

  const target = picking?.mode === 'transform' ? battle.enemies.find((e) => e.index === picking.enemy.index && e.enemyId === picking.enemy.enemyId) : null
  const stale = picking?.mode === 'transform' ? !target || !!reasonFor(target) : picking?.mode === 'add' ? !!addBlocked : false
  useEffect(() => {
    if (stale) setPicking(null)
  }, [stale])

  async function pick(enemyId: number) {
    const current = picking
    setPicking(null)
    if (!current) return
    const op: EventsOp = current.mode === 'add' ? { op: 'enemyAdd', enemyId } : { op: 'enemyTransform', index: current.enemy.index, fromEnemyId: current.enemy.enemyId, enemyId }
    setBusy(current.mode === 'add' ? 'add' : current.enemy.index)
    try {
      await slot.onAct(op)
      notify.success(t(current.mode === 'add' ? 'events.troop.addOk' : 'events.troop.transformOk', { name: enemyName(enemyId) }))
    } catch (err) {
      notify.error(t('events.troop.battleFail', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section ref={rootRef} className="shrink-0 border-b border-line pb-1" aria-label={t('events.troop.currentBattle')}>
      <div className="flex items-center gap-2 pr-3">
        <h3 className={`${sectionTitle} flex-1`}>{t('events.troop.currentBattle')}</h3>
        <span className="shrink-0">
          <Button
            variant="plain"
            size="mini"
            loading={busy === 'add'}
            disabled={!!addBlocked || busy != null}
            aria-label={t('events.troop.add')}
            tooltip={addBlocked || `${t('events.troop.add')} · ${t('events.troop.addNote')}`}
            onClick={() => setPicking({ mode: 'add' })}
          >
            <IoAddOutline size={15} aria-hidden />
          </Button>
        </span>
      </div>
      <ul className="m-0 list-none px-1 pl-1">
        {battle.enemies.map((enemy) => {
          const reason = reasonFor(enemy)
          const name = enemy.name || enemyName(enemy.enemyId)
          const label = `${t('events.troop.transform')} ${name}`
          return (
            <li key={`${enemy.index}-${enemy.enemyId}`} className="flex min-w-0 items-center gap-2 rounded-[0.2rem] px-2 py-1 text-[0.8125rem]">
              <TruncateText text={name} className={enemy.alive && enemy.appeared ? 'min-w-0 text-ink' : 'min-w-0 text-ink-soft'} />
              <span className="shrink-0 font-mono text-[0.72rem] whitespace-nowrap text-ink-soft">{t('events.troop.enemyHp', { hp: enemy.hp, mhp: enemy.mhp })}</span>
              {!enemy.appeared ? (
                <Badge dot={false} tone="neutral" className="shrink-0">
                  {t('events.troop.enemyHidden')}
                </Badge>
              ) : !enemy.alive ? (
                <Badge dot={false} tone="neutral" className="shrink-0">
                  {t('events.troop.enemyDown')}
                </Badge>
              ) : null}
              <span className="ml-auto shrink-0">
                <Button
                  variant="plain"
                  size="mini"
                  loading={busy === enemy.index}
                  disabled={!!reason || busy != null}
                  aria-label={label}
                  tooltip={reason || label}
                  onClick={() => setPicking({ mode: 'transform', enemy })}
                >
                  <IoSwapHorizontalOutline size={15} aria-hidden />
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
      <EnemyPicker
        open={picking != null}
        title={picking?.mode === 'transform' ? t('events.troop.transformTitle', { name: picking.enemy.name || enemyName(picking.enemy.enemyId) }) : t('events.troop.add')}
        note={picking?.mode === 'transform' ? t('events.troop.transformNote') : t('events.troop.addNote')}
        enemies={enemies}
        portalContainer={portalHost(rootRef.current)}
        onPick={(id) => void pick(id)}
        onClose={() => setPicking(null)}
      />
    </section>
  )
}
