import { battleFrame, runningCoordinator } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { experienceBatch, hpResult } from '@/__tests__/lib/game-agent/companion/experience-fixtures'
import type { ActionIntent, DecisionTicket } from '@/lib/game-agent/companion/core/types'
import { createGameplayMemoryStore, type GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { AgentTask, RuntimeMessage } from '@/lib/game-agent/runtime'
import type { CompanionComplete } from '@/plugins/mv/src/agent/runtime/companion-chat'
import { buildBattleDecisionMessages, createBattleDecisions } from '@/plugins/mv/src/agent/runtime/companion-core/battle-decisions'
import type { CompanionBattleRuntime } from '@/plugins/mv/src/agent/runtime/companion-core/runtime'

const patch = { operations: [{ op: 'modify_param', ruleId: 'default_emergency_heal', threshold: 0.5 }], reason: 'adjust', evidenceRefs: [] }

function setup() {
  const tickets: DecisionTicket[] = []
  const intents: ActionIntent[] = []
  const { coordinator } = runningCoordinator({
    onRequestDecision: (ticket) => {
      tickets.push(ticket)
    },
    onDispatchIntent: (intent) => {
      intents.push(intent)
    },
  })
  const controller = new AbortController()
  const runtime = {
    coordinator,
    applyTacticPatch: (ticket: DecisionTicket, value: unknown) => coordinator.applyModelTacticPatch(ticket, value),
    onDecisionFailed: (id: string) => coordinator.onDecisionFailed(id),
  } as CompanionBattleRuntime
  const complete = jest.fn<ReturnType<CompanionComplete>, Parameters<CompanionComplete>>()
  const result = jest.fn()
  const deps = {
    complete,
    signal: controller.signal,
    getRuntime: () => runtime,
    memory: {
      queryDetailed: jest.fn(() => ({ episodes: [] })),
      queryExperiences: jest.fn(() => ({ coverage: 'retained_observations', experiences: [] })),
    } as unknown as GameplayMemoryStore,
    task: { id: 't1', profileId: 'p1', model: 'small', goal: '接手战斗，不能用道具' } as AgentTask,
    onResult: result,
  }
  return { coordinator, tickets, intents, controller, runtime, deps, complete, result, decisions: createBattleDecisions(deps) }
}

test('routine actions make no model calls and a blocked opportunity uses the quick ticket once', async () => {
  const s = setup()
  s.coordinator.onFrameUpdate(battleFrame())
  expect(s.complete).not.toHaveBeenCalled()
  s.coordinator.onFrameUpdate(battleFrame({ offers: [], opportunity: { ...battleFrame().opportunity!, opportunityId: 'blocked' } }))
  const ticket = s.tickets[0]
  s.complete.mockResolvedValue({
    role: 'assistant',
    content: JSON.stringify(patch),
    companionMetrics: { totalMs: 30, queueMs: 10, generationMs: 20, contextMs: 1 },
  })
  await s.decisions.request(ticket)
  expect(s.complete).toHaveBeenCalledTimes(1)
  expect(s.complete.mock.calls[0][1]).toMatchObject({ purpose: 'tactic-quick', model: 'small', profileId: 'p1' })
  expect(s.result).toHaveBeenCalledWith(
    expect.objectContaining({
      accepted: true,
      metrics: expect.objectContaining({ queueMs: 10, generationMs: 20, totalMs: expect.any(Number), contextMs: expect.any(Number) }),
    })
  )
  expect(s.coordinator.getTacticPlan().rules[0].when).toMatchObject({ threshold: 0.5 })
})

test('an unchanged strategy is accepted without inventing a new revision', async () => {
  const s = setup()
  s.coordinator.onFrameUpdate(battleFrame({ offers: [] }))
  s.complete.mockResolvedValue({ role: 'assistant', content: '```json\n{"operations":[],"reason":"keep current policy","evidenceRefs":[]}\n```' })
  await s.decisions.request(s.tickets[0])
  expect(s.result).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }))
  expect(s.coordinator.getTacticPlan().revision).toBe(1)
})

test('a deep review runs while local commands continue and uses a separate purpose', async () => {
  const s = setup()
  s.coordinator.onFrameUpdate(battleFrame())
  const hurt = battleFrame()
  hurt.party[0].hp = 50
  hurt.opportunity!.opportunityId = 'second'
  s.coordinator.onFrameUpdate(hurt)
  expect(s.tickets[0].mode).toBe('deep')
  expect(s.intents).toHaveLength(2)
  s.complete.mockResolvedValue({ role: 'assistant', content: JSON.stringify(patch) })
  await s.decisions.request(s.tickets[0])
  expect(s.complete.mock.calls[0][1].purpose).toBe('tactic-deep')
})

test.each(['stop', 'constraint', 'epoch'] as const)('rejects a %s change while model output is in flight', async (change) => {
  const s = setup()
  const frame = battleFrame({ offers: [] })
  s.coordinator.onFrameUpdate(frame)
  let resolve!: (message: RuntimeMessage) => void
  s.complete.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const pending = s.decisions.request(s.tickets[0])
  // A duplicate request cannot overlap an upstream call.
  await s.decisions.request(s.tickets[0])
  expect(s.complete).toHaveBeenCalledTimes(1)
  if (change === 'stop') {
    s.controller.abort()
    s.coordinator.stop()
  }
  if (change === 'constraint') s.coordinator.addPlayerConstraint({ id: 'reserve', kind: 'reserve_mp', param: 10 })
  if (change === 'epoch') {
    frame.stamp.contextEpoch++
    s.coordinator.onFrameUpdate(frame, false)
  }
  resolve({ role: 'assistant', content: JSON.stringify(patch) })
  await pending
  expect(s.coordinator.getTacticPlan().revision).toBe(1)
  s.decisions.close()
})

test('mandatory goal and constraints survive budgeting; oversized required context fails explicitly', () => {
  const s = setup()
  s.coordinator.addPlayerConstraint({ id: 'no1', kind: 'forbid_skill', param: 1 })
  s.coordinator.onFrameUpdate(battleFrame({ offers: [] }))
  const messages = buildBattleDecisionMessages(s.deps, s.tickets[0])!
  const payload = JSON.parse(messages[1].content)
  expect(payload.goal).toBe(s.deps.task.goal)
  expect(payload.constraints).toEqual([{ id: 'no1', kind: 'forbid_skill', param: 1 }])
  s.deps.task.goal = 'x'.repeat(12000)
  expect(() => buildBattleDecisionMessages(s.deps, s.tickets[0])).toThrow('TACTIC_REQUIRED_CONTEXT_EXCEEDS_BUDGET')
})

test('tactic requests can cite canonical committed experiences and reject references outside supplied context', async () => {
  const s = setup()
  const memory = createGameplayMemoryStore()
  const scope = battleFrame().stamp.scope
  memory.acceptCommittedRecording({
    schemaVersion: 1,
    batchId: 'recorded',
    memoryEpoch: 1,
    recordingRevision: 1,
    at: 1,
    battleRecording: {
      schemaVersion: 1,
      events: [
        {
          scope,
          encounterId: 'previous',
          at: 1,
          eventId: 'result',
          kind: 'action_result',
          result: {
            resultId: 'result',
            observedAt: 1,
            evidence: {
              actionId: 'action',
              resultId: 'result',
              source: { kind: 'actor', id: 1 },
              target: { kind: 'enemy', id: 10, instance: 'enemy:0' },
              hpBefore: null,
              hpAfter: null,
              reportedHpDamage: 5,
              attribution: 'observed_action',
            },
          },
        },
        { scope, encounterId: 'previous', at: 2, eventId: 'finish', kind: 'encounter_finished', outcome: 'win', turns: 2 },
      ],
    },
  })
  s.deps.memory = memory
  s.coordinator.onFrameUpdate(battleFrame({ offers: [] }))
  const messages = buildBattleDecisionMessages(s.deps, s.tickets[0])!
  const episodes = JSON.parse(messages[1].content).episodes
  expect(episodes).toEqual([expect.objectContaining({ episodeId: expect.stringMatching(/^recording:/), completeness: 'partial' })])
  s.complete.mockResolvedValue({ role: 'assistant', content: JSON.stringify({ ...patch, evidenceRefs: [episodes[0].episodeId] }) })
  await s.decisions.request(s.tickets[0])
  expect(s.result).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }))
  s.coordinator.onFrameUpdate(battleFrame({ offers: [], opportunity: { ...battleFrame().opportunity!, opportunityId: 'next' } }))
  s.complete.mockResolvedValue({ role: 'assistant', content: JSON.stringify({ ...patch, evidenceRefs: ['not-supplied'] }) })
  await s.decisions.request(s.tickets.at(-1)!)
  expect(s.result).toHaveBeenLastCalledWith(expect.objectContaining({ accepted: false }))
  await memory.close()
})

test.each([false, true])('conditional HP references are usable only when included within the context budget (trimmed=%s)', async (trimmed) => {
  const s = setup()
  const memory = createGameplayMemoryStore()
  try {
    memory.acceptCommittedRecording(experienceBatch([hpResult(0), hpResult(1), hpResult(2)]))
    s.deps.memory = memory
    s.coordinator.onFrameUpdate(battleFrame({ offers: [] }))
    const messages = buildBattleDecisionMessages(s.deps, s.tickets[0])!
    const payload = JSON.parse(messages[1].content)
    expect(payload).toMatchObject({
      experienceCoverage: 'retained_observations',
      experiences: [expect.objectContaining({ sampleActions: 3, status: 'conditionally_supported', applicability: 'matching_observed_conditions' })],
    })
    const ref = payload.experiences[0].experienceId
    if (trimmed) {
      payload.goal = ''
      payload.experiences = []
      s.deps.task.goal = 'x'.repeat(11_900 - messages[0].content.length - JSON.stringify(payload).length - 10)
      const budgeted = buildBattleDecisionMessages(s.deps, s.tickets[0])!
      expect(JSON.parse(budgeted[1].content).experiences).toEqual([])
      expect(budgeted.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(11_900)
    }
    s.complete.mockResolvedValue({ role: 'assistant', content: JSON.stringify({ ...patch, evidenceRefs: [ref] }) })
    await s.decisions.request(s.tickets[0])
    expect(s.result).toHaveBeenCalledWith(expect.objectContaining({ accepted: !trimmed, ...(trimmed ? { reason: 'UNKNOWN_EVIDENCE' } : {}) }))
  } finally {
    await memory.close()
  }
})
