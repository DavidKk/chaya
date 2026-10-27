import { CompanionRecordingEmitter } from '@/lib/game-agent/companion/core/recording-emitter'
import type { BattleRecordEvent } from '@/lib/game-agent/companion/core/recording-types'

import { battleFrame, runningCoordinator } from './fixtures'

describe('coordinator recording', () => {
  it('records only confirmed commands once, preserves multi-target results and late command scope after a load', () => {
    const records: BattleRecordEvent[] = []
    const { coordinator } = runningCoordinator({ onRecord: (record) => records.push(record) })
    const frame = battleFrame()
    const selection = coordinator.onFrameUpdate(frame)!
    expect(selection.kind).toBe('action')
    if (selection.kind !== 'action') throw new Error('Expected action')
    expect(records.map((record) => record.kind)).toEqual(['encounter_started'])
    coordinator.onCommandCommitted(selection.intent.commandId)
    coordinator.onCommandCommitted(selection.intent.commandId)
    const newScope = { ...frame.stamp.scope, segmentId: 'after-load' }
    coordinator.onFrameUpdate({ ...frame, stamp: { ...frame.stamp, contextEpoch: 2, scope: newScope }, encounterId: 'new-encounter' }, false)
    for (let targetId = 1; targetId <= 2; targetId++) {
      const result = {
        commandId: selection.intent.commandId,
        encounterId: frame.encounterId,
        actionId: 'same-action',
        resultId: `result-${targetId}`,
        observedAt: 100,
        targetId,
        hpDamage: 5,
      }
      coordinator.onCommandResult(result, newScope)
      coordinator.onCommandResult(result, newScope)
    }
    coordinator.onEncounterResult(frame.encounterId, 'win', 4, frame.stamp.scope, 110)
    expect(records.filter((record) => record.kind === 'command_committed')).toHaveLength(1)
    const results = records.filter((record) => record.kind === 'action_result')
    expect(results).toHaveLength(2)
    expect(results.every((record) => record.scope.segmentId === frame.stamp.scope.segmentId)).toBe(true)
    expect(coordinator.ledger.getEncounter(frame.encounterId)).toMatchObject({ outcome: 'win', turnsCount: 4 })
    expect(coordinator.ledger.getOutcomeSummary()).toMatchObject({ total: 2, win: 1, unknown: 1 })
  })

  it('never interrupts local dispatch when the recording sink throws', () => {
    const dispatch = jest.fn()
    const { coordinator } = runningCoordinator({
      onRecord: () => {
        throw new Error('disk offline')
      },
      onDispatchIntent: dispatch,
    })
    coordinator.onFrameUpdate(battleFrame())
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(coordinator.getStatus()).toBe('running')
  })

  it('does not regenerate a different start event when the bounded result cache rolls over', () => {
    const records: BattleRecordEvent[] = []
    const emitter = new CompanionRecordingEmitter((record) => records.push(record))
    const frame = battleFrame()
    emitter.observe(frame)
    for (let i = 0; i < 2100; i++) emitter.result({ encounterId: frame.encounterId, resultId: `r-${i}`, observedAt: i })
    emitter.observe(frame)
    expect(records.filter((record) => record.kind === 'encounter_started')).toHaveLength(1)
  })
})
