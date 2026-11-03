jest.mock('@/lib/log/link-log-store', () => ({ appendBrowserLog: jest.fn() }))

import { appendBrowserLog } from '@/lib/log/link-log-store'
import type { TimingEntry } from '@/lib/log/timing'
import { createBrowserTimingReporter } from '@/services/log/browser'

const entry = (n: number): TimingEntry => ({ level: 'debug', source: 'communication', message: String(n), meta: {}, ts: n })

describe('browser diagnostic uploads', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('bounds the queue and batches uploads independently of requests', async () => {
    let finish!: () => void
    const upload = jest.fn(
      (_entries: TimingEntry[]) =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const report = createBrowserTimingReporter(upload)
    for (let i = 0; i < 600; i++) report(entry(i))
    expect(appendBrowserLog).toHaveBeenCalledTimes(600)
    await jest.advanceTimersByTimeAsync(150)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toHaveLength(100)
    expect(upload.mock.calls[0][0][0].message).toBe('100')
    await jest.advanceTimersByTimeAsync(1000)
    expect(upload).toHaveBeenCalledTimes(1)
    finish()
    await jest.advanceTimersByTimeAsync(150)
    expect(upload).toHaveBeenCalledTimes(2)
    finish()
    await jest.advanceTimersByTimeAsync(0)
  })

  it('drops a failed upload and continues with the next batch without retrying it', async () => {
    const upload = jest.fn(async (_entries: TimingEntry[]) => {}).mockRejectedValueOnce(new Error('offline'))
    const report = createBrowserTimingReporter(upload)
    report(entry(1))
    await jest.advanceTimersByTimeAsync(150)
    expect(upload).toHaveBeenCalledTimes(1)
    report(entry(2))
    await jest.advanceTimersByTimeAsync(150)
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[1][0].map((item) => item.message)).toEqual(['2'])
  })

  it('detaches oversized metadata before waiting for an upload', async () => {
    const upload = jest.fn(async (_entries: TimingEntry[]) => {})
    const report = createBrowserTimingReporter(upload)
    const meta = { operationId: 'browser-request', payload: 'x'.repeat(1000000) }
    report({ ...entry(1), meta })
    meta.operationId = 'mutated'
    await jest.advanceTimersByTimeAsync(150)
    const retained = upload.mock.calls[0][0][0]
    expect(retained.meta.operationId).toBe('browser-request')
    expect(Buffer.byteLength(JSON.stringify(retained))).toBeLessThanOrEqual(16 * 1024)
  })
})
