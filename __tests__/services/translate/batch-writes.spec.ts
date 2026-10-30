jest.mock('@/services/log/bus', () => ({ appendLog: jest.fn() }))

import type { openSharedCache } from '@/services/translate/shared-cache'
import { writeTranslationBatch } from '@/services/translate/shared-cache/batch-writes'

function writer() {
  const writeMany = jest.fn((pairs: Array<[string, string]>) => ({
    accepted: pairs,
    records: pairs.map(([src, zh], id) => ({ src, zh, id: String(id), revision: 1 })),
    rejected: [],
  }))
  const queueBackfill = jest.fn()
  return { writeMany, queueBackfill, store: { writeMany, queueBackfill } as unknown as ReturnType<typeof openSharedCache> }
}
const pair = { from: 'ja', to: 'zh' }

describe('translation result write batching', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('coalesces completed disjoint requests and returns each caller only its own results', async () => {
    const { store, writeMany, queueBackfill } = writer()
    const first = writeTranslationBatch(store, [['一', '甲']], 'live:apple', pair, '/game')
    const second = writeTranslationBatch(store, [['二', '乙']], 'live:apple', pair, '/game')
    expect(writeMany).not.toHaveBeenCalled()
    jest.advanceTimersByTime(20)
    expect(writeMany).toHaveBeenCalledTimes(1)
    expect(writeMany).toHaveBeenCalledWith(
      [
        ['一', '甲'],
        ['二', '乙'],
      ],
      'live:apple',
      pair
    )
    expect(queueBackfill).toHaveBeenCalledTimes(1)
    await expect(first).resolves.toMatchObject({ accepted: [['一', '甲']], records: [{ src: '一' }] })
    await expect(second).resolves.toMatchObject({ accepted: [['二', '乙']], records: [{ src: '二' }] })
  })

  it('flushes overlapping sources separately to preserve result ownership', async () => {
    const { store, writeMany } = writer()
    const first = writeTranslationBatch(store, [['一', '甲']], 'live:apple', pair)
    const second = writeTranslationBatch(store, [['一', '乙']], 'live:apple', pair)
    expect(writeMany).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(20)
    expect(writeMany).toHaveBeenCalledTimes(2)
    await expect(first).resolves.toMatchObject({ accepted: [['一', '甲']] })
    await expect(second).resolves.toMatchObject({ accepted: [['一', '乙']] })
  })

  it('keeps engine, language, category and game boundaries separate without waiting for slower engines', async () => {
    const { store, writeMany } = writer()
    const jobs = [
      writeTranslationBatch(store, [['一', '甲']], 'live:apple', pair, '/game'),
      writeTranslationBatch(store, [['二', '乙']], 'live:google', pair, '/game'),
      writeTranslationBatch(store, [['三', '丙']], 'live:apple', { ...pair, from: 'en' }, '/game'),
      writeTranslationBatch(store, [['四', '丁']], 'live:apple', { ...pair, category: 'name' }, '/game'),
      writeTranslationBatch(store, [['五', '戊']], 'live:apple', pair, '/other-game'),
    ]
    jest.advanceTimersByTime(20)
    await Promise.all(jobs)
    expect(writeMany).toHaveBeenCalledTimes(5)
  })

  it('rejects every caller on write failure and allows a later batch to recover', async () => {
    const { store, writeMany, queueBackfill } = writer()
    const error = new Error('write failed')
    writeMany.mockImplementationOnce(() => {
      throw error
    })
    const first = writeTranslationBatch(store, [['一', '甲']], 'live:apple', pair, '/game')
    const second = writeTranslationBatch(store, [['二', '乙']], 'live:apple', pair, '/game')
    const results = Promise.allSettled([first, second])
    jest.advanceTimersByTime(20)
    await expect(results).resolves.toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ])
    expect(queueBackfill).not.toHaveBeenCalled()
    const retry = writeTranslationBatch(store, [['一', '甲']], 'live:apple', pair)
    jest.advanceTimersByTime(20)
    await expect(retry).resolves.toMatchObject({ accepted: [['一', '甲']] })
  })
})
