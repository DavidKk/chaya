import { joinTranslationRequest } from '@/services/translate/scheduler/in-flight'

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

it('shares one transport and lets one subscriber cancel without cancelling the other', async () => {
  let finish: (value: string) => void = () => {}
  let transportSignal: AbortSignal | undefined
  const work = jest.fn((signal: AbortSignal) => {
    transportSignal = signal
    return new Promise<string>((resolve) => {
      finish = resolve
    })
  })
  const first = new AbortController()
  const a = joinTranslationRequest('shared:one', work, first.signal).catch((error: Error) => error.message)
  const joined = jest.fn()
  const b = joinTranslationRequest('shared:one', work, undefined, joined)
  await tick()
  expect(work).toHaveBeenCalledTimes(1)
  expect(joined).toHaveBeenCalledTimes(1)
  first.abort(new Error('First subscriber cancelled'))
  expect(await a).toBe('First subscriber cancelled')
  expect(transportSignal?.aborted).toBe(false)
  finish('译文')
  expect(await b).toBe('译文')
})

it('cancels the adapter after all subscribers leave and a later request starts fresh', async () => {
  let finishOld: (value: string) => void = () => {}
  let oldSignal: AbortSignal | undefined
  const controller = new AbortController()
  const old = joinTranslationRequest(
    'shared:cancelled',
    (signal) => {
      oldSignal = signal
      return new Promise<string>((resolve) => {
        finishOld = resolve
      })
    },
    controller.signal
  ).catch(() => null)
  await tick()
  controller.abort()
  await old
  expect(oldSignal?.aborted).toBe(true)
  const fresh = jest.fn(async () => '新请求')
  expect(await joinTranslationRequest('shared:cancelled', fresh)).toBe('新请求')
  finishOld('迟到结果')
  await tick()
  expect(fresh).toHaveBeenCalledTimes(1)
})
