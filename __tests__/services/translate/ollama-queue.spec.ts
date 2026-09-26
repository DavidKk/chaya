import { scheduleOllama } from '@/services/translate/ollama-queue'

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
