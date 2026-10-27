import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import { CompanionCoordinator } from '@/lib/game-agent/companion/core/coordinator'
import type { ActionIntent, BattleFrame, DecisionTicket, TacticPatch } from '@/lib/game-agent/companion/core/types'

import { battleFrame } from './fixtures'

describe('CompanionCoordinator', () => {
  const baseStamp = {
    scope: { libraryGameId: 'g1', dataRevision: '1', playthroughId: 'p1', runtimeInstanceId: 'inst-1', segmentId: 's1' },
    contextEpoch: 1,
    factsRevision: 1,
  }

  test('starts, dispatches actions, and transitions through lifecycle', () => {
    const arbiter = createControlArbiter()
    const dispatched: ActionIntent[] = []

    const coord = new CompanionCoordinator({
      runtimeInstanceId: 'inst-1',
      arbiter,
      onDispatchIntent: (intent) => dispatched.push(intent),
    })

    expect(coord.getStatus()).toBe('idle')

    const lease = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'test-owner',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: Date.now(),
    })

    coord.start(lease)
    expect(coord.getStatus()).toBe('running')

    const frame: BattleFrame = {
      stamp: baseStamp,
      encounterId: 'enc-1',
      turnCount: 1,
      phase: 'party_command',
      opportunity: { opportunityId: 'party:1', actor: null, actionSlot: null, kind: 'party' },
      party: [{ actorId: 1, name: 'Hero', index: 0, hp: 100, hpMax: 100, mp: 20, mpMax: 20, tp: 0, isDead: false, states: [] }],
      enemies: [{ enemyId: 10, instanceId: 'enemy:0', name: 'Slime', index: 0, hp: 20, hpMax: 20, isDead: false, states: [] }],
      offers: [
        {
          actionKey: 'party:fight',
          actor: null,
          kind: 'attack',
          name: '战斗',
          targetRule: 'none',
          costs: { mp: 0, tp: 0 },
          effect: { kind: 'other' },
        },
      ],
      capabilitiesRevision: 1,
    }

    const res = coord.onFrameUpdate(frame)
    expect(res?.kind).toBe('action')
    expect(dispatched.length).toBe(1)
    expect(dispatched[0].actionOffer.actionKey).toBe('party:fight')

    // Command lifecycle progression
    const cmdId = dispatched[0].commandId
    coord.onCommandNavigating(cmdId)
    expect(coord.ledger.getCommand(cmdId)?.lifecycle).toBe('navigating')

    coord.onCommandCommitted(cmdId)
    expect(coord.ledger.getCommand(cmdId)?.lifecycle).toBe('committed')

    coord.onCommandResult({
      commandId: cmdId,
      hpDamage: 10,
      isHit: true,
      observedAt: Date.now(),
    })
    expect(coord.ledger.getCommand(cmdId)?.lifecycle).toBe('observed')
  })

  test('pauses and revokes active lease; resumes with new lease', () => {
    const arbiter = createControlArbiter()
    const coord = new CompanionCoordinator({
      runtimeInstanceId: 'inst-1',
      arbiter,
    })

    const l1 = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'test-owner',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: Date.now(),
    })
    coord.start(l1)
    expect(coord.getStatus()).toBe('running')

    coord.pause()
    expect(coord.getStatus()).toBe('paused')
    expect(arbiter.isCurrent(l1)).toBe(false)

    const l2 = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'test-owner',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: Date.now(),
    })
    coord.resume(l2)
    expect(coord.getStatus()).toBe('running')
    expect(coord.getActiveLease()?.generation).toBe(l2.generation)
  })

  test('handles atomic tactic patch acceptance and rejects stale tickets', () => {
    const arbiter = createControlArbiter()
    let lastTicket: DecisionTicket | null = null

    const coord = new CompanionCoordinator({
      runtimeInstanceId: 'inst-1',
      arbiter,
      onRequestDecision: (t) => {
        lastTicket = t
      },
    })

    const lease = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'test-owner',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: Date.now(),
    })
    coord.start(lease)

    // Trigger decision by providing a blocked frame (no legal actions)
    const blockedFrame: BattleFrame = {
      stamp: baseStamp,
      encounterId: 'enc-1',
      turnCount: 1,
      phase: 'actor_command',
      opportunity: {
        opportunityId: 'actor:1:slot:0',
        actor: { kind: 'actor', id: 1, instance: 'actor:1' },
        actionSlot: 0,
        kind: 'actor',
      },
      party: [{ actorId: 1, name: 'Hero', index: 0, hp: 100, hpMax: 100, mp: 0, mpMax: 20, tp: 0, isDead: false, states: [] }],
      enemies: [],
      offers: [],
      capabilitiesRevision: 1,
    }

    coord.onFrameUpdate(blockedFrame)
    expect(coord.getStatus()).toBe('waiting_decision')
    expect(lastTicket).not.toBeNull()

    const ticket = lastTicket!
    const validPatch: TacticPatch = {
      operations: [
        {
          op: 'modify_param',
          ruleId: 'default_emergency_heal',
          threshold: 0.5,
        },
      ],
      reason: '调整治疗血线',
      evidenceRefs: [],
    }

    // Stale tactic revision rejected
    const staleTicket = { ...ticket, baseTacticRevision: 999 }
    expect(coord.applyModelTacticPatch(staleTicket, validPatch).accepted).toBe(false)

    // Expired ticket rejected
    const expiredTicket = { ...ticket, expiresAt: Date.now() - 1000 }
    expect(coord.applyModelTacticPatch(expiredTicket, validPatch).accepted).toBe(false)

    // Valid patch accepted
    const accepted = coord.applyModelTacticPatch(ticket, validPatch)
    expect(accepted.accepted).toBe(true)
    expect(coord.getTacticPlan().revision).toBe(ticket.baseTacticRevision + 1)
    expect(coord.getStatus()).toBe('running')
  })

  test('adding player constraint increments goalRevision and supersedes ticket', () => {
    const arbiter = createControlArbiter()
    let lastTicket: DecisionTicket | null = null

    const coord = new CompanionCoordinator({
      runtimeInstanceId: 'inst-1',
      arbiter,
      onRequestDecision: (t) => {
        lastTicket = t
      },
    })

    const lease = arbiter.acquire({
      runtimeInstanceId: 'inst-1',
      ownerId: 'test-owner',
      scope: 'battle',
      allowedActions: ['attack'],
      requestedAt: Date.now(),
    })
    coord.start(lease)

    coord.onFrameUpdate(battleFrame({ offers: [] }))
    expect(lastTicket).not.toBeNull()
    const initialGoalRevision = coord.getGoalRevision()
    coord.addPlayerConstraint({
      id: 'no-fire',
      kind: 'forbid_skill',
      param: 15,
    })
    expect(coord.getGoalRevision()).toBe(initialGoalRevision + 1)
    expect(
      coord.applyModelTacticPatch(lastTicket!, {
        operations: [{ op: 'modify_param', ruleId: 'default_emergency_heal', threshold: 0.5 }],
        reason: 'Late adjustment',
        evidenceRefs: [],
      }).accepted
    ).toBe(false)
  })
})
