import { collectResultWindow, type Completed } from '@/services/translate/scheduler/result-window'

it.each([
  { exhausted: false, terminal: false, waitMs: 5000, reason: 'timeout' },
  { exhausted: true, terminal: false, waitMs: 250, reason: 'cache-drained' },
  { exhausted: true, terminal: true, waitMs: 0, reason: 'finished' },
])('labels a 10-item/206-character cache window as $reason', async ({ exhausted, terminal, waitMs, reason }) => {
  jest.useFakeTimers()
  const completed: Completed[] = Array.from({ length: 10 }, (_, id) => ({
    item: { src: 'あ'.repeat(id === 9 ? 26 : 20), zh: '缓存命中', engine: 'cache:scan' },
    cacheMs: 1,
  }))
  let wake: (() => void) | undefined
  let resolved = false
  const result = collectResultWindow(completed, {
    limit: 4,
    wake: () => {},
    pump: () => {},
    cacheWorkExhausted: () => exhausted,
    terminal: () => terminal,
    flush: () => false,
    notify: () => wake?.(),
    wait: () =>
      new Promise<void>((resolve) => {
        wake = resolve
      }),
  }).then((window) => {
    resolved = true
    return window
  })
  try {
    if (waitMs > 0) {
      await jest.advanceTimersByTimeAsync(waitMs - 1)
      expect(resolved).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
    }
    const window = await result
    expect(window.selected).toHaveLength(10)
    expect(window.chars()).toBe(206)
    expect(window.reason).toBe(reason)
  } finally {
    jest.useRealTimers()
  }
})
