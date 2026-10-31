import { battleFrame } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import type { EncounterOutcome } from '@/lib/game-agent/companion/core/types'
import type { FactView } from '@/lib/game-agent/companion/types'
import type { AgentTask } from '@/lib/game-agent/runtime'
import { type BattleTaskDeps, runBattleTask } from '@/plugins/mv/src/agent/runtime/companion-core/battle-task'
import { CompanionBattleRuntime, type CompanionRuntimeDeps } from '@/plugins/mv/src/agent/runtime/companion-core/runtime'

jest.mock('@/plugins/mv/src/agent/runtime/companion-core/battle-support', () => ({ battleSupportIssue: () => null }))
jest.mock('@/plugins/mv/src/agent/runtime/companion-core/runtime', () => ({ CompanionBattleRuntime: jest.fn() }))

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function setup(lifetime?: AgentTask['lifetime']) {
  let callbacks!: CompanionRuntimeDeps
  let listener!: Parameters<BattleTaskDeps['facts']['subscribe']>[0]
  let status = 'idle'
  const runtime = {
    start: jest.fn(() => {
      status = 'running'
    }),
    tick: jest.fn(),
    pause: jest.fn(() => {
      status = 'paused'
    }),
    stop: jest.fn(() => {
      status = 'idle'
      callbacks.onStatusChange?.('idle')
    }),
    dispose: jest.fn(),
    whenIdle: jest.fn(async () => undefined),
    getStatus: () => status,
  }
  jest.mocked(CompanionBattleRuntime).mockImplementation((deps) => {
    callbacks = deps
    return runtime as unknown as CompanionBattleRuntime
  })
  const task = { id: 'battle-task', lifetime } as AgentTask
  const outer = new AbortController()
  const unsubscribe = jest.fn()
  const view = { stamp: battleFrame().stamp } as FactView
  const deps = {
    runtimeInstanceId: 'inst-1',
    getCapabilitiesRevision: () => 1,
    facts: {
      current: () => view,
      subscribe: (callback: typeof listener) => {
        listener = callback
        return unsubscribe
      },
    },
    controller: {
      emit: jest.fn(),
      stop: jest.fn(),
      waitForUser: jest.fn(
        (_id, _question, signal: AbortSignal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      ),
    },
  } as unknown as BattleTaskDeps
  return {
    task,
    outer,
    deps,
    runtime,
    view,
    unsubscribe,
    begin: () => runBattleTask(task, outer.signal, deps),
    outcome: (value: EncounterOutcome) => callbacks.onEncounterResult?.('enc-1', value, 3),
    pause: () => callbacks.onStatusChange?.('paused'),
    load: () => listener({ kind: 'load', phase: 'begin' } as Parameters<typeof listener>[0]),
  }
}

test.each(['win', 'escape'] as const)('finishes a one-battle goal on verified %s and disposes listeners', async (outcome) => {
  const s = setup()
  const run = s.begin()
  await flush()
  expect(s.runtime.start).toHaveBeenCalledWith('battle-task')
  s.outcome(outcome)
  await run
  expect(s.deps.controller.emit).toHaveBeenCalledWith('battle-task', 'assistant.completed', expect.objectContaining({ reason: 'answered' }))
  expect(s.unsubscribe).toHaveBeenCalledTimes(1)
  expect(s.runtime.dispose).toHaveBeenCalledTimes(1)
})

test('a persistent goal stays alive after a win until manual takeover', async () => {
  const s = setup('until_stopped')
  const run = s.begin()
  await flush()
  s.outcome('win')
  await flush()
  expect(s.runtime.dispose).not.toHaveBeenCalled()
  s.runtime.stop()
  await run
  expect(s.deps.controller.stop).toHaveBeenCalledWith('battle-task')
})

test.each(['load', 'takeover', 'epoch'] as const)('%s exits a pending user question without requiring an answer', async (kind) => {
  const s = setup()
  const run = s.begin()
  await flush()
  s.pause()
  await flush()
  expect(s.deps.controller.waitForUser).toHaveBeenCalledTimes(1)
  if (kind === 'epoch') s.view.stamp.contextEpoch++
  if (kind === 'takeover') s.runtime.stop()
  else s.load()
  await run
  expect(s.deps.controller.stop).toHaveBeenCalledTimes(1)
  expect(s.runtime.start).toHaveBeenCalledTimes(1)
  expect(s.runtime.dispose).toHaveBeenCalledTimes(1)
})

test('initial constraints finish before input; a load while preparing prevents startup', async () => {
  const s = setup()
  let finish!: () => void
  s.deps.beforeStart = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const run = s.begin()
  await flush()
  expect(s.runtime.start).not.toHaveBeenCalled()
  s.load()
  finish()
  await run
  expect(s.runtime.tick).not.toHaveBeenCalled()
  expect(s.deps.controller.stop).toHaveBeenCalledTimes(1)
})

test('outer task cancellation remains an abort for the task controller', async () => {
  const s = setup()
  const run = s.begin()
  await flush()
  s.outer.abort()
  await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  expect(s.runtime.dispose).toHaveBeenCalledTimes(1)
})
