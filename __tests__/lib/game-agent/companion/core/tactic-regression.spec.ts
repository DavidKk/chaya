import { chooseAction } from '@/lib/game-agent/companion/core/action-selector'
import { evaluateSituation } from '@/lib/game-agent/companion/core/situation'
import { applyTacticPatch, consumeTactic, DEFAULT_TACTIC_PLAN, validateTacticPatch } from '@/lib/game-agent/companion/core/tactics'
import type { RuleLifetime, TacticPatch, TacticRule } from '@/lib/game-agent/companion/core/types'

import { battleFrame, runningCoordinator } from './fixtures'

const rule = (): TacticRule => ({ id: 'custom', priority: 999, when: { kind: 'always' }, prefer: { kind: 'guard' }, lifetime: { kind: 'persistent' } })
const patch = (r: unknown) => ({ operations: [{ op: 'add_rule', rule: r }], reason: 'Adjust', evidenceRefs: [] })

const invalidRules: Array<[string, (r: Record<string, unknown>) => void]> = [
  [
    'missing children',
    (r) => {
      r.when = { kind: 'all' }
    },
  ],
  [
    'empty children',
    (r) => {
      r.when = { kind: 'any', conditions: [] }
    },
  ],
  [
    'unknown condition',
    (r) => {
      r.when = { kind: 'eval', code: 'throw' }
    },
  ],
  [
    'invalid target',
    (r) => {
      r.when = { kind: 'hp_ratio_below', target: 'boss', threshold: 0.5 }
    },
  ],
  [
    'invalid ratio',
    (r) => {
      r.when = { kind: 'hp_ratio_below', target: 'self', threshold: 1.5 }
    },
  ],
  [
    'NaN priority',
    (r) => {
      r.priority = NaN
    },
  ],
  [
    'infinite threshold',
    (r) => {
      r.when = { kind: 'resource_below', target: 'self', resource: 'mp', threshold: Infinity }
    },
  ],
  [
    'invalid resource',
    (r) => {
      r.when = { kind: 'resource_below', target: 'self', resource: 'hp', threshold: 1 }
    },
  ],
  [
    'missing lifetime id',
    (r) => {
      r.lifetime = { kind: 'encounter' }
    },
  ],
  [
    'unknown lifetime',
    (r) => {
      r.lifetime = { kind: 'forever' }
    },
  ],
  [
    'invalid actor binding',
    (r) => {
      r.lifetime = { kind: 'next_matching_action', actorId: -1 }
    },
  ],
  [
    'unknown action',
    (r) => {
      r.prefer = { kind: 'eval' }
    },
  ],
  [
    'unimplemented item',
    (r) => {
      r.prefer = { kind: 'item', abilityId: 1 }
    },
  ],
  [
    'unimplemented escape',
    (r) => {
      r.prefer = { kind: 'escape' }
    },
  ],
  [
    'invalid ability',
    (r) => {
      r.prefer = { kind: 'skill', abilityId: 0 }
    },
  ],
  [
    'extra executable field',
    (r) => {
      r.script = 'do anything'
    },
  ],
  [
    'oversized text',
    (r) => {
      r.reason = 'x'.repeat(1001)
    },
  ],
  [
    'deep nesting',
    (r) => {
      let c: unknown = { kind: 'always' }
      for (let i = 0; i < 8; i++) c = { kind: 'all', conditions: [c] }
      r.when = c
    },
  ],
]

describe('Tactic safety and selection regressions', () => {
  test.each(invalidRules)('rejects %s without changing the plan', (_name, mutate) => {
    const r = rule() as unknown as Record<string, unknown>
    mutate(r)
    const before = JSON.stringify(DEFAULT_TACTIC_PLAN)
    expect(validateTacticPatch(patch(r)).ok).toBe(false)
    expect(() => applyTacticPatch(DEFAULT_TACTIC_PLAN, patch(r))).toThrow()
    expect(JSON.stringify(DEFAULT_TACTIC_PLAN)).toBe(before)
  })

  test('validates final plan ranges and references atomically', () => {
    const before = JSON.stringify(DEFAULT_TACTIC_PLAN)
    const patches = [
      { operations: [{ op: 'modify_param', ruleId: 'default_emergency_heal', threshold: 2 }] },
      { operations: [{ op: 'modify_param', ruleId: 'default_attack_enemy', threshold: 0.5 }] },
      { operations: [{ op: 'remove_rule', ruleId: 'absent' }] },
      { operations: [{ op: 'replace_rule', ruleId: 'absent', rule: rule() }] },
      { operations: [{ op: 'add_rule', rule: DEFAULT_TACTIC_PLAN.rules[0] }] },
      {
        operations: [
          { op: 'modify_param', ruleId: 'default_emergency_heal', threshold: 0.5 },
          { op: 'remove_rule', ruleId: 'absent' },
        ],
      },
    ]
    for (const input of patches) expect(() => applyTacticPatch(DEFAULT_TACTIC_PLAN, { ...input, reason: 'Adjust', evidenceRefs: [] })).toThrow()
    expect(JSON.stringify(DEFAULT_TACTIC_PLAN)).toBe(before)
    expect(validateTacticPatch({ ...patch(rule()), operations: Array(33).fill(patch(rule()).operations[0]) }).ok).toBe(false)
  })

  test.each<RuleLifetime>([
    { kind: 'encounter', encounterId: 'old' },
    { kind: 'opportunity', opportunityId: 'old-slot' },
    { kind: 'next_matching_action', actorId: 2 },
  ])('does not apply an out-of-scope rule (%s)', (lifetime) => {
    const f = battleFrame()
    const tactic = applyTacticPatch(DEFAULT_TACTIC_PLAN, patch({ ...rule(), lifetime }))
    const chosen = chooseAction(f, evaluateSituation(f), tactic)
    expect(chosen.kind === 'action' && chosen.intent.actionOffer.kind).toBe('attack')
  })

  test('increments tactic revision when a temporary rule expires', () => {
    const initial = applyTacticPatch(DEFAULT_TACTIC_PLAN, patch({ ...rule(), lifetime: { kind: 'encounter', encounterId: 'enc-1' } }))
    const { coordinator: c } = runningCoordinator({ initialTactic: initial })
    c.onFrameUpdate(battleFrame({ encounterId: 'enc-2' }))
    expect(c.getTacticPlan().revision).toBe(initial.revision + 1)
    expect(c.getTacticPlan().rules.some((r) => r.id === 'custom')).toBe(false)
  })

  test('an old commitment cannot consume a replacement one-shot rule', () => {
    const f = battleFrame()
    const initial = applyTacticPatch(DEFAULT_TACTIC_PLAN, patch({ ...rule(), lifetime: { kind: 'next_matching_action' } }))
    const choice = chooseAction(f, evaluateSituation(f), initial)
    if (choice.kind !== 'action') throw new Error('Expected command')
    const next = applyTacticPatch(initial, { operations: [{ op: 'modify_param', ruleId: 'custom', priority: 900 }], reason: 'Adjust', evidenceRefs: [] } satisfies TacticPatch)
    expect(consumeTactic(next, choice.intent).rules.some((r) => r.id === 'custom')).toBe(true)
  })

  test('heals with declared recovery, never chooses an earlier buff or a dead target', () => {
    const f = battleFrame()
    f.party[0].hp = 20
    f.party.push({ ...f.party[0], actorId: 2, index: 1, hp: 0, isDead: true })
    const skill = { ...f.offers[0], kind: 'skill' as const, targetRule: 'one_ally' as const, abilityId: 10, skillTypeId: 1 }
    f.offers.unshift({ ...skill, effect: { kind: 'buff' } }, { ...skill, abilityId: 11, effect: { kind: 'heal' } })
    const chosen = chooseAction(f, evaluateSituation(f), DEFAULT_TACTIC_PLAN)
    expect(chosen.kind === 'action' && chosen.intent.actionOffer.abilityId).toBe(11)
    expect(chosen.kind === 'action' && chosen.intent.target.entityId).toBe(1)
  })

  test('respects a player MP reserve when selecting survival skills', () => {
    const f = battleFrame()
    f.party[0].hp = 20
    f.offers.unshift({ ...f.offers[0], kind: 'skill', targetRule: 'user', costs: { mp: 15, tp: 0 }, effect: { kind: 'heal' } })
    const situation = evaluateSituation(f, [], [{ id: 'reserve', kind: 'reserve_mp', param: 10 }])
    const chosen = chooseAction(f, situation, DEFAULT_TACTIC_PLAN)
    expect(chosen.kind === 'action' && chosen.intent.actionOffer.kind).toBe('guard')
  })
})
