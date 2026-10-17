import { describe, expect, it } from '@jest/globals'

import { estimateRemainMs, formatRemainEta } from '@/lib/translate/remain-eta'

describe('estimateRemainMs', () => {
  it('does not estimate time with insufficient samples', () => {
    expect(estimateRemainMs({ missing: 100, sessionDone: 3, startedAt: Date.now() - 60_000 })).toBeNull()
    expect(estimateRemainMs({ missing: 100, sessionDone: 20, startedAt: Date.now() - 3_000 })).toBeNull()
    expect(estimateRemainMs({ missing: 100, sessionDone: 20, startedAt: null })).toBeNull()
    expect(estimateRemainMs({ missing: 0, sessionDone: 20, startedAt: Date.now() - 60_000 })).toBeNull()
  })

  it('estimates remaining time from throughput', () => {
    const now = 1_000_000
    // Twenty items in twenty seconds gives one item per second; forty remaining items take about forty seconds.
    const ms = estimateRemainMs({ missing: 40, sessionDone: 20, startedAt: now - 20_000, now })
    expect(ms).toBe(40_000)
  })
})

describe('formatRemainEta', () => {
  it('formats remaining time', () => {
    expect(formatRemainEta(30_000)).toBe('约 30 秒')
    expect(formatRemainEta(120_000)).toBe('约 2 分钟')
    expect(formatRemainEta(3_600_000)).toBe('约 1 小时')
  })
})
