import type { BattleResultGameEvent } from '@/lib/game-agent/companion/types'

import { hookMethod } from '../../helpers/game/method-hook'
import { call } from './companion-facts-mechanics'

type Loose = Record<string, unknown>

export function installBattleOutcomeHooks(
  battle: Loose,
  currentEncounter: () => string | null,
  clearEncounter: () => void,
  notify: (event: BattleResultGameEvent) => void
): Array<() => void> {
  let escapeDepth = 0
  const emit = (outcome: BattleResultGameEvent['outcome']) => {
    const encounterId = currentEncounter()
    if (!encounterId) return
    const w = globalThis as unknown as Loose
    const party = call<unknown[]>(w.$gameParty, 'aliveMembers') ?? []
    clearEncounter()
    notify({
      kind: 'battle_result',
      encounterId,
      outcome,
      turns: Number(call<number>(w.$gameTroop, 'turnCount') ?? 0),
      survivorActorIds: outcome === 'win' ? party.map((m) => Number(call<number>(m, 'actorId') ?? 0)) : [],
      ...(outcome === 'lose' ? { canLose: Boolean(battle._canLose) } : {}),
      at: Date.now(),
    })
  }
  return [
    ...(['processVictory', 'processDefeat'] as const).map((name) =>
      hookMethod(
        battle,
        name,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            emit(name === 'processVictory' ? 'win' : 'lose')
            return original.apply(this, args)
          }
      )
    ),
    hookMethod(
      battle,
      'processEscape',
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          escapeDepth += 1
          try {
            const result = original.apply(this, args)
            if (result === true) emit('escape')
            return result
          } finally {
            escapeDepth -= 1
          }
        }
    ),
    hookMethod(
      battle,
      'processAbort',
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          const result = original.apply(this, args)
          // Standard MV/MZ successful escape invokes processAbort internally.
          if (escapeDepth === 0) emit('abort')
          return result
        }
    ),
  ]
}
