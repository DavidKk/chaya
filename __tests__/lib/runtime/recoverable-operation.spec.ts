import {
  IdempotentWriteCache,
  OperationCapacityError,
  OperationDeadlineError,
  OperationGeneration,
  OperationTimeoutError,
  runRecoverableOperation,
} from '@/lib/runtime/recoverable-operation'

const identity = (requestId = 'request-1', deadlineAt = Date.now() + 60_000) => ({ requestId, gameId: 'game-1', generation: 0, deadlineAt })

describe('recoverable operation', () => {
  afterEach(() => jest.useRealTimers())

  it('rejects an expired request without starting it', async () => {
    const run = jest.fn(async () => 'done')
    await expect(runRecoverableOperation({ identity: identity('expired', 99), hardLimitMs: 1000, now: () => 100, run })).rejects.toBeInstanceOf(OperationDeadlineError)
    expect(run).not.toHaveBeenCalled()
  })

  it('uses the execution host hard limit and aborts cooperative work', async () => {
    jest.useFakeTimers()
    const aborted = jest.fn()
    const result = runRecoverableOperation({
      identity: identity('slow', Date.now() + 60_000),
      hardLimitMs: 1000,
      run: async (signal) => {
        signal.addEventListener('abort', aborted)
        return new Promise<string>(() => {})
      },
    })
    const expected = expect(result).rejects.toBeInstanceOf(OperationTimeoutError)
    await jest.advanceTimersByTimeAsync(1000)
    await expected
    expect(aborted).toHaveBeenCalledTimes(1)
  })

  it('forwards caller cancellation and clears the timeout', async () => {
    jest.useFakeTimers()
    const controller = new AbortController()
    const result = runRecoverableOperation({
      identity: identity(),
      hardLimitMs: 10_000,
      signal: controller.signal,
      run: async (signal) => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    })
    controller.abort(new Error('cancelled'))
    await expect(result).rejects.toThrow('cancelled')
    expect(jest.getTimerCount()).toBe(0)
  })

  it('stops caller waiting even when underlying work ignores abort', async () => {
    const controller = new AbortController()
    const result = runRecoverableOperation({
      identity: identity(),
      hardLimitMs: 10_000,
      signal: controller.signal,
      run: async () => new Promise<string>(() => {}),
    })
    controller.abort(new Error('stop now'))
    await expect(result).rejects.toThrow('stop now')
  })

  it('fences results after a generation change', () => {
    const generation = new OperationGeneration()
    const first = generation.current()
    expect(generation.isCurrent(first)).toBe(true)
    generation.next()
    expect(generation.isCurrent(first)).toBe(false)
  })
})

describe('idempotent write cache', () => {
  it('returns the same in-flight and completed result for a request id', async () => {
    let finish!: (value: string) => void
    const execute = jest.fn(() => new Promise<string>((resolve) => (finish = resolve)))
    const cache = new IdempotentWriteCache<string>()
    const first = cache.run(identity(), execute)
    const duplicate = cache.run(identity(), execute)
    expect(duplicate).toBe(first)
    await Promise.resolve()
    finish('done')
    await expect(first).resolves.toBe('done')
    await expect(cache.run(identity(), execute)).resolves.toBe('done')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not evict unexpired entries to accept a new write', async () => {
    const now = jest.fn(() => 1000)
    const cache = new IdempotentWriteCache<string>(1, now)
    await cache.run(identity('first', 2000), async () => 'one')
    await expect(cache.run(identity('second', 2000), async () => 'two')).rejects.toBeInstanceOf(OperationCapacityError)
  })

  it('prunes completed entries only after their retention window', async () => {
    let time = 1000
    const cache = new IdempotentWriteCache<string>(1, () => time)
    await cache.run(identity('first', 2000), async () => 'one')
    await Promise.resolve()
    time = 602_001
    await expect(cache.run(identity('second', time + 1000), async () => 'two')).resolves.toBe('two')
  })

  it('allows a request id to execute again after its retained result expires', async () => {
    let time = 1000
    const execute = jest.fn(async () => 'done')
    const cache = new IdempotentWriteCache<string>(1, () => time)
    await cache.run(identity('repeat', 2000), execute)
    await Promise.resolve()
    time = 602_001
    await cache.run(identity('repeat', time + 1000), execute)
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
