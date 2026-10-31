import type { BattleDiagnostic } from '@/lib/game-agent/companion/core/diagnostics'

import { battleFrame, runningCoordinator } from './fixtures'

test('selection diagnostics identify the adopted rule and do not repeat for navigation validation', () => {
  const events: BattleDiagnostic[] = []
  const { coordinator } = runningCoordinator({ onDiagnostic: (event) => events.push(event) })
  const frame = battleFrame()
  const selection = coordinator.onFrameUpdate(frame)
  expect(selection?.kind).toBe('action')
  if (selection?.kind !== 'action') throw new Error('Expected local selection')
  expect(events).toEqual([
    expect.objectContaining({
      phase: 'selection',
      stamp: frame.stamp,
      encounterId: frame.encounterId,
      commandId: selection.intent.commandId,
      opportunityId: frame.opportunity!.opportunityId,
      tacticRevision: selection.intent.tacticRevision,
      ruleId: selection.intent.appliedRuleId,
      reason: selection.intent.reason,
      evaluationMs: expect.any(Number),
      selectionMs: expect.any(Number),
      durationMs: expect.any(Number),
    }),
  ])
  expect(coordinator.validateIntent(selection.intent, frame)).toBe(true)
  expect(events).toHaveLength(1)
})

test('correlation diagnostics use actual result IDs and suppress duplicate or unrelated results', () => {
  const events: BattleDiagnostic[] = []
  const { coordinator } = runningCoordinator({ onDiagnostic: (event) => events.push(event) })
  const frame = battleFrame()
  coordinator.onFrameUpdate(frame)
  const commandId = coordinator.getCurrentAction()!.commandId
  const result = { resultId: 'r1', commandId, encounterId: frame.encounterId, observedAt: Date.now() }
  coordinator.onCommandResult(result, frame.stamp.scope)
  coordinator.onCommandResult(result, frame.stamp.scope)
  coordinator.onCommandResult({ ...result, resultId: 'r2', encounterId: 'other' }, frame.stamp.scope)
  expect(events.filter((event) => event.phase === 'result')).toEqual([
    expect.objectContaining({ commandId, resultId: 'r1', reason: 'command_correlated', encounterId: frame.encounterId }),
  ])
})

test('diagnostic failures cannot prevent local dispatch or result recording', () => {
  const dispatch = jest.fn()
  const { coordinator } = runningCoordinator({
    onDiagnostic: () => {
      throw new Error('observer failed')
    },
    onDispatchIntent: dispatch,
  })
  expect(() => coordinator.onFrameUpdate(battleFrame())).not.toThrow()
  expect(dispatch).toHaveBeenCalledTimes(1)
  const commandId = coordinator.getCurrentAction()!.commandId
  coordinator.onCommandResult({ resultId: 'r1', commandId, encounterId: 'enc-1', observedAt: Date.now() })
  expect(coordinator.ledger.getCommand(commandId)?.lifecycle).toBe('observed')
})
