/**
 * Fast bounded signature calculation for critical game facts.
 * Increments factsRevision on meaningful game state changes without event spam.
 */

import type { CurrentGameFacts } from '@/lib/game-agent/companion/types'

export function computeFactsSignature(facts: CurrentGameFacts): string {
  const scene = facts.scene.value || ''
  const mapId = facts.map.value?.mapId ?? 0
  const encounter = facts.encounterId.value || ''

  const partySig = (facts.party.value ?? []).map((p) => `${p.actorId}:${p.hp}/${p.hpMax}:${p.mp}:${p.states.map((s) => s.stateId).join(',')}`).join('|')

  const enemySig = (facts.enemies.value ?? []).map((e) => `${e.enemyId}:${e.instanceId}:${e.hp ?? '?'}:${e.states.map((s) => s.stateId).join(',')}`).join('|')

  const actionsSig = (facts.legalActions.value ?? []).map((a) => a.actionKey).join(',')

  return `${scene}:${mapId}:${encounter}:${facts.isPaused ? 1 : 0}:${partySig}:${enemySig}:${actionsSig}`
}
