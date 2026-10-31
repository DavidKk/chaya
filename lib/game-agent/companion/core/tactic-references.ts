import { validatedPatch } from './tactic-validation'
import type { BattleFrame, TacticCondition, TacticPatch } from './types'

/** A syntactically valid model reply still cannot introduce facts absent from its context. */
export function validateTacticReferences(input: unknown, frame: BattleFrame, evidenceIds: string[]): TacticPatch {
  const patch = validatedPatch(input)
  if (patch.operations.length > 4) throw new Error('TACTIC_OPERATION_LIMIT')
  if (patch.evidenceRefs.some((id) => !evidenceIds.includes(id))) throw new Error('UNKNOWN_EVIDENCE')
  const abilities = new Set(frame.offers.flatMap((offer) => (offer.abilityId === undefined ? [] : [offer.abilityId])))
  const states = new Set([...frame.party, ...frame.enemies].flatMap((entity) => entity.states.map((state) => state.id)))
  const checkCondition = (condition: TacticCondition): void => {
    if (condition.kind === 'has_state' && !states.has(condition.stateId)) throw new Error('UNKNOWN_STATE')
    if (condition.kind === 'all' || condition.kind === 'any') condition.conditions.forEach(checkCondition)
  }
  for (const op of patch.operations) {
    if (op.op !== 'add_rule' && op.op !== 'replace_rule') continue
    const { prefer, lifetime, when } = op.rule
    if (prefer.abilityId !== undefined && !abilities.has(prefer.abilityId)) throw new Error('UNKNOWN_ABILITY')
    if (prefer.kind === 'skill' && prefer.abilityId === undefined) throw new Error('SKILL_ID_REQUIRED')
    if (lifetime.kind === 'encounter' && lifetime.encounterId !== frame.encounterId) throw new Error('UNKNOWN_ENCOUNTER')
    if (lifetime.kind === 'opportunity' && lifetime.opportunityId !== frame.opportunity?.opportunityId) throw new Error('UNKNOWN_OPPORTUNITY')
    if (lifetime.kind === 'next_matching_action' && lifetime.actorId !== undefined && !frame.party.some((actor) => actor.actorId === lifetime.actorId)) {
      throw new Error('UNKNOWN_ACTOR')
    }
    checkCondition(when)
  }
  return patch
}
