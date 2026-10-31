import { validateTacticReferences } from '@/lib/game-agent/companion/core/tactic-references'
import { DEFAULT_TACTIC_PLAN } from '@/lib/game-agent/companion/core/tactics'
import type { TacticRule } from '@/lib/game-agent/companion/core/types'

import { battleFrame } from './fixtures'

const rule = (): TacticRule => ({ ...DEFAULT_TACTIC_PLAN.rules[2], id: 'adjusted', lifetime: { kind: 'encounter', encounterId: 'enc-1' } })
const patch = (value: TacticRule, evidenceRefs: string[] = []) => ({ operations: [{ op: 'add_rule', rule: value }], reason: 'adjust', evidenceRefs })

test('accepts supplied ability, lifetime and evidence references', () => {
  const value = { ...rule(), prefer: { kind: 'skill' as const, abilityId: 1 } }
  expect(validateTacticReferences(patch(value, ['ep1']), battleFrame(), ['ep1'])).toEqual(patch(value, ['ep1']))
})

test.each([
  { prefer: { kind: 'skill', abilityId: 999 } },
  { prefer: { kind: 'skill' } },
  { lifetime: { kind: 'encounter', encounterId: 'other' } },
  { lifetime: { kind: 'opportunity', opportunityId: 'other' } },
  { lifetime: { kind: 'next_matching_action', actorId: 999 } },
  { when: { kind: 'all', conditions: [{ kind: 'has_state', target: 'self', stateId: 999 }] } },
])('rejects invented or missing references: %p', (change) => {
  expect(() => validateTacticReferences(patch({ ...rule(), ...change } as TacticRule), battleFrame(), [])).toThrow()
})

test('rejects historical references that were trimmed out of the model context', () => {
  expect(() => validateTacticReferences(patch(rule(), ['not-supplied']), battleFrame(), ['ep1'])).toThrow('UNKNOWN_EVIDENCE')
})
