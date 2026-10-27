/**
 * Situation Evaluator.
 * Pure evaluation of battle conditions, risks, and health states.
 */

import type { BattleEnemyEntity, BattleFrame, BattlePartyEntity, ObservedActionResult, PlayerConstraint } from './types'

export type SituationEvaluation = {
  aliveParty: BattlePartyEntity[]
  deadParty: BattlePartyEntity[]
  lowestHpAlly: BattlePartyEntity | null
  averagePartyHpRatio: number
  criticalDanger: boolean
  aliveEnemies: BattleEnemyEntity[]
  lowestHpEnemy: BattleEnemyEntity | null
  recentDamageTaken: number
  recentDamageDealt: number
  forbiddenSkills: Set<number>
  forbiddenItems: Set<number>
  reservedMp: number
  focusedEnemyId?: number
}

export function evaluateSituation(frame: BattleFrame, recentResults: ObservedActionResult[] = [], playerConstraints: PlayerConstraint[] = []): SituationEvaluation {
  const aliveParty = frame.party.filter((m) => !m.isDead && m.hpMax > 0)
  const deadParty = frame.party.filter((m) => m.isDead)

  let lowestHpAlly: BattlePartyEntity | null = null
  let minAllyRatio = Infinity
  let totalPartyHp = 0
  let totalPartyMax = 0

  for (const m of aliveParty) {
    const ratio = m.hp / m.hpMax
    totalPartyHp += m.hp
    totalPartyMax += m.hpMax
    if (ratio < minAllyRatio) {
      minAllyRatio = ratio
      lowestHpAlly = m
    }
  }

  const averagePartyHpRatio = totalPartyMax > 0 ? totalPartyHp / totalPartyMax : 1
  const criticalDanger = minAllyRatio <= 0.25

  const aliveEnemies = frame.enemies.filter((e) => !e.isDead)
  let lowestHpEnemy: BattleEnemyEntity | null = null
  let minEnemyHp = Infinity

  for (const e of aliveEnemies) {
    const hp = typeof e.hp === 'number' ? e.hp : 1
    if (hp < minEnemyHp) {
      minEnemyHp = hp
      lowestHpEnemy = e
    }
  }
  if (!lowestHpEnemy && aliveEnemies.length > 0) {
    lowestHpEnemy = aliveEnemies[0]
  }

  // Sum recent observed results in the current window (e.g. past 15 seconds)
  const now = Date.now()
  const recentWindow = recentResults.filter((r) => now - r.observedAt <= 15_000)
  const recentDamageTaken = recentWindow.filter((r) => r.targetKind === 'actor' && r.hpDamage).reduce((sum, r) => sum + (r.hpDamage || 0), 0)
  const recentDamageDealt = recentWindow.filter((r) => r.targetKind === 'enemy' && r.hpDamage).reduce((sum, r) => sum + (r.hpDamage || 0), 0)

  const forbiddenSkills = new Set<number>()
  const forbiddenItems = new Set<number>()
  let reservedMp = 0
  let focusedEnemyId: number | undefined

  for (const constraint of playerConstraints) {
    if (constraint.kind === 'reserve_mp' && typeof constraint.param === 'number' && Number.isFinite(constraint.param)) {
      reservedMp = Math.max(reservedMp, constraint.param)
    } else if (constraint.kind === 'forbid_skill' && typeof constraint.param === 'number') {
      forbiddenSkills.add(constraint.param)
    } else if (constraint.kind === 'forbid_item' && typeof constraint.param === 'number') {
      forbiddenItems.add(constraint.param)
    } else if (constraint.kind === 'focus_enemy' && typeof constraint.param === 'number') {
      focusedEnemyId = constraint.param
    }
  }

  return {
    aliveParty,
    deadParty,
    lowestHpAlly,
    averagePartyHpRatio,
    criticalDanger,
    aliveEnemies,
    lowestHpEnemy,
    recentDamageTaken,
    recentDamageDealt,
    forbiddenSkills,
    forbiddenItems,
    focusedEnemyId,
    reservedMp,
  }
}
