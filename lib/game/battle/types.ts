/** One enemy on the field, by `$gameTroop.members()` index */
export type BattleEnemyState = {
  index: number
  enemyId: number
  /** `Game_Enemy.name()`, including the A / B letter */
  name: string
  hp: number
  mhp: number
  alive: boolean
  /** false: joins mid-battle and has not appeared yet */
  appeared: boolean
}

export type BattleState = {
  enemies: BattleEnemyState[]
  /** Battle is settling (victory / defeat / escape) */
  ended: boolean
}

/** Alive enemies allowed on the field; also the most a troop can be resized to */
export const MAX_BATTLE_ENEMIES = 8

export function battleSignature(state: BattleState | null | undefined): string {
  if (!state) return ''
  return `${state.ended ? 1 : 0}|${state.enemies.map((e) => `${e.index}:${e.enemyId}:${e.hp}:${e.alive ? 1 : 0}:${e.appeared ? 1 : 0}`).join(',')}`
}

export function aliveEnemyCount(state: BattleState | null | undefined): number {
  return state ? state.enemies.filter((e) => e.alive && e.appeared).length : 0
}
