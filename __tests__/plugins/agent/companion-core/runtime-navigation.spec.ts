import { battleFrame } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import type { FactView } from '@/lib/game-agent/companion/types'
import { readLiveBattleFrame } from '@/plugins/mv/src/agent/runtime/companion-core/battle-adapter'
import { createBattleNavigationPort } from '@/plugins/mv/src/agent/runtime/companion-core/battle-input'
import type { BattleNavigationPort } from '@/plugins/mv/src/agent/runtime/companion-core/battle-navigator'
import { CompanionBattleRuntime } from '@/plugins/mv/src/agent/runtime/companion-core/runtime'

jest.mock('@/plugins/mv/src/agent/handlers', () => ({ AGENT_MANUAL_INPUT_EVENT: 'manual-input' }))
jest.mock('@/plugins/mv/src/agent/runtime/companion-core/battle-adapter', () => ({ readLiveBattleFrame: jest.fn() }))
jest.mock('@/plugins/mv/src/agent/runtime/companion-core/battle-input', () => ({ createBattleNavigationPort: jest.fn() }))

test('pauses and releases control when a dispatched navigation input has an unknown outcome', async () => {
  jest.useFakeTimers()
  const frame = battleFrame()
  jest.mocked(readLiveBattleFrame).mockReturnValue(frame)
  let busy = false
  let opened = false
  const press = jest.fn<ReturnType<BattleNavigationPort['press']>, Parameters<BattleNavigationPort['press']>>(async (_key, _state, _lease, beforeDispatch) => {
    beforeDispatch?.()
    opened = true
    busy = true
  })
  const readInput = jest.fn<ReturnType<BattleNavigationPort['readInput']>, []>(async () => {
    if (busy) return null
    return {
      controlToken: 't',
      battleInstanceId: 'b',
      kind: opened ? 'enemy' : 'command',
      index: 0,
      maxCols: 1,
      options: opened ? [{ index: 0, enabled: true, entityId: 10, instanceId: 'enemy:0' }] : [{ index: 0, enabled: true, symbol: 'attack' }],
    }
  })
  jest.mocked(createBattleNavigationPort).mockImplementation((_arbiter, readFrame, onConfirming) => ({ readFrame, readInput, onConfirming, press, bindAction: jest.fn() }))
  const arbiter = createControlArbiter()
  const runtime = new CompanionBattleRuntime({
    runtimeInstanceId: 'inst-1',
    arbiter,
    getCapabilitiesRevision: () => 1,
    facts: { current: () => ({ stamp: frame.stamp, current: { encounterId: { known: true, value: frame.encounterId }, isPaused: false } }) as FactView, subscribe: () => () => {} },
  })
  try {
    const lease = runtime.start()
    runtime.tick()
    await jest.advanceTimersByTimeAsync(1)
    expect(press).toHaveBeenCalledTimes(1)
    busy = false
    await jest.advanceTimersByTimeAsync(60000)
    // A later observation must not replay the uncertain input.
    expect(press).toHaveBeenCalledTimes(1)
    expect(readInput).toHaveBeenCalledTimes(2)
    expect(runtime.getStatus()).toBe('paused')
    expect(arbiter.isCurrent(lease)).toBe(false)
    expect(runtime.coordinator.ledger.getPendingCommands()).toEqual([expect.objectContaining({ lifecycle: 'unknown' })])
    expect(() => arbiter.acquire({ runtimeInstanceId: 'inst-1', ownerId: 'other', scope: 'battle', allowedActions: ['attack'], requestedAt: Date.now() })).not.toThrow()
  } finally {
    runtime.dispose()
    jest.useRealTimers()
  }
})
