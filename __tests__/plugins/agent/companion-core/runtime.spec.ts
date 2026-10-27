import { battleFrame } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import type { BattleFrame, DecisionTicket } from '@/lib/game-agent/companion/core/types'
import type { FactView } from '@/lib/game-agent/companion/types'
import { readLiveBattleFrame } from '@/plugins/mv/src/agent/runtime/companion-core/battle-adapter'
import { BattleNavigator } from '@/plugins/mv/src/agent/runtime/companion-core/battle-navigator'
import { CompanionBattleRuntime } from '@/plugins/mv/src/agent/runtime/companion-core/runtime'

jest.mock('@/plugins/mv/src/agent/handlers', () => ({ AGENT_MANUAL_INPUT_EVENT: 'manual-input', runAgentCommand: jest.fn() }))
jest.mock('@/plugins/mv/src/agent/runtime/companion-core/battle-adapter', () => ({ readLiveBattleFrame: jest.fn() }))
jest.mock('@/plugins/mv/src/agent/runtime/companion-core/battle-navigator', () => ({ BattleNavigator: jest.fn(() => ({ execute: jest.fn() })) }))

let live: BattleFrame | null
let runtime: CompanionBattleRuntime
let execute: jest.Mock
let unsubscribe: jest.Mock
let available: boolean
const request = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  live = battleFrame()
  available = true
  unsubscribe = jest.fn()
  jest.mocked(readLiveBattleFrame).mockImplementation(() => live)
  runtime = new CompanionBattleRuntime({
    runtimeInstanceId: 'inst-1',
    arbiter: createControlArbiter(),
    getCapabilitiesRevision: () => 1,
    onRequestDecision: request,
    facts: {
      current: () => ({ stamp: (live || battleFrame()).stamp, current: { encounterId: { known: available, value: 'enc-1' }, isPaused: false } }) as FactView,
      subscribe: () => unsubscribe,
    },
  })
  execute = jest.mocked(BattleNavigator).mock.results.at(-1)!.value.execute
  execute.mockResolvedValue({ ok: false, unknown: true, reason: 'PENDING' })
})
afterEach(() => {
  runtime.dispose()
  jest.useRealTimers()
})

test('keeps polling through animations and unavailable observations', async () => {
  runtime.start()
  available = false
  await jest.advanceTimersByTimeAsync(200)
  expect(runtime.getStatus()).toBe('waiting_game')
  expect(execute).not.toHaveBeenCalled()
  available = true
  live = battleFrame({ phase: 'resolving', opportunity: null })
  await jest.advanceTimersByTimeAsync(200)
  live = battleFrame()
  await jest.advanceTimersByTimeAsync(200)
  expect(execute).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(2000)
  expect(execute).toHaveBeenCalledTimes(1)
})

test('observes new slots during navigation without overlapping inputs', async () => {
  let finish!: (value: unknown) => void
  execute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  runtime.start()
  runtime.tick()
  live = battleFrame({ opportunity: { ...battleFrame().opportunity!, opportunityId: 'slot:1', actionSlot: 1 } })
  await jest.advanceTimersByTimeAsync(400)
  expect(execute).toHaveBeenCalledTimes(1)
  runtime.pause()
  expect(() => runtime.resume()).toThrow('CONTROL_BUSY_OR_DISPOSED')
  finish({ ok: false, unknown: true, reason: 'REVOKED' })
  await Promise.resolve()
  runtime.resume()
  expect(execute).toHaveBeenCalledTimes(1)
  runtime.tick()
  await Promise.resolve()
  expect(execute).toHaveBeenCalledTimes(2)
})

test('does not replay an uncertain slot or a cached frame after pause/resume', async () => {
  runtime.start()
  runtime.tick()
  await Promise.resolve()
  runtime.pause()
  runtime.resume()
  expect(execute).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(400)
  expect(execute).toHaveBeenCalledTimes(1)
})

test('reobserves the live context when applying a decision between timer ticks', () => {
  live = battleFrame({ offers: [] })
  runtime.start()
  runtime.tick()
  expect(runtime.getStatus()).toBe('waiting_decision')
  const ticket = request.mock.calls[0][0] as DecisionTicket
  live.stamp.contextEpoch++
  const result = runtime.applyTacticPatch(ticket, { operations: [{ op: 'modify_param', ruleId: 'default_emergency_heal', threshold: 0.5 }], reason: 'change', evidenceRefs: [] })
  expect(result.accepted).toBe(false)
  expect(runtime.getTacticPlan().rules[0].when).toMatchObject({ threshold: 0.35 })
})

test('shares control with other tasks and cannot start when their lease is held', () => {
  const lease = runtime.arbiter.acquire({ runtimeInstanceId: 'inst-1', ownerId: 'other-task', scope: 'battle', allowedActions: ['attack'], requestedAt: Date.now() })
  expect(() => runtime.start()).toThrow('CONTROL_BUSY_OR_DISPOSED')
  expect(runtime.arbiter.isCurrent(lease)).toBe(true)
  runtime.stop()
  expect(runtime.arbiter.isCurrent(lease)).toBe(true)
})

test('dispose releases its lease, cancels polling and removes the facts subscription', async () => {
  const lease = runtime.start()
  runtime.dispose()
  expect(runtime.arbiter.isCurrent(lease)).toBe(false)
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(1000)
  expect(execute).not.toHaveBeenCalled()
  expect(() => runtime.start()).toThrow('CONTROL_BUSY_OR_DISPOSED')
})
