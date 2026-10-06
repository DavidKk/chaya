import { createRenderTranslation } from '@/plugins/src/translator/engine/render-translation'

describe('render-time translation', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('batches repeated draws and makes the result available on the next draw', async () => {
    const cache = new Map<string, string>()
    const request = jest.fn(async (texts: string[]) => texts.map((src) => ({ src, zh: '敌人攻击' })))
    const refresh = jest.fn()
    const changed = jest.fn()
    const worker = createRenderTranslation({
      cached: (text) => cache.get(text) || text,
      enabled: () => true,
      request,
      apply: (src, zh) => cache.set(src, zh),
      refresh,
    })
    worker.subscribe(changed)
    for (let i = 0; i < 30; i++) worker.observe('敵の攻撃')
    worker.observe('HP 20')
    await jest.advanceTimersByTimeAsync(200)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toEqual(['敵の攻撃'])
    expect(cache.get('敵の攻撃')).toBe('敌人攻击')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
    worker.observe('敵の攻撃')
    await jest.advanceTimersByTimeAsync(200)
    expect(request).toHaveBeenCalledTimes(1)
    worker.dispose()
  })

  it('aborts an in-flight request when unloaded', async () => {
    let aborted = false
    const worker = createRenderTranslation({
      cached: (text) => text,
      enabled: () => true,
      request: (_texts, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new Error('aborted'))
            },
            { once: true }
          )
        ),
      apply: jest.fn(),
      refresh: jest.fn(),
    })
    worker.observe('敵の攻撃')
    await jest.advanceTimersByTimeAsync(200)
    worker.dispose()
    expect(aborted).toBe(true)
  })
})
