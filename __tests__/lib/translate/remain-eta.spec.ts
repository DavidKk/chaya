import { describe, expect, it } from '@jest/globals'

import {
  estimateRemainMs,
  formatRemainEta,
  projectRemainingChars,
  rollingTranslationPerformance,
  smoothTranslationPerformance,
  translationPerformance,
} from '@/lib/translate/remain-eta'

describe('estimateRemainMs', () => {
  it('uses remaining characters rather than the total or historical wall time', () => {
    expect(estimateRemainMs({ missingChars: 1000, charsPerSecond: 20, running: true })).toBe(50000)
    expect(estimateRemainMs({ missingChars: 600, charsPerSecond: 20, running: true })).toBe(30000)
  })

  it('hides paused and unsampled estimates, including after a long pause', () => {
    expect(estimateRemainMs({ missingChars: 1000, charsPerSecond: 20, running: false })).toBeNull()
    expect(estimateRemainMs({ missingChars: 1000, charsPerSecond: null, running: true })).toBeNull()
    expect(estimateRemainMs({ missingChars: 0, charsPerSecond: 20, running: true })).toBeNull()
  })

  it('rejects zero, negative and non-finite inputs', () => {
    for (const rate of [0, -1, NaN, Infinity, undefined]) {
      expect(estimateRemainMs({ missingChars: 1000, charsPerSecond: rate, running: true })).toBeNull()
    }
    for (const missingChars of [-1, NaN, Infinity]) {
      expect(estimateRemainMs({ missingChars, charsPerSecond: 20, running: true })).toBeNull()
    }
  })
})

describe('formatRemainEta', () => {
  it('formats remaining time', () => {
    expect(formatRemainEta(30_000)).toBe('00:30')
    expect(formatRemainEta(120_000)).toBe('02:00')
    expect(formatRemainEta(3_600_000)).toBe('01:00:00')
  })
})

describe('recent translation performance', () => {
  it('weights by actual active duration, including unsuccessful batches', () => {
    expect(translationPerformance([])).toBeNull()
    expect(translationPerformance([{ elapsedMs: 0, completedChars: 30, cacheMs: 1 }])).toBeNull()
    expect(
      translationPerformance([
        { elapsedMs: 1000, completedChars: 100, cacheMs: 2 },
        { elapsedMs: 3000, completedChars: 0, cacheMs: 4 },
      ])
    ).toEqual({ charsPerSecond: 25, cacheMs: 4 })
  })

  it('uses only the last eight batches, independent of wall time or pauses', () => {
    expect(
      translationPerformance([{ elapsedMs: 90000, completedChars: 0, cacheMs: 1000 }, ...Array.from({ length: 8 }, () => ({ elapsedMs: 1000, completedChars: 20, cacheMs: 3 }))])
    ).toEqual({ charsPerSecond: 20, cacheMs: 3 })
  })

  it('rejects invalid samples rather than hiding their time from the rate', () => {
    for (const sample of [
      { elapsedMs: -1, completedChars: 20, cacheMs: 1 },
      { elapsedMs: 1000, completedChars: NaN, cacheMs: 1 },
      { elapsedMs: Infinity, completedChars: 20, cacheMs: 1 },
    ]) {
      expect(translationPerformance([{ elapsedMs: 1000, completedChars: 20, cacheMs: 1 }, sample])).toBeNull()
    }
  })

  it('formats clock boundaries and durations longer than a day', () => {
    expect(formatRemainEta(59999)).toBe('01:00')
    expect(formatRemainEta(3599999)).toBe('01:00:00')
    expect(formatRemainEta(25 * 3600000 + 33000)).toBe('25:00:33')
    expect(formatRemainEta(0)).toBe('00:00')
  })
})

describe('rolling translation performance', () => {
  it('uses only samples inside the recent wall-clock window', () => {
    expect(
      rollingTranslationPerformance(
        [
          { at: 1_000, chars: 100 },
          { at: 2_000, chars: 20 },
          { at: 3_000, chars: 30 },
          { at: 4_000, chars: 40 },
        ],
        { now: 4_000, windowMs: 2_000 }
      )
    ).toEqual({ charsPerSecond: 45, cacheMs: 0 })
  })

  it('needs enough samples and elapsed time before reporting a rate', () => {
    expect(rollingTranslationPerformance([{ at: 1000, chars: 100 }], { now: 2000 })).toBeNull()
    expect(
      rollingTranslationPerformance(
        [
          { at: 1000, chars: 100 },
          { at: 1100, chars: 100 },
        ],
        { now: 1200, minElapsedMs: 400 }
      )
    ).toBeNull()
  })

  it('ignores future and invalid character samples without letting them hide elapsed time', () => {
    expect(
      rollingTranslationPerformance(
        [
          { at: 1000, chars: 20 },
          { at: 1500, chars: Number.NaN },
          { at: 2000, chars: 30 },
          { at: 3000, chars: 50 },
        ],
        { now: 2000, cacheMs: 7 }
      )
    ).toEqual({ charsPerSecond: 50, cacheMs: 7 })
  })
})

describe('display ETA helpers', () => {
  it('smooths short-window spikes but adopts the first sample immediately', () => {
    expect(smoothTranslationPerformance(null, { charsPerSecond: 100, cacheMs: 3 })).toEqual({ charsPerSecond: 100, cacheMs: 3 })
    expect(smoothTranslationPerformance({ charsPerSecond: 100, cacheMs: 3 }, { charsPerSecond: 200, cacheMs: 4 })).toEqual({
      charsPerSecond: 120,
      cacheMs: 4,
    })
    expect(smoothTranslationPerformance({ charsPerSecond: 100, cacheMs: 3 }, null)).toEqual({ charsPerSecond: 100, cacheMs: 3 })
  })

  it('projects only a bounded amount between worker checkpoints', () => {
    expect(projectRemainingChars({ missingChars: 1000, charsPerSecond: 100, elapsedMs: 1000 })).toBe(900)
    expect(projectRemainingChars({ missingChars: 1000, charsPerSecond: 100, elapsedMs: 60_000, maxElapsedMs: 2000 })).toBe(800)
    expect(projectRemainingChars({ missingChars: 1000, charsPerSecond: 0, elapsedMs: 1000 })).toBe(1000)
    expect(projectRemainingChars({ missingChars: 1000, charsPerSecond: 100, elapsedMs: -1 })).toBe(1000)
  })
})
