/** One enemy on the field, by `$gameTroop.members()` index */
export type BattleEnemyState = {
  index: number
  enemyId: number
  /** `Game_Enemy.name()`, including the A / B letter */
  name: string
  hp: number
  mhp: number
  /** `paramMax(0)`, the highest max HP the engine allows (MZ's `Infinity` sent as a large finite number) */
  mhpCap: number
  alive: boolean
  /** false: joins mid-battle and has not appeared yet */
  appeared: boolean
}

/** One battle member, by actor id (stable when the party reorders) */
export type BattleActorState = {
  actorId: number
  name: string
  hp: number
  mhp: number
  mp: number
  mmp: number
  /** `paramMax(0)` / `paramMax(1)`, finite like `BattleEnemyState.mhpCap` */
  mhpCap: number
  mmpCap: number
  tp: number
  /** `maxTp()`, usually 100 */
  maxTp: number
  alive: boolean
}

export type ActorVitalKey = 'hp' | 'mp' | 'mhp' | 'mmp' | 'tp'

export type BattleState = {
  enemies: BattleEnemyState[]
  /** `$gameParty.battleMembers()`, in battle-screen order */
  party: BattleActorState[]
  /** Every party actor id, reserve included; they cannot join again */
  partyIds: number[]
  /** `$gameParty.maxBattleMembers()` */
  partyMax: number
  /** The engine is already ending the battle (victory / defeat / escape / abort under way) */
  settling: boolean
  /** Settling, or every enemy is down even if the engine has not noticed yet; per-unit edits stop */
  ended: boolean
}

/** Alive enemies allowed on the field; also the most a troop can be resized to */
export const MAX_BATTLE_ENEMIES = 8

export function battleSignature(state: BattleState | null | undefined): string {
  if (!state) return ''
  const enemies = state.enemies.map((e) => `${e.index}:${e.enemyId}:${e.hp}:${e.mhp}/${e.mhpCap}:${e.alive ? 1 : 0}:${e.appeared ? 1 : 0}`).join(',')
  const party = state.party.map((a) => `${a.actorId}:${a.hp}:${a.mhp}/${a.mhpCap}:${a.mp}:${a.mmp}/${a.mmpCap}:${a.tp}:${a.alive ? 1 : 0}`).join(',')
  return `${state.ended ? 1 : 0}${state.settling ? 1 : 0}|${enemies}|${party}|${state.partyIds.join(',')}/${state.partyMax}`
}

export function aliveEnemyCount(state: BattleState | null | undefined): number {
  return state ? state.enemies.filter((e) => e.alive && e.appeared).length : 0
}
