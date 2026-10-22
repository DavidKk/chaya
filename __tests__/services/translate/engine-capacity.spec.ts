import { withEngineCapacity } from '@/services/translate/scheduler/engine-capacity'

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

it('retains capacity for non-cancellable transport work and removes aborted waiters', async () => {
  const finishes: Array<(value: string) => void> = []
  const work = jest.fn(() => new Promise<string>((resolve) => finishes.push(resolve)))
  const requests = Array.from({ length: 4 }, () => withEngineCapacity('google', 'test:noncancellable', work))
  await tick()
  expect(work).toHaveBeenCalledTimes(4)
  const controller = new AbortController()
  const cancelled = withEngineCapacity('google', 'test:noncancellable', work, controller.signal).catch((error: Error) => error.message)
  const queued = withEngineCapacity('google', 'test:noncancellable', work)
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
