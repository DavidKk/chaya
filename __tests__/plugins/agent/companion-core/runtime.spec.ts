import { battleFrame } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import type { BattleDiagnostic } from '@/lib/game-agent/companion/core/diagnostics'
import type { BattleFrame, DecisionTicket } from '@/lib/game-agent/companion/core/types'
import type { CompanionDomainEvent, FactView } from '@/lib/game-agent/companion/types'
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
let scene: 'map' | 'battle' | undefined
let diagnostics: BattleDiagnostic[]
let listener: (event: CompanionDomainEvent) => void
const outcome = jest.fn()
const request = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  live = battleFrame()
  available = true
  scene = 'battle'
  diagnostics = []
  unsubscribe = jest.fn()
  jest.mocked(readLiveBattleFrame).mockImplementation(() => live)
  runtime = new CompanionBattleRuntime({
    runtimeInstanceId: 'inst-1',
    arbiter: createControlArbiter(),
    getCapabilitiesRevision: () => 1,
    onRequestDecision: request,
    onDiagnostic: (event) => diagnostics.push(event),
    onEncounterResult: outcome,
    facts: {
      current: () =>
        ({
          stamp: (live || battleFrame()).stamp,
          current: { scene: { known: scene !== undefined, value: scene }, encounterId: { known: available, value: scene === 'map' ? null : 'enc-1' }, isPaused: false },
        }) as FactView,
      subscribe: (callback) => {
        listener = callback
        return unsubscribe
      },
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

test('waits between battles for more than the observation timeout and resumes at the next battle', async () => {
  runtime.start()
  scene = 'map'
  available = false
  live = null
  await jest.advanceTimersByTimeAsync(60_000)
  expect(runtime.getStatus()).toBe('waiting_game')
  expect(execute).not.toHaveBeenCalled()
  expect(runtime.arbiter.currentLease()).not.toBeNull()

  scene = 'battle'
  available = true
  live = battleFrame({ encounterId: 'enc-2' })
  await jest.advanceTimersByTimeAsync(200)
  expect(execute).toHaveBeenCalledTimes(1)
})

test.each(['win', 'escape'] as const)('keeps %s task control through result narration and publishes once after scene exit', async (result) => {
  runtime.start()
  live = battleFrame({ phase: 'resolving', opportunity: null })
  runtime.tick()
  listener({ kind: 'battle_result', encounterId: 'enc-1', outcome: result, turns: 3, survivorActorIds: [1], at: Date.now() })
  live = battleFrame({ phase: 'result', opportunity: null })
  await jest.advanceTimersByTimeAsync(1000)
  expect(outcome).not.toHaveBeenCalled()
  expect(runtime.arbiter.currentLease()).not.toBeNull()
  scene = 'map'
  available = false
  live = null
  await jest.advanceTimersByTimeAsync(400)
  expect(outcome).toHaveBeenCalledTimes(1)
  expect(outcome).toHaveBeenCalledWith('enc-1', result, 3)
})

test.each(['stop', 'context'] as const)('does not publish an old pending result after %s', async (kind) => {
  runtime.start()
  live = battleFrame({ phase: 'resolving', opportunity: null })
  runtime.tick()
  listener({ kind: 'battle_result', encounterId: 'enc-1', outcome: 'win', turns: 3, survivorActorIds: [1], at: Date.now() })
  if (kind === 'stop') runtime.stop()
  else live = battleFrame({ stamp: { ...live.stamp, contextEpoch: live.stamp.contextEpoch + 1 } })
  scene = 'map'
  available = false
  await jest.advanceTimersByTimeAsync(400)
  expect(outcome).not.toHaveBeenCalled()
})

test.each(['battle', undefined] as const)('still pauses after genuinely missing observations in scene %s', async (value) => {
  runtime.start()
  scene = value
  available = false
  live = null
  await jest.advanceTimersByTimeAsync(30_200)
  expect(runtime.getStatus()).toBe('paused')
  expect(runtime.arbiter.currentLease()).toBeNull()
  expect(execute).not.toHaveBeenCalled()
})

test('a legitimate inter-battle wait resets the missing-observation watchdog', async () => {
  runtime.start()
  available = false
  live = null
  await jest.advanceTimersByTimeAsync(25_000)
  scene = 'map'
  await jest.advanceTimersByTimeAsync(10_000)
  scene = 'battle'
  await jest.advanceTimersByTimeAsync(25_000)
  expect(runtime.getStatus()).toBe('waiting_game')
  await jest.advanceTimersByTimeAsync(5_200)
  expect(runtime.getStatus()).toBe('paused')
})

test('reports navigation and engine wait separately with the originating command identity', async () => {
  let finish!: (value: unknown) => void
  execute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  runtime.start()
  runtime.tick()
  await jest.advanceTimersByTimeAsync(600)
  finish({ ok: true, committed: true })
  await Promise.resolve()
  const selected = diagnostics.find((event) => event.phase === 'selection')!
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      phase: 'navigation',
      commandId: selected.commandId,
      durationMs: 600,
      reason: 'committed',
      encounterId: 'enc-1',
      tacticRevision: 1,
      controlGeneration: expect.any(Number),
    })
  )
  live = battleFrame({ phase: 'resolving', opportunity: null })
  runtime.tick()
  await jest.advanceTimersByTimeAsync(2_000)
  live = battleFrame({ phase: 'result', opportunity: null })
  runtime.tick()
  expect(diagnostics.filter((event) => event.phase === 'engine_wait')).toEqual([expect.objectContaining({ durationMs: 2_000, reason: 'phase_changed', encounterId: 'enc-1' })])
})

test('flushes an in-progress engine wait on stop without further polling', async () => {
  live = battleFrame({ phase: 'resolving', opportunity: null })
  runtime.start()
  runtime.tick()
  await jest.advanceTimersByTimeAsync(1_000)
  runtime.stop()
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      phase: 'engine_wait',
      durationMs: 1_000,
      reason: 'execution_stopped',
      controlGeneration: expect.any(Number),
      tacticRevision: 1,
    })
  )
  await jest.advanceTimersByTimeAsync(1_000)
  expect(diagnostics.filter((event) => event.phase === 'engine_wait')).toHaveLength(1)
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

test.each(['unknown', 'error'])('late %s navigation completion preserves stopped status and a newer controller', async (kind) => {
  let finish!: (value: unknown) => void
  let fail!: (error: Error) => void
  execute.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        finish = resolve
        fail = reject
      })
  )
  runtime.start()
  runtime.tick()
  runtime.stop()
  const lease = runtime.arbiter.acquire({ runtimeInstanceId: 'inst-1', ownerId: 'new', scope: 'game', allowedActions: ['*'], requestedAt: Date.now() })
  if (kind === 'error') fail(new Error('late failure'))
  else finish({ ok: false, unknown: true })
  await Promise.resolve()
  expect(runtime.getStatus()).toBe('idle')
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
