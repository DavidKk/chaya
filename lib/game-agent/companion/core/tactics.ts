/**
 * Dynamic Tactics Evaluator & Patch Validator.
 * Provides declarative rule evaluation, condition matching, and atomic patching.
 */

import { clonePlan, validatedPatch, validateTacticPlan } from './tactic-validation'
export { validateTacticPatch } from './tactic-validation'
import type { ActionIntent, BattleEnemyEntity, BattleFrame, BattlePartyEntity, TacticCondition, TacticPlan, TacticRule } from './types'

export const DEFAULT_TACTIC_PLAN: TacticPlan = {
  schemaVersion: 1,
  revision: 1,
  rules: [
    {
      id: 'default_emergency_heal',
      priority: 100,
      when: {
        kind: 'hp_ratio_below',
        target: 'lowest_ally',
        threshold: 0.35,
      },
      prefer: {
        kind: 'heal',
        targetPreference: 'lowest_hp',
      },
      lifetime: { kind: 'persistent' },
      reason: '队友生命危急时优先治疗',
    },
    {
      id: 'default_self_preserve_guard',
      priority: 80,
      when: {
        kind: 'hp_ratio_below',
        target: 'self',
        threshold: 0.2,
      },
      prefer: {
        kind: 'guard',
        targetPreference: 'self',
      },
      lifetime: { kind: 'persistent' },
      reason: '自身生命危急且缺乏治疗时防守',
    },
    {
      id: 'default_attack_enemy',
      priority: 50,
      when: { kind: 'always' },
      prefer: {
        kind: 'attack',
        targetPreference: 'lowest_hp',
      },
      lifetime: { kind: 'persistent' },
      reason: '常规行动：攻击存活敌人',
    },
  ],
}

export type ConditionEvaluationContext = {
  party: BattlePartyEntity[]
  enemies: BattleEnemyEntity[]
  currentActor: BattlePartyEntity | null
  observedHitMargin?: number | null
}

export type ConditionResult = boolean | 'unknown'

export function evaluateCondition(condition: TacticCondition, context: ConditionEvaluationContext): ConditionResult {
  switch (condition.kind) {
    case 'always':
      return true

    case 'hp_ratio_below': {
      const aliveAllies = context.party.filter((m) => !m.isDead && m.hpMax > 0)
      if (!aliveAllies.length) return false
      const threshold = condition.threshold

      if (condition.target === 'self') {
        if (!context.currentActor || context.currentActor.isDead || context.currentActor.hpMax <= 0) return false
        return context.currentActor.hp / context.currentActor.hpMax <= threshold
      }

      if (condition.target === 'lowest_ally') {
        const minRatio = Math.min(...aliveAllies.map((m) => m.hp / m.hpMax))
        return minRatio <= threshold
      }

      if (condition.target === 'any_ally') {
        return aliveAllies.some((m) => m.hp / m.hpMax <= threshold)
      }

      if (condition.target === 'party_avg') {
        const totalHp = aliveAllies.reduce((sum, m) => sum + m.hp, 0)
        const totalMax = aliveAllies.reduce((sum, m) => sum + m.hpMax, 0)
        if (totalMax <= 0) return false
        return totalHp / totalMax <= threshold
      }

      return false
    }

    case 'resource_below': {
      if (!context.currentActor) return false
      const val = condition.resource === 'mp' ? context.currentActor.mp : context.currentActor.tp
      return val <= condition.threshold
    }

    case 'has_state': {
      if (condition.target === 'self') {
        if (!context.currentActor) return false
        return context.currentActor.states.some((s) => s.id === condition.stateId)
      }
      if (condition.target === 'any_ally') {
        return context.party.some((m) => !m.isDead && m.states.some((s) => s.id === condition.stateId))
      }
      if (condition.target === 'any_enemy') {
        return context.enemies.some((e) => !e.isDead && e.states.some((s) => s.id === condition.stateId))
      }
      return false
    }

    case 'enemy_count_at_least': {
      const aliveCount = context.enemies.filter((e) => !e.isDead).length
      return aliveCount >= condition.count
    }

    case 'observed_hit_margin_below': {
      if (typeof context.observedHitMargin === 'number' && Number.isFinite(context.observedHitMargin)) {
        return context.observedHitMargin <= condition.threshold
      }
      return condition.fallbackIfUnknown ? true : 'unknown'
    }

    case 'all': {
      let hasUnknown = false
      for (const sub of condition.conditions) {
        const res = evaluateCondition(sub, context)
        if (res === false) return false
        if (res === 'unknown') hasUnknown = true
      }
      return hasUnknown ? 'unknown' : true
    }

    case 'any': {
      let hasUnknown = false
      for (const sub of condition.conditions) {
        const res = evaluateCondition(sub, context)
        if (res === true) return true
        if (res === 'unknown') hasUnknown = true
      }
      return hasUnknown ? 'unknown' : false
    }

    default:
      return false
  }
}

export function applyTacticPatch(plan: TacticPlan, input: unknown): TacticPlan {
  const patch = validatedPatch(input)
  if (!patch.operations.length) return plan
  const next = clonePlan(plan)
  for (const op of patch.operations) {
    const ruleId = op.op === 'add_rule' ? op.rule.id : op.ruleId
    const idx = next.rules.findIndex((r) => r.id === ruleId)
    if (op.op === 'add_rule') {
      if (idx >= 0) throw new Error('DUPLICATE_RULE')
      next.rules.push(op.rule)
    } else {
      if (idx < 0) throw new Error('RULE_NOT_FOUND')
      if (op.op === 'replace_rule') next.rules[idx] = op.rule
      if (op.op === 'remove_rule') next.rules.splice(idx, 1)
      if (op.op === 'modify_param') {
        const target = next.rules[idx]
        if (op.priority !== undefined) target.priority = op.priority
        if (op.threshold !== undefined) {
          if (!('threshold' in target.when)) throw new Error('RULE_HAS_NO_THRESHOLD')
          target.when.threshold = op.threshold
        }
      }
    }
  }
  next.revision += 1
  next.rules.sort((a, b) => b.priority - a.priority)
  if (!validateTacticPlan(next)) throw new Error('INVALID_RESULTING_PLAN')
  return next
}

export function ruleApplies(rule: TacticRule, frame: BattleFrame): boolean {
  const life = rule.lifetime
  if (life.kind === 'encounter') return life.encounterId === frame.encounterId
  if (life.kind === 'opportunity') return life.opportunityId === frame.opportunity?.opportunityId
  if (life.kind === 'next_matching_action') return life.actorId === undefined || life.actorId === frame.opportunity?.actor?.id
  return true
}

export function expireTactics(plan: TacticPlan, frame: BattleFrame): TacticPlan {
  const rules = plan.rules.filter((r) => {
    if (r.lifetime.kind === 'encounter') return r.lifetime.encounterId === frame.encounterId
    if (r.lifetime.kind === 'opportunity') return r.lifetime.opportunityId === frame.opportunity?.opportunityId
    return true
  })
  return rules.length === plan.rules.length ? plan : { ...plan, rules, revision: plan.revision + 1 }
}

export function consumeTactic(plan: TacticPlan, intent: ActionIntent): TacticPlan {
  const rules = plan.rules.filter(
    (r) =>
      r.id !== intent.appliedRuleId ||
      r.lifetime.kind !== 'next_matching_action' ||
      (intent.appliedRuleSignature ? JSON.stringify(r) !== intent.appliedRuleSignature : intent.tacticRevision !== plan.revision)
  )
  return rules.length === plan.rules.length ? plan : { ...plan, rules, revision: plan.revision + 1 }
}
