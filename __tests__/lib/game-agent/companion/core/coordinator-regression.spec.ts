import { DEFAULT_TACTIC_PLAN } from '@/lib/game-agent/companion/core/tactics'
import type { ActionIntent, BattleFrame, DecisionTicket, TacticPatch } from '@/lib/game-agent/companion/core/types'

import { battleFrame, runningCoordinator } from './fixtures'

const patch: TacticPatch = { operations: [{ op: 'modify_param', ruleId: 'default_emergency_heal', threshold: 0.5 }], reason: 'Earlier healing', evidenceRefs: [] }

describe('Coordinator regressions', () => {
  afterEach(() => jest.useRealTimers())

  test('reviews repeated emergency-only defense, then pauses without dispatching another endless guard', () => {
    const request = jest.fn()
    const exhausted = jest.fn()
    const intents: ActionIntent[] = []
    const { coordinator } = runningCoordinator({
      onRequestDecision: request,
      onDecisionExhausted: exhausted,
      onDispatchIntent: (intent) => {
        intents.push(intent)
        coordinator.onCommandCommitted(intent.commandId)
      },
    })
    const frame = battleFrame()
    frame.party[0].hp = 10
    for (let turn = 1; turn <= 7; turn++) {
      coordinator.onFrameUpdate({ ...frame, turnCount: turn, opportunity: { ...frame.opportunity!, opportunityId: `turn:${turn}` } })
    }
    expect(intents).toHaveLength(6)
    expect(intents.every((i) => i.actionOffer.kind === 'guard')).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toMatchObject({ reason: 'repeated_emergency_guard', mode: 'deep' })
    expect(exhausted).toHaveBeenCalledWith(expect.stringContaining('保命防御'))
    expect(coordinator.getStatus()).toBe('paused')
    expect(coordinator.getActiveLease()).toBeNull()
  })

  test('does not consider a turn stalled when another actor attacks while a wounded ally guards', () => {
    const request = jest.fn()
    const { coordinator } = runningCoordinator({
      onRequestDecision: request,
      onDispatchIntent: (intent) => coordinator.onCommandCommitted(intent.commandId),
    })
    const frame = battleFrame()
    frame.party = [
      { ...frame.party[0], hp: 10 },
      { ...frame.party[0], actorId: 2, index: 1 },
    ]
    for (let turn = 1; turn <= 9; turn++) {
      for (const slot of [0, 1]) {
        const actor = { kind: 'actor' as const, id: slot + 1, instance: `actor:${slot + 1}` }
        coordinator.onFrameUpdate({
          ...frame,
          turnCount: turn,
          offers: frame.offers.map((offer) => ({ ...offer, actionKey: `actor:${slot + 1}:${offer.kind}`, actor })),
          opportunity: { ...frame.opportunity!, actor, opportunityId: `turn:${turn}:slot:${slot}`, actionSlot: slot },
        })
      }
    }
    expect(request).not.toHaveBeenCalled()
    expect(coordinator.getStatus()).toBe('running')
  })

  test('counts defense committed after the engine advances its resolving turn', () => {
    const request = jest.fn()
    const exhausted = jest.fn()
    const frame = battleFrame()
    frame.party[0].hp = 10
    const { coordinator } = runningCoordinator({
      onRequestDecision: request,
      onDecisionExhausted: exhausted,
      onDispatchIntent: (intent) => {
        coordinator.onFrameUpdate({ ...frame, phase: 'resolving', turnCount: intent.turnCount! + 1, opportunity: null }, false)
        coordinator.onCommandCommitted(intent.commandId)
      },
    })
    for (let turn = 0; turn <= 6; turn++) {
      coordinator.onFrameUpdate({ ...frame, turnCount: turn, opportunity: { ...frame.opportunity!, opportunityId: `turn:${turn}` } })
    }
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ reason: 'repeated_emergency_guard', mode: 'deep' }))
    expect(exhausted).toHaveBeenCalledWith(expect.stringContaining('保命防御'))
    expect(coordinator.getStatus()).toBe('paused')
  })

  test('an accepted attack adjustment clears the defensive streak through actual command commitment', () => {
    let ticket!: DecisionTicket
    const { coordinator } = runningCoordinator({
      onRequestDecision: (next) => {
        ticket = next
      },
      onDispatchIntent: (intent) => coordinator.onCommandCommitted(intent.commandId),
    })
    const frame = battleFrame()
    frame.party[0].hp = 10
    for (let turn = 1; turn <= 4; turn++) {
      coordinator.onFrameUpdate({ ...frame, turnCount: turn, opportunity: { ...frame.opportunity!, opportunityId: `turn:${turn}` } })
    }
    expect(
      coordinator.applyModelTacticPatch(ticket, {
        operations: [{ op: 'remove_rule', ruleId: 'default_self_preserve_guard' }],
        reason: 'Attack to break the stalemate',
        evidenceRefs: [],
      }).accepted
    ).toBe(true)
    for (let turn = 5; turn <= 10; turn++) {
      coordinator.onFrameUpdate({ ...frame, turnCount: turn, opportunity: { ...frame.opportunity!, opportunityId: `turn:${turn}` } })
    }
    expect(coordinator.getStatus()).toBe('running')
    expect(coordinator.getCurrentAction()?.intent.actionOffer.kind).toBe('attack')
  })

  test('refreshes the rule basis at final validation and consumes a replacement one-shot rule', () => {
    const intents: ActionIntent[] = []
    let ticket!: DecisionTicket
    const rule = { id: 'guard', priority: 999, when: { kind: 'always' as const }, prefer: { kind: 'guard' as const }, lifetime: { kind: 'persistent' as const } }
    const { coordinator } = runningCoordinator({
      initialTactic: { schemaVersion: 1, revision: 1, rules: [rule] },
      onDispatchIntent: (intent) => intents.push(intent),
      onRequestDecision: (next) => {
        ticket = next
      },
    })
    const frame = battleFrame()
    coordinator.onFrameUpdate({ ...frame, offers: [] })
    coordinator.onFrameUpdate(frame)
    expect(
      coordinator.applyModelTacticPatch(ticket, {
        operations: [{ op: 'replace_rule', ruleId: rule.id, rule: { ...rule, lifetime: { kind: 'next_matching_action' } } }],
        reason: 'Only once',
        evidenceRefs: [],
      }).accepted
    ).toBe(true)
    expect(coordinator.validateIntent(intents[0], frame)).toBe(true)
    expect(intents[0].tacticRevision).toBe(2)
    expect(coordinator.ledger.getCommand(intents[0].commandId)?.intent.tacticRevision).toBe(2)
    coordinator.onCommandCommitted(intents[0].commandId)
    expect(coordinator.getTacticPlan().rules).toEqual([])
  })

  test('reserves same-turn MP across multiple action slots and resets the budget next turn', () => {
    const intents: ActionIntent[] = []
    const { coordinator } = runningCoordinator({ onDispatchIntent: (intent) => intents.push(intent) })
    const frame = battleFrame()
    frame.party[0].hp = 10
    frame.offers.unshift({
      ...frame.offers[0],
      actionKey: 'actor:1:skill:10',
      kind: 'skill',
      abilityId: 10,
      skillTypeId: 1,
      targetRule: 'user',
      effect: { kind: 'heal' },
      costs: { mp: 15, tp: 0 },
    })
    coordinator.onFrameUpdate(frame)
    expect(intents[0].actionOffer.kind).toBe('skill')
    coordinator.onCommandCommitted(intents[0].commandId)
    coordinator.onFrameUpdate({ ...frame, opportunity: { ...frame.opportunity!, opportunityId: 'slot:1', actionSlot: 1 } })
    expect(intents[1].actionOffer.kind).toBe('guard')
    coordinator.onFrameUpdate({ ...frame, turnCount: 2, opportunity: { ...frame.opportunity!, opportunityId: 'turn:2' } })
    expect(intents[2].actionOffer.kind).toBe('skill')
  })

  test('finished encounters do not consume the pending command limit', () => {
    const intents: ActionIntent[] = []
    const { coordinator } = runningCoordinator({ onDispatchIntent: (intent) => intents.push(intent) })
    for (let index = 0; index < 150; index++) {
      const frame = battleFrame({ encounterId: `enc-${index}` })
      coordinator.onFrameUpdate(frame)
      coordinator.onCommandCommitted(intents[index].commandId)
      coordinator.onEncounterResult(frame.encounterId, 'win', 1)
    }
    expect(intents).toHaveLength(150)
    expect(coordinator.ledger.getPendingCommands()).toHaveLength(0)
  })

  test('keeps observing while waiting for animations, then dispatches on the next opportunity', () => {
    const dispatch = jest.fn()
    const { coordinator: c } = runningCoordinator({ onDispatchIntent: dispatch })
    c.onFrameUpdate(battleFrame({ phase: 'resolving', opportunity: null }))
    expect(c.getStatus()).toBe('waiting_game')
    c.onFrameUpdate(battleFrame())
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(c.getStatus()).toBe('running')
  })

  test('reserves uncertain slots and recognizes delayed commitment before selecting the next slot', () => {
    const intents: ActionIntent[] = []
    const { coordinator: c } = runningCoordinator({ onDispatchIntent: (i) => intents.push(i) })
    const f = battleFrame()
    c.onFrameUpdate(f)
    c.onCommandUnknown(intents[0].commandId)
    c.onFrameUpdate(f)
    expect(intents).toHaveLength(1)
    c.onFrameUpdate({ ...f, opportunity: { ...f.opportunity!, opportunityId: 'slot:1', actionSlot: 1 } })
    expect(intents).toHaveLength(2)
    expect(c.ledger.getCommand(intents[0].commandId)?.lifecycle).toBe('committed')
    expect(c.ledger.getEncounter('enc-1')?.commandsCommitted).toBe(1)
  })

  test('does not dispatch a stored frame on resume or repeat an uncertain slot after resume', () => {
    const dispatch = jest.fn()
    const { coordinator: c, acquire } = runningCoordinator({ onDispatchIntent: dispatch })
    c.onFrameUpdate(battleFrame())
    const id = dispatch.mock.calls[0][0].commandId
    c.onCommandUnknown(id)
    c.pause()
    c.resume(acquire())
    expect(dispatch).toHaveBeenCalledTimes(1)
    c.onFrameUpdate(battleFrame())
    expect(dispatch).toHaveBeenCalledTimes(1)
    c.pause()
    c.resume(acquire())
    c.onFrameUpdate(battleFrame({ phase: 'resolving', opportunity: null }))
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  test('retries timed-out/failed decisions with backoff and a fixed budget, but can resume locally', () => {
    jest.useFakeTimers()
    const request = jest.fn()
    const dispatch = jest.fn()
    const { coordinator: c } = runningCoordinator({ onRequestDecision: request, onDispatchIntent: dispatch })
    const blocked = battleFrame({ offers: [] })
    c.onFrameUpdate(blocked)
    for (let i = 0; i < 10; i++) c.onFrameUpdate(blocked)
    expect(request).toHaveBeenCalledTimes(1)
    c.onDecisionFailed(request.mock.calls[0][0].requestId)
    c.onFrameUpdate(blocked)
    expect(request).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1000)
    c.onFrameUpdate(blocked)
    expect(request).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(18000)
    c.onFrameUpdate(blocked)
    expect(request).toHaveBeenCalledTimes(3)
    jest.advanceTimersByTime(60000)
    c.onFrameUpdate(blocked)
    expect(request).toHaveBeenCalledTimes(3)
    c.onFrameUpdate(battleFrame())
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  test('does not publish running/waiting transitions on every blocked polling tick', () => {
    const status = jest.fn()
    const { coordinator } = runningCoordinator({ onStatusChange: status, onRequestDecision: jest.fn() })
    status.mockClear()
    for (let tick = 0; tick < 10; tick++) coordinator.onFrameUpdate(battleFrame({ offers: [] }))
    expect(status.mock.calls).toEqual([['waiting_decision']])
  })

  test('handles rejected async decision requests through the same bounded retry path', async () => {
    jest.useFakeTimers()
    const request = jest.fn(async () => {
      throw new Error('Model unavailable')
    })
    const { coordinator } = runningCoordinator({ onRequestDecision: request })
    coordinator.onFrameUpdate(battleFrame({ offers: [] }))
    await Promise.resolve()
    coordinator.onFrameUpdate(battleFrame({ offers: [] }))
    expect(request).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1000)
    coordinator.onFrameUpdate(battleFrame({ offers: [] }))
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2)
  })

  test('confirmed party navigation does not fill the pending action limit in a long battle', () => {
    const { coordinator } = runningCoordinator({ onDispatchIntent: (intent) => coordinator.onCommandCommitted(intent.commandId) })
    for (let turn = 0; turn < 300; turn++) {
      coordinator.onFrameUpdate(
        battleFrame({
          turnCount: turn,
          phase: 'party_command',
          opportunity: { opportunityId: `party:${turn}`, actor: null, actionSlot: null, kind: 'party' },
          offers: [{ ...battleFrame().offers[0], actionKey: 'party:fight', actor: null, targetRule: 'none' }],
        })
      )
    }
    expect(coordinator.ledger.getEncounter('enc-1')?.commandsCommitted).toBe(300)
    expect(coordinator.ledger.getPendingCommands()).toHaveLength(0)
  })

  const changes: Array<[string, (f: BattleFrame) => void]> = [
    [
      'context epoch',
      (f) => {
        f.stamp.contextEpoch++
      },
    ],
    [
      'segment',
      (f) => {
        f.stamp.scope.segmentId = 's2'
      },
    ],
    [
      'playthrough',
      (f) => {
        f.stamp.scope.playthroughId = 'p2'
      },
    ],
    [
      'data revision',
      (f) => {
        f.stamp.scope.dataRevision = '2'
      },
    ],
    [
      'encounter',
      (f) => {
        f.encounterId = 'enc-2'
      },
    ],
    [
      'capabilities',
      (f) => {
        f.capabilitiesRevision++
      },
    ],
    [
      'memory epoch',
      (f) => {
        f.decisionVersions!.memoryEpoch++
      },
    ],
    [
      'recording revision',
      (f) => {
        f.decisionVersions!.recordingRevision++
      },
    ],
    [
      'phase dependency',
      (f) => {
        f.phase = 'resolving'
      },
    ],
    [
      'slot dependency',
      (f) => {
        f.opportunity!.opportunityId = 'new-slot'
      },
    ],
  ]
  test.each(changes)('rejects late decisions after %s changes', (_name, change) => {
    let ticket!: DecisionTicket
    const { coordinator: c } = runningCoordinator({
      onRequestDecision: (t) => {
        ticket = t
      },
    })
    const frame = battleFrame({ offers: [], decisionVersions: { memoryEpoch: 7, recordingRevision: 3 } })
    c.onFrameUpdate(frame)
    const old = ticket
    change(frame)
    c.onFrameUpdate(frame, false)
    expect(c.applyModelTacticPatch(old, patch).accepted).toBe(false)
  })

  test('accepts facts-only updates, rejects ticket tampering and prevents a ticket being applied twice', () => {
    let ticket!: DecisionTicket
    const { coordinator: c } = runningCoordinator({
      onRequestDecision: (t) => {
        ticket = t
      },
    })
    const f = battleFrame({ offers: [] })
    c.onFrameUpdate(f)
    expect(ticket.memoryEpoch).toBeUndefined()
    const copy = JSON.parse(JSON.stringify(ticket)) as DecisionTicket
    ticket.dependencies = []
    ticket.expiresAt += 60000
    expect(c.applyModelTacticPatch(ticket, patch).accepted).toBe(false)
    f.stamp.factsRevision++
    c.onFrameUpdate(f, false)
    expect(c.applyModelTacticPatch(copy, patch).accepted).toBe(true)
    expect(c.applyModelTacticPatch(copy, patch).accepted).toBe(false)
  })

  test('isolates caller plans, plan snapshots and different coordinators', () => {
    let ticket!: DecisionTicket
    const initial = JSON.parse(JSON.stringify(DEFAULT_TACTIC_PLAN))
    const before = JSON.stringify(DEFAULT_TACTIC_PLAN)
    const { coordinator: a } = runningCoordinator({
      initialTactic: initial,
      onRequestDecision: (t) => {
        ticket = t
      },
    })
    const { coordinator: b } = runningCoordinator()
    initial.rules[0].when.threshold = 0.9
    a.getTacticPlan().rules[0].priority = 0
    a.onFrameUpdate(battleFrame({ offers: [] }))
    expect(a.applyModelTacticPatch(ticket, patch).accepted).toBe(true)
    expect(a.getTacticPlan().rules[0].when).toMatchObject({ threshold: 0.5 })
    expect(b.getTacticPlan().rules[0].when).toMatchObject({ threshold: 0.35 })
    expect(JSON.stringify(DEFAULT_TACTIC_PLAN)).toBe(before)
  })

  test('consumes one-shot rules exactly once on commit', () => {
    const plan = JSON.parse(JSON.stringify(DEFAULT_TACTIC_PLAN))
    plan.rules.unshift({ id: 'once', priority: 999, when: { kind: 'always' }, prefer: { kind: 'guard' }, lifetime: { kind: 'next_matching_action', actorId: 1 } })
    const intents: ActionIntent[] = []
    const { coordinator: c } = runningCoordinator({ initialTactic: plan, onDispatchIntent: (i) => intents.push(i) })
    c.onFrameUpdate(battleFrame())
    expect(intents[0].appliedRuleId).toBe('once')
    const revision = c.getTacticPlan().revision
    c.onCommandCommitted(intents[0].commandId)
    c.onCommandCommitted(intents[0].commandId)
    expect(c.getTacticPlan().rules.some((r) => r.id === 'once')).toBe(false)
    expect(c.getTacticPlan().revision).toBe(revision + 1)
    expect(c.ledger.getEncounter('enc-1')?.commandsCommitted).toBe(1)
  })

  test('uses reported outcomes and deduplicates command commitments and multi-target results', () => {
    const intents: ActionIntent[] = []
    const { coordinator: c } = runningCoordinator({ onDispatchIntent: (i) => intents.push(i) })
    c.onFrameUpdate(battleFrame())
    const result = { commandId: intents[0].commandId, encounterId: 'enc-1', actionId: 'a1', resultId: 'r1', hpDamage: 10, observedAt: Date.now() }
    c.onCommandResult(result)
    c.onCommandResult(result)
    c.onCommandResult({ ...result, resultId: 'r2' })
    c.onCommandCommitted(intents[0].commandId)
    expect(c.ledger.getCommand(intents[0].commandId)?.results).toHaveLength(2)
    expect(c.ledger.getEncounter('enc-1')?.commandsCommitted).toBe(1)
    c.onFrameUpdate(battleFrame({ phase: 'result', party: [], enemies: [] }))
    expect(c.ledger.getEncounter('enc-1')?.outcome).toBe('unknown')
    c.onEncounterResult('enc-1', 'abort', 3)
    c.onEncounterResult('enc-1', 'escape', 3)
    expect(c.ledger.getEncounter('enc-1')?.outcome).toBe('abort')
  })

  test('a late battle result updates statistics without leaving the paused state', () => {
    const { coordinator } = runningCoordinator()
    coordinator.onFrameUpdate(battleFrame({ phase: 'resolving', opportunity: null }))
    coordinator.pause()
    coordinator.onEncounterResult('enc-1', 'win', 1)
    expect(coordinator.getStatus()).toBe('paused')
    expect(coordinator.getActiveLease()).toBeNull()
    expect(coordinator.ledger.getEncounter('enc-1')?.outcome).toBe('win')
  })
})
