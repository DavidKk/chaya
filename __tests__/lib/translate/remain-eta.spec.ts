import { describe, expect, it } from '@jest/globals'

import { estimateRemainMs, formatRemainEta } from '@/lib/translate/remain-eta'

describe('estimateRemainMs', () => {
  it('样本不足不估时（避免假 ETA）', () => {
    expect(estimateRemainMs({ missing: 100, sessionDone: 3, startedAt: Date.now() - 60_000 })).toBeNull()
    expect(estimateRemainMs({ missing: 100, sessionDone: 20, startedAt: Date.now() - 3_000 })).toBeNull()
    expect(estimateRemainMs({ missing: 100, sessionDone: 20, startedAt: null })).toBeNull()
    expect(estimateRemainMs({ missing: 0, sessionDone: 20, startedAt: Date.now() - 60_000 })).toBeNull()
  })

  it('按吞吐估算', () => {
    const now = 1_000_000
    // 20s 内完成 20 条 → 1 条/秒；还剩 40 → 约 40s
    const ms = estimateRemainMs({ missing: 40, sessionDone: 20, startedAt: now - 20_000, now })
    expect(ms).toBe(40_000)
  })
})

describe('formatRemainEta', () => {
  it('格式化', () => {
    expect(formatRemainEta(30_000)).toBe('约 30 秒')
    expect(formatRemainEta(120_000)).toBe('约 2 分钟')
    expect(formatRemainEta(3_600_000)).toBe('约 1 小时')
  })
})
