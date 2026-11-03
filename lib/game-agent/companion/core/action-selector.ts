/**
 * Action Selector.
 * Pure logic selecting the next action intent according to dynamic tactics and situation.
 */

import type { SituationEvaluation } from './situation'
import { evaluateCondition, ruleApplies } from './tactics'
import type { ActionOffer, ActionSelectionResult, ActionTargetRef, BattleFrame, BattlePartyEntity, TacticPlan } from './types'

let commandSequence = 0

function generateCommandId(): string {
  commandSequence += 1
  return `cmd-${Date.now()}-${commandSequence}`
}

function selectEnemyTarget(situation: SituationEvaluation, preference?: 'lowest_hp' | 'first_enemy' | 'highest_threat'): ActionTargetRef | null {
  if (!situation.aliveEnemies.length) return null

  if (situation.focusedEnemyId !== undefined) {
    const focused = situation.aliveEnemies.find((e) => e.enemyId === situation.focusedEnemyId)
    if (focused) {
      return {
        kind: 'enemy',
        targetIndex: focused.index,
        entityId: focused.enemyId,
        instanceId: focused.instanceId,
      }
    }
  }

  if (preference === 'lowest_hp' && situation.lowestHpEnemy) {
    return {
      kind: 'enemy',
      targetIndex: situation.lowestHpEnemy.index,
      entityId: situation.lowestHpEnemy.enemyId,
      instanceId: situation.lowestHpEnemy.instanceId,
    }
  }

  const first = situation.aliveEnemies[0]
  return {
    kind: 'enemy',
    targetIndex: first.index,
    entityId: first.enemyId,
    instanceId: first.instanceId,
  }
}

function selectAllyTarget(
  situation: SituationEvaluation,
  currentActor: BattlePartyEntity,
  targetRule: ActionOffer['targetRule'],
  preference?: 'lowest_hp' | 'self'
): ActionTargetRef | null {
  if (targetRule === 'all_allies' || targetRule === 'all_dead_allies') return { kind: 'all_allies' }
  if (targetRule === 'one_dead_ally') {
    const dead = situation.deadParty[0]
    if (!dead) return null
    return {
      kind: 'actor',
      targetIndex: dead.index,
      entityId: dead.actorId,
    }
  }
  if (targetRule === 'user' || (targetRule === 'one_ally' && preference === 'self')) {
    return {
      kind: targetRule === 'user' ? 'user' : 'actor',
      targetIndex: currentActor.index,
      entityId: currentActor.actorId,
    }
  }
  if (targetRule === 'one_ally') {
    const target = preference === 'lowest_hp' && situation.lowestHpAlly ? situation.lowestHpAlly : currentActor
    return {
      kind: 'actor',
      targetIndex: target.index,
      entityId: target.actorId,
    }
  }
  return null
}

export function chooseAction(frame: BattleFrame, situation: SituationEvaluation, tactic: TacticPlan): ActionSelectionResult {
  if (frame.phase === 'party_command') {
    const fightOffer = frame.offers.find((o) => o.actionKey === 'party:fight')
    const opportunityId = frame.opportunity?.opportunityId || `party:${frame.turnCount}`
    if (fightOffer) {
      return {
        kind: 'action',
        intent: {
          commandId: generateCommandId(),
          opportunityId,
          actionOffer: fightOffer,
          target: { kind: 'none' },
          tacticRevision: tactic.revision,
          reason: '全队命令：选择战斗',
        },
      }
    }
    return { kind: 'blocked', reason: '当前无可用的全队战斗指令' }
  }

  if (frame.phase !== 'actor_command' || !frame.opportunity) {
    return { kind: 'wait', reason: `等待引擎阶段（当前阶段：${frame.phase}）` }
  }

  const actorRef = frame.opportunity.actor
  const currentActor = frame.party.find((p) => (actorRef ? p.actorId === actorRef.id : p.index === 0))
  if (!currentActor || currentActor.isDead) {
    return { kind: 'blocked', reason: '当前行动角色无效或已倒下' }
  }

  const actorOffers = frame.offers.filter((o) => {
    if (o.actor && o.actor.id !== currentActor.actorId) return false
    if (o.targetRule === 'unsupported') return false
    if (o.costs.hasUnknownCost || o.costs.mp > currentActor.mp || o.costs.tp > currentActor.tp) return false
    if (o.costs.mp > 0 && currentActor.mp - o.costs.mp < situation.reservedMp) return false
    if (o.abilityId !== undefined) {
      if (o.kind === 'skill' && situation.forbiddenSkills.has(o.abilityId)) return false
      if (o.kind === 'item' && (situation.forbiddenItems.has(0) || situation.forbiddenItems.has(o.abilityId))) return false
    }
    return true
  })

  if (!actorOffers.length) {
    return { kind: 'blocked', reason: `角色 ${currentActor.name} 无可用合法动作` }
  }

  const conditionContext = {
    party: frame.party,
    enemies: frame.enemies,
    currentActor,
  }

  // 0. 救急：复活阵亡队友 (优先复活技能或道具)
  if (situation.deadParty.length > 0) {
    const reviveOffer = actorOffers.find((o) => o.targetRule === 'one_dead_ally' || o.targetRule === 'all_dead_allies')
    if (reviveOffer) {
      const dead = situation.deadParty[0]
      const target: ActionTargetRef = reviveOffer.targetRule === 'all_dead_allies' ? { kind: 'all_allies' } : { kind: 'actor', targetIndex: dead.index, entityId: dead.actorId }
      return {
        kind: 'action',
        intent: {
          commandId: generateCommandId(),
          opportunityId: frame.opportunity.opportunityId,
          actorId: currentActor.actorId,
          actionOffer: reviveOffer,
          target,
          tacticRevision: tactic.revision,
          reason: `救急策略：复活阵亡队友 ${dead.name}`,
        },
      }
    }
  }

  // Iterate through tactic rules by priority
  for (const rule of [...tactic.rules].sort((a, b) => b.priority - a.priority)) {
    if (!ruleApplies(rule, frame)) continue
    const match = evaluateCondition(rule.when, conditionContext)
    if (match !== true) continue

    if (rule.prefer.kind === 'heal') {
      const healOffer = actorOffers.find(
        (o) =>
          o.effect.kind === 'heal' && ['one_ally', 'all_allies', 'user'].includes(o.targetRule) && (rule.prefer.abilityId === undefined || o.abilityId === rule.prefer.abilityId)
      )
      if (healOffer) {
        const target = selectAllyTarget(situation, currentActor, healOffer.targetRule, rule.prefer.targetPreference === 'self' ? 'self' : 'lowest_hp')
        if (target) {
          return {
            kind: 'action',
            intent: {
              commandId: generateCommandId(),
              opportunityId: frame.opportunity.opportunityId,
              actorId: currentActor.actorId,
              actionOffer: healOffer,
              target,
              tacticRevision: tactic.revision,
              appliedRuleId: rule.id,
              appliedRuleSignature: JSON.stringify(rule),
              reason: rule.reason || '治疗生命值最低队友',
            },
          }
        }
      }
    } else if (rule.prefer.kind === 'guard') {
      const guardOffer = actorOffers.find((o) => o.kind === 'guard')
      if (guardOffer) {
        return {
          kind: 'action',
          intent: {
            commandId: generateCommandId(),
            opportunityId: frame.opportunity.opportunityId,
            actorId: currentActor.actorId,
            actionOffer: guardOffer,
            target: { kind: 'user', targetIndex: currentActor.index, entityId: currentActor.actorId },
            tacticRevision: tactic.revision,
            appliedRuleId: rule.id,
            appliedRuleSignature: JSON.stringify(rule),
            reason: rule.reason || '执行防御',
          },
        }
      }
    } else if (rule.prefer.kind === 'attack') {
      const attackOffer = actorOffers.find((o) => o.kind === 'attack')
      if (attackOffer) {
        const target = selectEnemyTarget(situation, rule.prefer.targetPreference === 'first_enemy' ? 'first_enemy' : 'lowest_hp')
        if (target) {
          return {
            kind: 'action',
            intent: {
              commandId: generateCommandId(),
              opportunityId: frame.opportunity.opportunityId,
              actorId: currentActor.actorId,
              actionOffer: attackOffer,
              target,
              tacticRevision: tactic.revision,
              appliedRuleId: rule.id,
              appliedRuleSignature: JSON.stringify(rule),
              reason: rule.reason || '普通攻击目标敌人',
            },
          }
        }
      }
    } else if (rule.prefer.kind === 'skill') {
      const skillOffer = actorOffers.find((o) => {
        if (o.kind !== 'skill') return false
        if (rule.prefer.abilityId !== undefined) return o.abilityId === rule.prefer.abilityId
        return true
      })
      if (skillOffer) {
        let target: ActionTargetRef | null = null
        if (skillOffer.targetRule === 'one_enemy' || skillOffer.targetRule === 'all_enemies') {
          target =
            skillOffer.targetRule === 'all_enemies'
              ? { kind: 'all_enemies' }
              : selectEnemyTarget(situation, rule.prefer.targetPreference === 'first_enemy' ? 'first_enemy' : 'lowest_hp')
        } else if (skillOffer.targetRule === 'none') {
          target = { kind: 'none' }
        } else {
          target = selectAllyTarget(situation, currentActor, skillOffer.targetRule, rule.prefer.targetPreference === 'self' ? 'self' : 'lowest_hp')
        }
        if (target) {
          return {
            kind: 'action',
            intent: {
              commandId: generateCommandId(),
              opportunityId: frame.opportunity.opportunityId,
              actorId: currentActor.actorId,
              actionOffer: skillOffer,
              target,
              tacticRevision: tactic.revision,
              appliedRuleId: rule.id,
              appliedRuleSignature: JSON.stringify(rule),
              reason: rule.reason || `施放技能 ${skillOffer.name}`,
            },
          }
        }
      }
    } else if (rule.prefer.kind === 'item') {
      const itemOffer = actorOffers.find((o) => {
        if (o.kind !== 'item') return false
        if (rule.prefer.abilityId !== undefined) return o.abilityId === rule.prefer.abilityId
        return true
      })
      if (itemOffer) {
        let target: ActionTargetRef | null = null
        if (itemOffer.targetRule === 'one_enemy' || itemOffer.targetRule === 'all_enemies') {
          target =
            itemOffer.targetRule === 'all_enemies'
              ? { kind: 'all_enemies' }
              : selectEnemyTarget(situation, rule.prefer.targetPreference === 'first_enemy' ? 'first_enemy' : 'lowest_hp')
        } else if (itemOffer.targetRule === 'none') {
          target = { kind: 'none' }
        } else if (itemOffer.targetRule === 'one_dead_ally' || itemOffer.targetRule === 'all_dead_allies') {
          const dead = situation.deadParty[0]
          target = itemOffer.targetRule === 'all_dead_allies' ? { kind: 'all_allies' } : dead ? { kind: 'actor', targetIndex: dead.index, entityId: dead.actorId } : null
        } else {
          target = selectAllyTarget(situation, currentActor, itemOffer.targetRule, rule.prefer.targetPreference === 'self' ? 'self' : 'lowest_hp')
        }
        if (target) {
          return {
            kind: 'action',
            intent: {
              commandId: generateCommandId(),
              opportunityId: frame.opportunity.opportunityId,
              actorId: currentActor.actorId,
              actionOffer: itemOffer,
              target,
              tacticRevision: tactic.revision,
              appliedRuleId: rule.id,
              appliedRuleSignature: JSON.stringify(rule),
              reason: rule.reason || `使用道具 ${itemOffer.name}`,
            },
          }
        }
      }
    }
  }

  // Fallback 1: Regular Attack
  const defaultAttack = actorOffers.find((o) => o.kind === 'attack')
  if (defaultAttack) {
    const target = selectEnemyTarget(situation, 'lowest_hp')
    if (target) {
      return {
        kind: 'action',
        intent: {
          commandId: generateCommandId(),
          opportunityId: frame.opportunity.opportunityId,
          actorId: currentActor.actorId,
          actionOffer: defaultAttack,
          target,
          tacticRevision: tactic.revision,
          reason: '兜底策略：普通攻击存活敌人',
        },
      }
    }
  }

  // Fallback 2: Guard
  const defaultGuard = actorOffers.find((o) => o.kind === 'guard')
  if (defaultGuard) {
    return {
      kind: 'action',
      intent: {
        commandId: generateCommandId(),
        opportunityId: frame.opportunity.opportunityId,
        actorId: currentActor.actorId,
        actionOffer: defaultGuard,
        target: { kind: 'user', targetIndex: currentActor.index, entityId: currentActor.actorId },
        tacticRevision: tactic.revision,
        reason: '兜底策略：无法攻击时防御',
      },
    }
  }

  return { kind: 'blocked', reason: '无法为当前角色选定合适目标与动作' }
}
