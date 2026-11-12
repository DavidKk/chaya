import { engineConfiguredCapacity, withEngineCapacity } from '@/services/translate/scheduler/engine-capacity'

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

it('retains capacity for non-cancellable transport work and removes aborted waiters', async () => {
  const finishes: Array<(value: string) => void> = []
  const work = jest.fn(() => new Promise<string>((resolve) => finishes.push(resolve)))
  const settings = { concurrencyLimit: 4 }
  const requests = Array.from({ length: 4 }, () => withEngineCapacity('google', 'test:noncancellable', work, undefined, settings))
  await tick()
  expect(work).toHaveBeenCalledTimes(4)
  const controller = new AbortController()
  const cancelled = withEngineCapacity('google', 'test:noncancellable', work, controller.signal, settings).catch((error: Error) => error.message)
  const queued = withEngineCapacity('google', 'test:noncancellable', work, undefined, settings)
  controller.abort(new Error('Cancelled before dispatch'))
  expect(await cancelled).toBe('Cancelled before dispatch')
  await tick()
  expect(work).toHaveBeenCalledTimes(4)
  finishes[0]('done')
  await tick()
  expect(work).toHaveBeenCalledTimes(5)
  for (const finish of finishes) finish('done')
  await Promise.all([...requests, queued])
})

it('continues to count a running adapter after its signal is aborted', async () => {
  let finish: (value: string) => void = () => {}
  const controller = new AbortController()
  const first = withEngineCapacity(
    'bergamot',
    'test:running',
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
    controller.signal
  )
  await tick()
  controller.abort()
  const next = jest.fn(async () => 'next')
  const second = withEngineCapacity('bergamot', 'test:running', next)
  await tick()
  expect(next).not.toHaveBeenCalled()
  finish('first')
  expect(await first).toBe('first')
  expect(await second).toBe('next')
})

it.each(['google', 'apple', 'agent:a'] as const)('allows ten full character batches independently for %s', async (engine) => {
  expect(engineConfiguredCapacity('agent:a', { concurrencyLimit: 2 })).toBe(2)
  expect(engineConfiguredCapacity('agent:a', { concurrencyLimit: 10, allowConcurrency: false })).toBe(1)
  expect(engineConfiguredCapacity('google', { allowConcurrency: false })).toBe(1)
  expect(engineConfiguredCapacity('google', { concurrencyLimit: 2 })).toBe(2)

  const finishes: Array<(value: string) => void> = []
  const work = jest.fn(() => new Promise<string>((resolve) => finishes.push(resolve)))
  expect(engineConfiguredCapacity('apple', { concurrencyLimit: 1 })).toBe(40)
  expect(engineConfiguredCapacity('apple', { concurrencyLimit: 2 })).toBe(40)
  expect(engineConfiguredCapacity('apple', { allowConcurrency: false, concurrencyLimit: 40 })).toBe(1)

  const settings = { concurrencyLimit: 10, maxConcurrentChars: 4000, chars: 4000 }
  const slots = engineConfiguredCapacity(engine, settings)
  const requests = Array.from({ length: 11 }, () => withEngineCapacity(engine, `test:chars:${engine}`, work, undefined, settings))
  await tick()
  expect(work).toHaveBeenCalledTimes(Math.min(11, slots))
  if (slots < 11) {
    finishes[0]('a')
    await requests[0]
    await tick()
    expect(work).toHaveBeenCalledTimes(11)
  }
  for (const finish of finishes) finish('done')
  await Promise.all(requests)
})
