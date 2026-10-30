import { planSentenceTranslation } from '@/lib/translate/sentence-plan'
import type { LiveTranslateItem } from '@/services/translate/live-translate'
import type { startCacheLane } from '@/services/translate/scheduler/cache-lane'
import { createScheduledSeedSession } from '@/services/translate/scheduler/seed-session'

let mockLane: Parameters<typeof startCacheLane>[0]
const mockTranslate = jest.fn()
jest.mock('@/services/translate/engine-switches', () => ({ getTranslateEngineSwitches: () => ({ enabled: ['google'] }) }))
jest.mock('@/services/translate/sensitive-text', () => ({ isSensitiveForCloud: () => false }))
jest.mock('@/services/translate/seed-failures', () => ({ recordSeedFailure: jest.fn() }))
jest.mock('@/services/translate/scheduler/seed-inventory', () => ({ seedFileStamp: () => 'seed' }))
jest.mock('@/services/translate/game-records', () => ({ gameTranslationFiles: () => ({ stamp: 'local' }) }))
jest.mock('@/services/translate/game-cache-context', () => ({ getGameCacheContext: () => ({ authorityVersion: 'authority' }) }))
jest.mock('@/services/translate/shared-cache', () => ({
  openSharedCache: () => ({ version: () => 'shared', current: () => true, flushBackfill: () => ({}), close: () => {}, queueGameProjections: jest.fn() }),
}))
jest.mock('@/services/translate/live-translate', () => ({ liveTranslateTexts: (...args: unknown[]) => mockTranslate(...args) }))
jest.mock('@/services/translate/scheduler/cache-lane', () => ({
  startCacheLane: (options: Parameters<typeof startCacheLane>[0]) => {
    mockLane = options
    return { wake: () => {}, setLease: () => {}, close: async () => {} }
  },
}))

const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('independent cache admission after engine fallback', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockTranslate.mockReset()
    mockTranslate.mockImplementation(
      ([src]: string[], options: { local: { signal: AbortSignal }; onEngineDispatch: (engine: string) => void }) =>
        new Promise((resolve) => {
          options.onEngineDispatch('google')
          options.local.signal.addEventListener('abort', () => resolve({ items: [{ src, zh: null, error: 'aborted', engineWork: true } satisfies LiveTranslateItem] }))
        })
    )
  })
  afterEach(() => jest.useRealTimers())

  function create(count = 96) {
    const pending = Array.from({ length: count }, (_, id) => `Text${id}`)
    return createScheduledSeedSession('/test/cache-admission', undefined, {
      inventory: {
        pending,
        stamp: 'seed',
        progressStamp: 'local',
        progress: {
          contentRoot: '/test/cache-admission',
          hasSeed: true,
          total: 96,
          done: 0,
          missing: 96,
          needCount: 96,
          skipCount: 0,
          needChars: 566,
          skipChars: 0,
          missingChars: 566,
          doneChars: 0,
          lines: 96,
          batchSize: 40,
          batchesLeft: 3,
        },
      },
    })
  }
  function emit(id: number, src: string) {
    mockLane.onResult(
      {
        id,
        src,
        stamp: 'local',
        authorityVersion: 'authority',
        elapsedMs: 1,
        plan: { ...planSentenceTranslation(src, [{ id: String(id), revision: 1, src, zh: `译文${id}`, engine: 'manual' }]), corpusVersion: 'shared' },
      },
      1,
      'lease'
    )
  }

  it('still scans queued and running items after admission and classification deadlines', async () => {
    jest.advanceTimersByTime(1)
    const session = create()
    try {
      const running = session.fill({ limit: 4 })
      await tick()
      const first = mockLane.next('lease')!
      expect(first).toHaveLength(32)
      await jest.advanceTimersByTimeAsync(1501)
      expect(mockTranslate).toHaveBeenCalledTimes(4)
      for (const task of first) emit(task.id, task.src)
      const second = mockLane.next('lease')!
      expect(second.map((task) => task.id)).toEqual(Array.from({ length: 32 }, (_, id) => id + 32))
      for (const task of second) emit(task.id, task.src)
      await tick()
      const result = await running
      expect(result).toMatchObject({ scanned: 40, cacheOnly: true, translated: 40 })
      expect(result.items.every((item) => !item.engineWork)).toBe(true)
    } finally {
      session.pause()
      await session.close()
    }
  })

  it('finishes an engine failure when the cache scan itself fails', async () => {
    mockTranslate.mockImplementation(async ([src]: string[], options: { onEngineDispatch: (engine: string) => void }) => {
      options.onEngineDispatch('google')
      return { items: [{ src, zh: null, error: 'Engine unavailable', engineWork: true }] }
    })
    const session = create(1)
    try {
      let result: Awaited<ReturnType<typeof session.fill>> | undefined
      const running = session.fill({ limit: 4 }).then((value) => {
        result = value
      })
      await tick()
      expect(mockLane.next('lease')).toHaveLength(1)
      await jest.advanceTimersByTimeAsync(1501)
      expect(mockTranslate).toHaveBeenCalledTimes(1)
      expect(result).toBeUndefined()
      mockLane.onItemError(0, 'Text0', 'Scan failed', 1, 'lease')
      await tick()
      expect(result).toMatchObject({ scanned: 1, failed: 1 })
      await running
    } finally {
      session.pause()
      await session.close()
    }
  })
})
