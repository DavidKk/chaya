import { companionResourceKey, peekCompanionResource, resetCompanionResourcesForTests, scheduleCompanionResource } from '@/services/game-agent/companion-resource.server'
import { readCompanionResourcePolicy } from '@/services/game-agent/companion-resource-settings.server'
import type { GameAgentProfile } from '@/services/game-agent/settings'

jest.mock('@/services/game-agent/companion-resource-settings.server', () => ({ readCompanionResourcePolicy: jest.fn() }))

function deferred<T = string>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
const policy = { capacity: 1, maxRunningPerInstance: 1, maxQueuedPerInstance: 4 }
beforeEach(() => {
  resetCompanionResourcesForTests()
  jest.mocked(readCompanionResourcePolicy).mockImplementation(() => ({ ...policy }))
})

test('capacity two overlaps real runners while enforcing per-instance occupancy', async () => {
  jest.mocked(readCompanionResourcePolicy).mockReturnValue({ ...policy, capacity: 2 })
  const slots = [deferred(), deferred(), deferred()]
  const started: string[] = []
  const run = (id: string, instanceId: string, index: number) =>
    scheduleCompanionResource({
      resourceKey: 'local-inference',
      requestId: id,
      instanceId,
      priority: 'control',
      run: async () => {
        started.push(id)
        return slots[index].promise
      },
    })
  const a = run('a1', 'game-a', 0)
  const a2 = run('a2', 'game-a', 1)
  const b = run('b', 'game-b', 2)
  expect(started).toEqual(['a1', 'b'])
  expect(peekCompanionResource('local-inference')).toMatchObject({ running: 2, queued: 1 })
  slots[0].resolve('a')
  await a
  await tick()
  expect(started).toEqual(['a1', 'b', 'a2'])
  slots[1].resolve('a2')
  slots[2].resolve('b')
  await Promise.all([a2, b])
})

test('cancellation retains occupancy and discards a late successful upstream value', async () => {
  const controller = new AbortController()
  const upstream = deferred()
  let observedSignal!: AbortSignal
  const first = scheduleCompanionResource({
    resourceKey: 'r',
    requestId: '1',
    priority: 'foreground',
    signal: controller.signal,
    run: async (signal) => {
      observedSignal = signal
      return upstream.promise
    },
  })
  const failed = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  const next = jest.fn(async () => 'next')
  const second = scheduleCompanionResource({ resourceKey: 'r', requestId: '2', priority: 'control', run: next })
  controller.abort()
  await tick()
  expect(observedSignal.aborted).toBe(true)
  expect(next).not.toHaveBeenCalled()
  expect(peekCompanionResource('r').running).toBe(1)
  upstream.resolve('late success')
  await failed
  await expect(second).resolves.toBe('next')
})

test('lowering capacity waits for active calls and does not admit a queued call early', async () => {
  let capacity = 2
  jest.mocked(readCompanionResourcePolicy).mockImplementation(() => ({ ...policy, capacity, maxRunningPerInstance: 2 }))
  const first = deferred()
  const second = deferred()
  const a = scheduleCompanionResource({ resourceKey: 'r', requestId: 'a', priority: 'control', run: () => first.promise })
  const b = scheduleCompanionResource({ resourceKey: 'r', requestId: 'b', priority: 'control', run: () => second.promise })
  capacity = 1
  const next = jest.fn(async () => 'c')
  const c = scheduleCompanionResource({ resourceKey: 'r', requestId: 'c', priority: 'control', run: next })
  first.resolve('a')
  await a
  expect(next).not.toHaveBeenCalled()
  second.resolve('b')
  await b
  await expect(c).resolves.toBe('c')
})

test('rotates instances and foreground/control work, before background preparation', async () => {
  const held = deferred()
  const first = scheduleCompanionResource({ resourceKey: 'r', requestId: 'first', instanceId: 'a', priority: 'foreground', run: () => held.promise })
  const order: string[] = []
  const enqueue = (id: string, instanceId: string, priority: 'control' | 'foreground' | 'background') =>
    scheduleCompanionResource({
      resourceKey: 'r',
      requestId: id,
      instanceId,
      priority,
      run: async () => {
        order.push(id)
        return id
      },
    })
  const jobs = [enqueue('a-control', 'a', 'control'), enqueue('b-chat', 'b', 'foreground'), enqueue('a-chat', 'a', 'foreground'), enqueue('prepare', 'b', 'background')]
  held.resolve('first')
  await Promise.all([first, ...jobs])
  expect(order[0]).toBe('b-chat')
  expect(order[1]).toBe('a-control')
  expect(order.at(-1)).toBe('prepare')
})

test('per-instance queue limit leaves room for a different game', async () => {
  jest.mocked(readCompanionResourcePolicy).mockReturnValue({ ...policy, maxQueuedPerInstance: 1 })
  const held = deferred()
  const first = scheduleCompanionResource({ resourceKey: 'r', requestId: 'first', instanceId: 'a', priority: 'control', run: () => held.promise })
  const second = scheduleCompanionResource({ resourceKey: 'r', requestId: 'second', instanceId: 'a', priority: 'control', run: async () => 'second' })
  await expect(scheduleCompanionResource({ resourceKey: 'r', requestId: 'overflow', instanceId: 'a', priority: 'foreground', run: async () => 'overflow' })).rejects.toMatchObject({
    error: { code: 'MODEL_BUSY' },
  })
  const other = scheduleCompanionResource({ resourceKey: 'r', requestId: 'other', instanceId: 'b', priority: 'foreground', run: async () => 'other' })
  held.resolve('first')
  await Promise.all([first, second, other])
})

test('separate resources run independently and IPv6 loopback shares the local lane', async () => {
  const held = deferred()
  const first = scheduleCompanionResource({ resourceKey: 'r1', requestId: '1', priority: 'control', run: () => held.promise })
  await expect(scheduleCompanionResource({ resourceKey: 'r2', requestId: '2', priority: 'control', run: async () => 'parallel' })).resolves.toBe('parallel')
  const profile = { provider: 'ollama', endpoint: 'http://[::1]:11434' } as GameAgentProfile
  expect(companionResourceKey(profile)).toBe('local-inference')
  held.resolve('first')
  await first
})

test('startup allowance does not extend a queued request admission deadline', async () => {
  jest.useFakeTimers()
  try {
    const held = deferred()
    const first = scheduleCompanionResource({ resourceKey: 'cold', requestId: 'loading', priority: 'foreground', run: () => held.promise })
    const run = jest.fn(async () => 'unexpected')
    const queued = scheduleCompanionResource({
      resourceKey: 'cold',
      requestId: 'queued',
      priority: 'foreground',
      totalTimeoutMs: 65_000,
      queueTimeoutMs: 5_000,
      run,
    })
    const failed = expect(queued).rejects.toMatchObject({ error: { code: 'MODEL_TIMEOUT' } })
    await jest.advanceTimersByTimeAsync(5_001)
    await failed
    expect(run).not.toHaveBeenCalled()
    expect(peekCompanionResource('cold')).toMatchObject({ running: 1, queued: 0 })
    held.resolve('ready')
    await first
  } finally {
    jest.useRealTimers()
  }
})
