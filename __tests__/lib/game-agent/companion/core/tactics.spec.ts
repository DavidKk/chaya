import { applyTacticPatch, DEFAULT_TACTIC_PLAN, evaluateCondition, validateTacticPatch } from '@/lib/game-agent/companion/core/tactics'
import type { BattleEnemyEntity, BattlePartyEntity, TacticPatch } from '@/lib/game-agent/companion/core/types'

describe('Tactics Evaluator and Patching', () => {
  const party: BattlePartyEntity[] = [
    { actorId: 1, name: 'Hero', index: 0, hp: 50, hpMax: 100, mp: 20, mpMax: 50, tp: 10, isDead: false, states: [] },
    { actorId: 2, name: 'Mage', index: 1, hp: 20, hpMax: 100, mp: 10, mpMax: 60, tp: 5, isDead: false, states: [{ id: 4, name: 'Poison' }] },
  ]

  const enemies: BattleEnemyEntity[] = [{ enemyId: 10, instanceId: 'enemy:0', name: 'Bat', index: 0, hp: 30, hpMax: 30, isDead: false, states: [] }]

  test('evaluates hp_ratio_below conditions accurately', () => {
    const ctx = { party, enemies, currentActor: party[0] }

    // self: 50/100 = 0.5
    expect(evaluateCondition({ kind: 'hp_ratio_below', target: 'self', threshold: 0.6 }, ctx)).toBe(true)
    expect(evaluateCondition({ kind: 'hp_ratio_below', target: 'self', threshold: 0.4 }, ctx)).toBe(false)

    // lowest_ally: 20/100 = 0.2
    expect(evaluateCondition({ kind: 'hp_ratio_below', target: 'lowest_ally', threshold: 0.25 }, ctx)).toBe(true)
    expect(evaluateCondition({ kind: 'hp_ratio_below', target: 'lowest_ally', threshold: 0.15 }, ctx)).toBe(false)

    // party_avg: (50+20)/200 = 0.35
    expect(evaluateCondition({ kind: 'hp_ratio_below', target: 'party_avg', threshold: 0.4 }, ctx)).toBe(true)
    expect(evaluateCondition({ kind: 'hp_ratio_below', target: 'party_avg', threshold: 0.3 }, ctx)).toBe(false)
  })

  test('evaluates has_state and resource_below', () => {
    const ctx = { party, enemies, currentActor: party[0] }
    expect(evaluateCondition({ kind: 'has_state', target: 'any_ally', stateId: 4 }, ctx)).toBe(true)
    expect(evaluateCondition({ kind: 'has_state', target: 'self', stateId: 4 }, ctx)).toBe(false)
    expect(evaluateCondition({ kind: 'resource_below', target: 'self', resource: 'mp', threshold: 25 }, ctx)).toBe(true)
    expect(evaluateCondition({ kind: 'resource_below', target: 'self', resource: 'mp', threshold: 10 }, ctx)).toBe(false)
  })

  test('evaluates composite all and any conditions', () => {
    const ctx = { party, enemies, currentActor: party[0] }
    expect(
      evaluateCondition(
        {
          kind: 'all',
          conditions: [
            { kind: 'hp_ratio_below', target: 'self', threshold: 0.6 },
            { kind: 'resource_below', target: 'self', resource: 'mp', threshold: 30 },
          ],
        },
        ctx
      )
    ).toBe(true)
  })

  test('validates and applies valid tactic patch atomically', () => {
    const patch: TacticPatch = {
      operations: [
        {
          op: 'add_rule',
          rule: {
            id: 'custom_high_dmg_rule',
            priority: 95,
            when: { kind: 'hp_ratio_below', target: 'lowest_ally', threshold: 0.45 },
            prefer: { kind: 'heal', targetPreference: 'lowest_hp' },
            lifetime: { kind: 'persistent' },
            reason: '提高治疗触发血线',
          },
        },
      ],
      reason: '敌方单次伤害较高，提前喝药',
      evidenceRefs: [],
    }

    expect(validateTacticPatch(patch).ok).toBe(true)

    const newPlan = applyTacticPatch(DEFAULT_TACTIC_PLAN, patch)
    expect(newPlan.revision).toBe(DEFAULT_TACTIC_PLAN.revision + 1)
    expect(newPlan.rules.some((r) => r.id === 'custom_high_dmg_rule')).toBe(true)
    // Check sorted by priority
    expect(newPlan.rules[0].priority).toBeGreaterThanOrEqual(newPlan.rules[1].priority)
  })

  test('rejects invalid patch operations', () => {
    const invalidPatch = {
      operations: [{ op: 'unknown_op' }],
    } as unknown as TacticPatch

    expect(validateTacticPatch(invalidPatch).ok).toBe(false)
    expect(() => applyTacticPatch(DEFAULT_TACTIC_PLAN, invalidPatch)).toThrow()
  })
})
