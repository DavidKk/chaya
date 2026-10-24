import { scheduleOllama } from '@/services/translate/ollama-queue'

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

it('prioritizes current dialogue over waiting seed work and removes cancelled requests', async () => {
  const order: string[] = []
  let release!: () => void
  const first = scheduleOllama(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const background = scheduleOllama(async () => {
    order.push('background')
  })
  const dialogue = scheduleOllama(async () => {
    order.push('dialogue')
  }, true)
  const abort = new AbortController()
  const cancelled = scheduleOllama(
    async () => {
      order.push('cancelled')
    },
    true,
    abort.signal
  )
  const rejection = expect(cancelled).rejects.toThrow()
  abort.abort()
  release()
  await Promise.all([first, dialogue, background, rejection])
  expect(order).toEqual(['dialogue', 'background'])
})

it('keeps the default lane serial for backwards compatibility', async () => {
  const order: string[] = []
  let releaseFirst!: () => void
  const first = scheduleOllama(
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve
        order.push('first')
      })
  )
  const second = scheduleOllama(async () => {
    order.push('second')
  })
  await tick()
  expect(order).toEqual(['first'])
  releaseFirst()
  await Promise.all([first, second])
  expect(order).toEqual(['first', 'second'])
})

it('runs concurrent work on one lane when concurrency is raised', async () => {
  const order: string[] = []
  const releases: Array<() => void> = []
  const make = () =>
    scheduleOllama(
      () =>
        new Promise<void>((resolve) => {
          order.push('start')
          releases.push(resolve)
        }),
      { concurrency: 2 }
    )
  const first = make()
  const second = make()
  await tick()
  expect(order).toEqual(['start', 'start'])
  releases.forEach((release) => release())
  await Promise.all([first, second])
})

it('isolates concurrency by lane so a busy lane does not block another', async () => {
  const order: string[] = []
  let releaseA!: () => void
  const a = scheduleOllama(
    () =>
      new Promise<void>((resolve) => {
        releaseA = resolve
        order.push('a')
      }),
    { lane: 'a' }
  )
  const b = scheduleOllama(
    async () => {
      order.push('b')
    },
    { lane: 'b' }
  )
  await tick()
  expect(order).toEqual(['a', 'b'])
  releaseA()
  await Promise.all([a, b])
})
