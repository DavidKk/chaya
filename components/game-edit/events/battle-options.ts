'use client'

import { useCallback, useState } from 'react'

import { MAX_BATTLE_ENEMIES } from '@/lib/game/battle'
import { readViewState, writeViewState } from '@/lib/view-state'

/** `count`: visible enemies to fight; null keeps the troop as configured */
export type BattleOptions = { canEscape: boolean; canLose: boolean; count: number | null }

const KEY = 'troopBattle'
const DEFAULTS: BattleOptions = { canEscape: true, canLose: false, count: null }

function validCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_BATTLE_ENEMIES ? value : null
}

export function readBattleOptions(): BattleOptions {
  const saved = readViewState(KEY) as Partial<BattleOptions> | undefined
  return {
    canEscape: typeof saved?.canEscape === 'boolean' ? saved.canEscape : DEFAULTS.canEscape,
    canLose: typeof saved?.canLose === 'boolean' ? saved.canLose : DEFAULTS.canLose,
    count: validCount(saved?.count),
  }
}

/** Remembered for the session (sessionStorage), never written to the game */
export function useBattleOptions(): [BattleOptions, (patch: Partial<BattleOptions>) => void] {
  const [options, setOptions] = useState(readBattleOptions)
  const update = useCallback((patch: Partial<BattleOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...patch }
      writeViewState(KEY, next)
      return next
    })
  }, [])
  return [options, update]
}
