jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import type { TranslateRunEngine } from '@/lib/translate/engines'
import { planSentenceTranslation } from '@/lib/translate/sentence-plan'
import type { LiveTranslateItem } from '@/services/translate/live-translate'
import type { startCacheLane } from '@/services/translate/scheduler/cache-lane'
import { createScheduledSeedSession } from '@/services/translate/scheduler/seed-session'

let mockEngines: TranslateRunEngine[] = ['google']
let mockLane: Parameters<typeof startCacheLane>[0]
const mockClose = jest.fn(async () => {})
const mockWake = jest.fn()
const mockTranslate = jest.fn()
const mockStoreClose = jest.fn()
const mockFlush = jest.fn()
jest.mock('@/services/translate/engine-switches', () => ({ getTranslateEngineSwitches: () => ({ enabled: mockEngines }) }))
jest.mock('@/services/translate/live-translate', () => ({ liveTranslateTexts: (...args: unknown[]) => mockTranslate(...args) }))
jest.mock('@/services/translate/scheduler/cache-lane', () => ({
  startCacheLane: (options: Parameters<typeof startCacheLane>[0]) => {
    mockLane = options
    return { close: mockClose, wake: mockWake }
  },
}))
jest.mock('@/services/translate/game-records', () => ({ ...jest.requireActual('@/services/translate/game-records'), gameTranslationFiles: () => ({ stamp: 'game-v1' }) }))
jest.mock('@/services/translate/shared-cache', () => ({ openSharedCache: () => ({ version: () => 'v1', current: () => true, close: mockStoreClose, flushBackfill: mockFlush }) }))
jest.mock('@/services/translate/sensitive-text', () => ({ isSensitiveForCloud: () => false }))

const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('independent seed cache and engine scheduling', () => {
  let root: string, dir: string
  let session: ReturnType<typeof createScheduledSeedSession>
  let pending: Map<string, { resolve: (item: LiveTranslateItem) => void; reject: (error: Error) => void }>
  function create(count: number) {
    const file = gameContentPath(root, 'seed')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, id) => [`Text${id}`, '']))))
    session = createScheduledSeedSession(root)
    return session
  }
  async function stop() {
    session.pause()
    for (const [src, work] of pending) work.resolve({ src, zh: '译文' })
    await tick()
    await session.close()
  }
  beforeEach(() => {
    jest.useFakeTimers()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-scheduler-'))
    root = path.join(dir, 'game')
    mockEngines = ['google']
    mockTranslate.mockReset()
    mockClose.mockClear()
    mockWake.mockClear()
    mockStoreClose.mockClear()
    mockFlush.mockClear()
    pending = new Map()
    mockTranslate.mockImplementation(
      (texts: string[]) =>
        new Promise((resolve, reject) => {
          pending.set(texts[0], { resolve: (item) => resolve({ items: [item], engines: mockEngines, contentRoot: root }), reject })
        })
    )
  })
  afterEach(() => {
    jest.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('dispatches before cache initialization, and scans the whole job rather than two batches', async () => {
    const running = create(130).fill({ limit: 4 })
    await tick()
    expect(mockTranslate).toHaveBeenCalledTimes(4)
    expect(mockTranslate.mock.calls[0][1]).toMatchObject({ cacheMode: 'bypass', engines: ['google'] })
    const scanned = []
    for (;;) {
      const chunk = mockLane.next()!
      if (!chunk.length) break
      expect(chunk.length).toBeLessThanOrEqual(32)
      scanned.push(...chunk)
    }
    expect(scanned).toHaveLength(130)
    mockLane.onError('Cache initialization timed out')
    await stop()
    expect((await running).translated).toBe(4)
  })

  it('refills free slots and returns progress while the first request is still slow', async () => {
    const running = create(6).fill({ limit: 2 })
    await tick()
    pending.get('Text1')!.resolve({ src: 'Text1', zh: '第二条' })
    await tick()
    expect(mockTranslate.mock.calls.map(([texts]) => texts[0])).toEqual(['Text0', 'Text1', 'Text2'])
    await jest.advanceTimersByTimeAsync(250)
    const result = await running
    expect(result.items.map((item) => item.src)).toEqual(['Text1'])
    expect(result.missing).toBe(5)
    await stop()
  })

  it('accepts cache first, bypasses pending work and ignores the late engine result', async () => {
    const running = create(3).fill({ limit: 1 })
    await tick()
    const full = (id: number) =>
      mockLane.onResult({
        id,
        src: `Text${id}`,
        stamp: 'game-v1',
        elapsedMs: 2,
        plan: { ...planSentenceTranslation(`Text${id}`, [{ id: `cache:${id}`, revision: 1, src: `Text${id}`, zh: '缓存译文', engine: 'manual' }]), corpusVersion: 'v1' },
      })
    full(0)
    await tick()
    expect((await running).items[0]).toMatchObject({ zh: '缓存译文', engine: 'cache:scan' })
    expect(mockTranslate.mock.calls[0][1].local.signal.aborted).toBe(true)
    full(1)
    full(2)
    pending.get('Text0')!.resolve({ src: 'Text0', zh: '迟到结果' })
    await tick()
    expect(session.progress).toMatchObject({ done: 3, missing: 0 })
    expect(session.processed).toBe(3)
    expect(mockTranslate).toHaveBeenCalledTimes(1)
    await session.close()
  })

  it('accepts engine success without waiting for the cache and ignores a late cache reply', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: '引擎译文' })
    expect((await running).translated).toBe(1)
    mockLane.onResult({
      id: 0,
      src: 'Text0',
      stamp: 'game-v1',
      elapsedMs: 2,
      plan: { ...planSentenceTranslation('Text0', [{ id: 'cache:0', revision: 1, src: 'Text0', zh: '缓存译文' }]), corpusVersion: 'v1' },
    })
    expect(session.processed).toBe(1)
    expect(session.progress.done).toBe(1)
    await session.close()
  })

  it('routes failures to another engine after fresh work and never retries the failed engine', async () => {
    mockEngines = ['agent:a', 'google']
    const running = create(5).fill({ limit: 2 })
    await tick()
    expect(mockTranslate.mock.calls.slice(0, 2).map(([, opts]) => opts.engines[0])).toEqual(['agent:a', 'google'])
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Agent failed' })
    await tick()
    expect(mockTranslate.mock.calls[2][0]).toEqual(['Text2'])
    for (let i = 0; i < 8 && !mockTranslate.mock.calls.some(([texts, opts]) => texts[0] === 'Text0' && opts.engines[0] === 'google'); i++) {
      for (const [src, work] of pending) if (src !== 'Text0') work.resolve({ src, zh: '译文' })
      await tick()
    }
    const googleRetry = mockTranslate.mock.calls.findIndex(([texts, opts]) => texts[0] === 'Text0' && opts.engines[0] === 'google')
    expect(googleRetry).toBeGreaterThan(mockTranslate.mock.calls.findIndex(([texts]) => texts[0] === 'Text4'))
    session.pause()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: '平台兜底' })
    await tick()
    await running
    await session.close()
    expect(session.processed).toBe(5)
    expect(mockTranslate.mock.calls.filter(([texts, opts]) => texts[0] === 'Text0' && opts.engines[0] === 'agent:a')).toHaveLength(1)
  })

  it('keeps a pending cache lookup alive after all engines fail', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Service unavailable' })
    await tick()
    mockLane.onResult({
      id: 0,
      src: 'Text0',
      stamp: 'game-v1',
      elapsedMs: 2,
      plan: { ...planSentenceTranslation('Text0', [{ id: 'cache:0', revision: 1, src: 'Text0', zh: '缓存兜底' }]), corpusVersion: 'v1' },
    })
    expect((await running).items[0]).toMatchObject({ zh: '缓存兜底', engine: 'cache:scan' })
    await session.close()
  })

  it('finishes with a failure when both the engine and cache lane fail', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Service unavailable' })
    await tick()
    mockLane.onError('Cache worker timed out')
    expect((await running).failed).toBe(1)
    await session.close()
  })

  it('uses newly enabled engines on the next window and never returns to a failed engine', async () => {
    mockEngines = ['agent:a']
    const first = create(2).fill({ limit: 1 })
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Agent failed' })
    await tick()
    pending.get('Text1')!.resolve({ src: 'Text1', zh: '成功' })
    await first
    mockEngines = ['google']
    const second = session.fill({ limit: 1 })
    await tick()
    expect(mockTranslate.mock.calls.at(-1)?.[1].engines).toEqual(['google'])
    mockEngines = ['agent:a', 'google']
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Platform failed' })
    await tick()
    mockLane.onError('Cache unavailable')
    expect((await second).failed).toBe(1)
    expect(mockTranslate.mock.calls.filter(([texts, opts]) => texts[0] === 'Text0' && opts.engines[0] === 'agent:a')).toHaveLength(1)
    await session.close()
  })

  it('bounds failed backlog even when the cache has already marked the whole job missing', async () => {
    mockEngines = ['agent:a', 'google']
    const original = mockTranslate.getMockImplementation()!
    mockTranslate.mockImplementation((texts: string[], opts: { engines: string[] }) =>
      opts.engines[0] === 'agent:a' ? Promise.resolve({ items: [{ src: texts[0], zh: null, error: 'Agent unavailable' }] }) : original(texts, opts)
    )
    const running = create(200).fill({ limit: 8 })
    for (let id = 0; id < 200; id++)
      mockLane.onResult({
        id,
        src: `Text${id}`,
        stamp: 'game-v1',
        elapsedMs: 1,
        plan: { ...planSentenceTranslation(`Text${id}`, []), corpusVersion: 'v1' },
      })
    await tick()
    for (let i = 0; i < 6; i++) await jest.advanceTimersByTimeAsync(1)
    expect(mockTranslate.mock.calls.length).toBeLessThanOrEqual(64)
    expect(mockTranslate.mock.calls.length).toBeGreaterThan(32)
    await stop()
    await running
  })

  it('honors the active character budget and sends an oversized source alone', async () => {
    const running = create(4).fill({ limit: 4, maxChars: 3 })
    await tick()
    expect(mockTranslate).toHaveBeenCalledTimes(1)
    await stop()
    expect((await running).translated).toBe(1)
  })

  it('does not dispatch more work after pause and closes the worker', async () => {
    const running = create(10).fill({ limit: 2 })
    await tick()
    session.pause()
    for (const [src, work] of pending) work.resolve({ src, zh: '译文' })
    await tick()
    await running
    await session.close()
    expect(mockTranslate).toHaveBeenCalledTimes(2)
    expect(mockClose).toHaveBeenCalled()
    expect(session.progress.done).toBe(2)
  })
})
