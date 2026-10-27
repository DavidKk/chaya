jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('@/constants/paths', () => ({ ...jest.requireActual('@/constants/paths'), TRANSLATE_CACHE_DB_PATH: '' }))
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import type { TranslateRunEngine } from '@/lib/translate/engines'
import { planSentenceTranslation } from '@/lib/translate/sentence-plan'
import type { LiveTranslateItem } from '@/services/translate/live-translate'
import type { startCacheLane } from '@/services/translate/scheduler/cache-lane'
import type { CacheScanResult } from '@/services/translate/scheduler/cache-scan'
import { readSeedInventory } from '@/services/translate/scheduler/seed-inventory'
import { createScheduledSeedSession } from '@/services/translate/scheduler/seed-session'
import { readSeedFailures, seedFailureFile } from '@/services/translate/seed-failures'

let mockEngines: TranslateRunEngine[] = ['google']
let mockLane: Parameters<typeof startCacheLane>[0]
const mockClose = jest.fn(async () => {})
const mockWake = jest.fn()
const mockSetLease = jest.fn()
const mockStampAdvance = jest.fn()
const mockTranslate = jest.fn()
const mockStoreClose = jest.fn()
const mockFlush = jest.fn(() => ({ sharedOnly: false }))
let mockGameStamp = 'game-v1'
let mockAuthorityVersion = 'authority-v1'
jest.mock('@/services/translate/engine-switches', () => ({ getTranslateEngineSwitches: () => ({ enabled: mockEngines }) }))
jest.mock('@/services/translate/live-translate', () => ({ liveTranslateTexts: (...args: unknown[]) => mockTranslate(...args) }))
jest.mock('@/services/translate/scheduler/cache-lane', () => ({
  startCacheLane: (options: Parameters<typeof startCacheLane>[0]) => {
    mockLane = options
    return { close: mockClose, wake: mockWake, setLease: mockSetLease, stampAdvance: mockStampAdvance }
  },
}))
jest.mock('@/services/translate/game-records', () => ({ ...jest.requireActual('@/services/translate/game-records'), gameTranslationFiles: () => ({ stamp: mockGameStamp }) }))
jest.mock('@/services/translate/game-cache-context', () => ({ getGameCacheContext: () => ({ authorityVersion: mockAuthorityVersion }) }))
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
  function full(id: number, zh = '缓存译文', stamp = mockGameStamp, authority = mockAuthorityVersion): CacheScanResult {
    return {
      id,
      src: `Text${id}`,
      stamp,
      authorityVersion: authority,
      elapsedMs: 2,
      plan: { ...planSentenceTranslation(`Text${id}`, [{ id: `cache:${id}`, revision: 1, src: `Text${id}`, zh, engine: 'manual' }]), corpusVersion: 'v1' },
    }
  }
  function miss(id: number): CacheScanResult {
    return {
      id,
      src: `Text${id}`,
      stamp: mockGameStamp,
      authorityVersion: mockAuthorityVersion,
      elapsedMs: 1,
      plan: { ...planSentenceTranslation(`Text${id}`, []), corpusVersion: 'v1' },
    }
  }
  const emit = (result: CacheScanResult) => mockLane.onResult(result, 1, 'lease-1')
  beforeEach(() => {
    jest.useFakeTimers()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-scheduler-'))
    root = path.join(dir, 'game')
    mockEngines = ['google']
    mockTranslate.mockReset()
    mockClose.mockClear()
    mockWake.mockClear()
    mockSetLease.mockClear()
    mockStampAdvance.mockClear()
    mockStoreClose.mockClear()
    mockFlush.mockClear()
    mockGameStamp = 'game-v1'
    mockAuthorityVersion = 'authority-v1'
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
    fs.rmSync(seedFailureFile(root), { force: true })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('persists exhausted attempts as processed failures and excludes them after session recreation', async () => {
    mockEngines = ['agent:a', 'google']
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    emit(miss(0))
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Agent failed', engineWork: true })
    await tick()
    expect(readSeedFailures(root).has('Text0')).toBe(false)
    expect(mockTranslate.mock.calls.map(([, opts]) => opts.engines)).toEqual([['agent:a'], ['google']])
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Google failed', engineWork: true })
    const result = await running
    expect(result).toMatchObject({ done: 0, failedCount: 1, failedChars: 5, missing: 0, missingChars: 0, failed: 1, translated: 0 })
    expect(readSeedFailures(root).get('Text0')).toContain('Google failed')
    await session.close()
    session = createScheduledSeedSession(root)
    expect(session.progress).toMatchObject({ done: 0, failedCount: 1, missing: 0 })
    expect((await session.fill()).scanned).toBe(0)
    expect(mockTranslate).toHaveBeenCalledTimes(2)
    await session.close()
    fs.writeFileSync(gameContentPath(root, 'seed'), JSON.stringify({ Text0: '', Text1: '' }))
    const inventory = readSeedInventory(root)
    expect(inventory.pending).toEqual(['Text1'])
    expect(inventory.progress.done + inventory.progress.failedCount! + inventory.progress.missing).toBe(inventory.progress.needCount)
  })

  it.each([true, false])('keeps paused or unsubmitted failures pending (engine dispatched: %s)', async (engineWork) => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    emit(miss(0))
    await tick()
    if (engineWork) session.pause()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Interrupted or not dispatched', engineWork })
    await running
    await session.close()
    expect(readSeedFailures(root).has('Text0')).toBe(false)
    expect(readSeedInventory(root).pending).toEqual(['Text0'])
  })

  it('does not make an engine disabled during its request a terminal failure', async () => {
    const first = create(2).fill({ limit: 1 })
    await tick()
    for (const task of mockLane.next('lease-1')!) emit(miss(task.id))
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: '成功' })
    await first
    mockEngines = []
    const second = session.fill({ limit: 1 })
    await tick()
    const options = mockTranslate.mock.calls.find(([texts]) => texts[0] === 'Text1')![1]
    expect(options.local.signal.aborted).toBe(true)
    pending.get('Text1')!.resolve({ src: 'Text1', zh: null, error: 'Engine disabled', engineWork: true })
    await second
    await session.close()
    expect(readSeedFailures(root).has('Text1')).toBe(false)
  })

  it('does not dispatch engines for unclassified work, and only dispatches after a cache miss', async () => {
    const running = create(6).fill({ limit: 4 })
    await tick()
    expect(mockTranslate).not.toHaveBeenCalled()
    // Simulate the cache lane handing back a miss shard.
    const tasks = mockLane.next('lease-1')
    expect(tasks).toHaveLength(6)
    for (const t of tasks!) emit(miss(t.id))
    await tick()
    expect(mockTranslate).toHaveBeenCalledTimes(4)
    expect(mockTranslate.mock.calls[0][1]).toMatchObject({ cacheMode: 'bypass', engines: ['google'] })
    await stop()
    expect((await running).translated).toBe(4)
  })

  it('scans the whole job in 32-item shards without engine dispatch', async () => {
    create(130)
    const running = session.fill({ limit: 4 })
    await tick()
    const scanned: number[] = []
    for (let guard = 0; guard < 200; guard++) {
      const chunk = mockLane.next('lease-1')
      if (!chunk || !chunk.length) break
      expect(chunk.length).toBeLessThanOrEqual(32)
      for (const t of chunk) {
        scanned.push(t.id)
        emit(miss(t.id))
      }
    }
    expect(scanned).toHaveLength(130)
    await tick()
    expect(mockTranslate).toHaveBeenCalled()
    session.pause()
    for (const [src, work] of pending) work.resolve({ src, zh: '译文' })
    await tick()
    await running
    await session.close()
  })

  it('refills free slots and returns progress while the first request is still slow', async () => {
    const running = create(6).fill({ limit: 2 })
    await tick()
    for (const t of mockLane.next('lease-1')!) emit(miss(t.id))
    mockLane.onBatchDone(1, 'lease-1', 1)
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

  it.each([
    { engine: 'cache:partial', resultSources: ['cache', 'live:apple'], completedChars: 5 },
    { engine: 'cache:changed', resultSources: ['cache:changed'], completedChars: 0 },
  ])('flushes $engine after engine work while other slots and cache scans are pending', async ({ engine, resultSources, completedChars }) => {
    const running = create(6).fill({ limit: 4 })
    await tick()
    mockLane.next('lease-1')
    emit(miss(0))
    emit(miss(1))
    await tick()
    mockTranslate.mock.calls[0][1].onEngineDispatch('apple')
    pending.get('Text0')!.resolve({ src: 'Text0', zh: '译文', engine, resultSources, engineWork: true })
    await tick()
    await jest.advanceTimersByTimeAsync(250)
    expect(await running).toMatchObject({
      scanned: 1,
      submittedEngines: ['apple'],
      performance: { completedChars },
    })
    await stop()
  })

  it('accepts cache first, bypasses pending work and ignores the late engine result', async () => {
    const running = create(3).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    emit(full(0))
    emit(full(1))
    emit(full(2))
    mockLane.onBatchDone(1, 'lease-1', 1)
    await tick()
    const result = await running
    expect(result.items[0]).toMatchObject({ zh: '缓存译文', engine: 'cache:scan' })
    expect(mockTranslate).not.toHaveBeenCalled()
    expect(session.progress).toMatchObject({ done: 3, missing: 0 })
    expect(session.processed).toBe(3)
    await session.close()
  })

  it('does not taint cache:scan with engineWork when cache resolves while engine is in flight', async () => {
    create(3)
    const running = session.fill({ limit: 4 })
    await tick()
    mockLane.next('lease-1')
    emit(miss(0))
    await tick()
    expect(mockTranslate).toHaveBeenCalledTimes(1)
    mockTranslate.mock.calls[0][1].onEngineDispatch('apple')

    emit(full(0))
    emit(full(1))
    emit(full(2))
    mockLane.onBatchDone(1, 'lease-1', 1)
    await tick()
    await jest.advanceTimersByTimeAsync(250)

    const result = await running
    expect(result.scanned).toBe(3)
    expect(result.cacheOnly).toBe(true)
    expect(result.items.every((item) => item.engine === 'cache:scan')).toBe(true)
    expect(result.items.every((item) => !item.engineWork)).toBe(true)
    await stop()
  })

  it('aggregates 40 items across shards into one cache window even if engine work was claimed', async () => {
    create(40)
    const running = session.fill({ limit: 4 })
    await tick()

    const shard1 = mockLane.next('lease-1')!
    expect(shard1).toHaveLength(32)

    // Task 0 claimed by engine
    emit(miss(0))
    await tick()
    expect(mockTranslate).toHaveBeenCalledTimes(1)
    mockTranslate.mock.calls[0][1].onEngineDispatch('apple')

    // Shard 1 all hit cache
    for (const t of shard1) emit(full(t.id))
    mockLane.onBatchDone(1, 'lease-1', 1)
    await tick()

    // Shard 2 arrives
    const shard2 = mockLane.next('lease-1')!
    expect(shard2).toHaveLength(8)
    for (const t of shard2) emit(full(t.id))
    mockLane.onBatchDone(2, 'lease-1', 1)
    await tick()

    const result = await running
    expect(result.scanned).toBe(40)
    expect(result.translated).toBe(40)
    expect(result.cacheOnly).toBe(true)
    expect(result.items.every((item) => item.engine === 'cache:scan')).toBe(true)
    expect(result.items.every((item) => !item.engineWork)).toBe(true)
    await stop()
  })

  it('rechecks a stale full hit and does not dispatch it until the cache confirms a miss', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    expect(mockTranslate).not.toHaveBeenCalled()
    mockAuthorityVersion = 'authority-v2'
    emit({ ...full(0), authorityVersion: 'authority-v1' })
    await tick()
    expect(mockLane.next('lease-1')).toEqual([{ id: 0, src: 'Text0' }])
    emit({ ...full(0), authorityVersion: 'authority-v2' })
    await tick()
    emit({ ...miss(0), authorityVersion: 'authority-v2' })
    await tick()
    for (const [src, work] of pending) if (src === 'Text0') work.resolve({ src, zh: '重新翻译' })
    await tick()
    expect((await running).translated).toBe(1)
    await session.close()
  })

  it('falls back to the engine after bounded stale rechecks instead of leaving the item parked', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    mockAuthorityVersion = 'authority-v2'
    emit({ ...full(0), stamp: 'game-v1', authorityVersion: 'authority-v1' })
    await tick()
    expect(mockLane.next('lease-1')).toEqual([{ id: 0, src: 'Text0' }])
    // Still stale: the file stamp moved again.
    mockGameStamp = 'game-v2'
    emit({ ...full(0), stamp: 'game-v1', authorityVersion: 'authority-v2' })
    await tick()
    expect(mockLane.next('lease-1')).toEqual([{ id: 0, src: 'Text0' }])
    // Third attempt: cache confirms a miss, which releases it to the engine.
    mockGameStamp = 'game-v3'
    emit({ ...miss(0) })
    await tick()
    expect(mockLane.next('lease-1')).toEqual([])
    for (const work of pending.values()) work.resolve({ src: 'Text0', zh: '重新翻译', engine: 'google' })
    await tick()
    expect((await running).translated).toBe(1)
    await session.close()
  })

  it('releases in-flight recheck tasks to the engine when the cache lane fails', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    mockAuthorityVersion = 'authority-v2'
    emit({ ...full(0), authorityVersion: 'authority-v1' })
    await tick()
    expect(mockLane.next('lease-1')).toEqual([{ id: 0, src: 'Text0' }])
    mockLane.onError('Worker crashed during recheck')
    await tick()
    const retry = mockTranslate.mock.calls.findLastIndex(([texts]) => texts[0] === 'Text0')
    expect(retry).toBeGreaterThanOrEqual(0)
    pending.get('Text0')!.resolve({ src: 'Text0', zh: '引擎译文', engine: 'google' })
    await tick()
    expect((await running).translated).toBe(1)
    await session.close()
  })

  it('preserves in-flight recheck tasks when session is paused and resumed', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    mockAuthorityVersion = 'authority-v2'
    emit({ ...full(0), authorityVersion: 'authority-v1' })
    await tick()
    expect(mockLane.next('lease-1')).toEqual([{ id: 0, src: 'Text0' }])
    pending.get('Text0')?.reject(new Error('aborted'))
    await tick()
    session.pause()
    await tick()
    await running
    const resumed = session.fill({ limit: 1 })
    await tick()
    expect(mockLane.next('lease-1')).toEqual([{ id: 0, src: 'Text0' }])
    mockAuthorityVersion = 'authority-v2'
    emit({ ...full(0), authorityVersion: 'authority-v2' })
    await tick()
    expect((await resumed).translated).toBe(1)
    await session.close()
  })

  it('returns a pure cache window beyond the engine batch limit without a real engine submission', async () => {
    const running = create(12).fill({ limit: 4 })
    await tick()
    mockLane.next('lease-1')
    for (let id = 0; id < 12; id++) emit(full(id))
    await tick()
    mockWake()
    await tick()
    const result = await running
    expect(result.scanned).toBe(12)
    expect(result.translated).toBe(12)
    expect(result.items.every((item) => item.engine === 'cache:scan')).toBe(true)
    expect(mockTranslate).not.toHaveBeenCalled()
    await session.close()
  })

  it('keeps the engine batch limit for a mixed cache and engine window', async () => {
    const running = create(8).fill({ limit: 4 })
    await tick()
    mockLane.next('lease-1')
    // Emit the miss first so the engine slot is claimed while cache results arrive.
    emit(miss(0))
    await tick()
    for (let id = 1; id < 4; id++) emit(full(id))
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: '引擎译文', engine: 'google' })
    await tick()
    const result = await running
    expect(result.scanned).toBe(4)
    expect(result.items.filter((item) => item.engine === 'cache:scan')).toHaveLength(3)
    expect(result.items.some((item) => item.engine === 'google')).toBe(true)
    await stop()
  })

  it('keeps cacheUnavailable set for later windows until the session inventory resets', async () => {
    create(2)
    const running = session.fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    mockLane.onError('Cache worker timed out')
    await tick()
    for (const work of pending.values()) work.resolve({ src: 'Text0', zh: '第一段' })
    await tick()
    const first = await running
    expect(first.cacheUnavailable).toBe(true)

    const second = session.fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    mockLane.onError('Cache worker timed out')
    await tick()
    for (const work of pending.values()) work.resolve({ src: 'Text1', zh: '第二段' })
    await tick()
    expect(await second).toMatchObject({ cacheUnavailable: true })
    await session.close()
  })

  it('excludes cache hits from the measured completion throughput', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    emit(full(0))
    await tick()
    const result = await running
    expect(result.translated).toBe(1)
    expect(result.performance?.completedChars).toBe(0)
    await session.close()
  })

  it('accepts engine success without waiting for the cache and ignores a late cache reply', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    emit(miss(0))
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: '引擎译文' })
    expect((await running).translated).toBe(1)
    emit(full(0))
    expect(session.processed).toBe(1)
    expect(session.progress.done).toBe(1)
    await session.close()
  })

  it('routes failures to another engine after fresh work and never retries the failed engine', async () => {
    mockEngines = ['agent:a', 'google']
    const running = create(5).fill({ limit: 2 })
    await tick()
    for (const t of mockLane.next('lease-1')!) emit(miss(t.id))
    await tick()
    // The first dispatch lands on the first engine (agent:a); the second may reuse
    // the same engine because capacity allows it. Only assert the fallback path.
    expect(mockTranslate).toHaveBeenCalled()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Agent failed' })
    await tick()
    for (let i = 0; i < 8 && !mockTranslate.mock.calls.some(([texts, opts]) => texts[0] === 'Text0' && opts.engines[0] === 'google'); i++) {
      for (const [src, work] of pending) if (src !== 'Text0') work.resolve({ src, zh: '译文' })
      await tick()
    }
    const googleRetry = mockTranslate.mock.calls.findIndex(([texts, opts]) => texts[0] === 'Text0' && opts.engines[0] === 'google')
    expect(googleRetry).toBeGreaterThan(mockTranslate.mock.calls.findIndex(([texts]) => texts[0] === 'Text4'))
    session.pause()
    for (const [src, work] of pending) work.resolve({ src, zh: src === 'Text0' ? '平台兜底' : '译文' })
    await tick()
    await running
    await session.close()
    expect(session.processed).toBe(5)
    expect(mockTranslate.mock.calls.filter(([texts, opts]) => texts[0] === 'Text0' && opts.engines[0] === 'agent:a')).toHaveLength(1)
  })

  it('keeps a pending cache lookup alive after all engines fail', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    // Force engine dispatch via cache failure so the task waits for a later cache reply.
    mockLane.onError('Cache worker timed out')
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Service unavailable' })
    await tick()
    expect((await running).failed).toBe(1)
    await session.close()
  })

  it('finishes with a failure when both the engine and cache lane fail', async () => {
    const running = create(1).fill({ limit: 1 })
    await tick()
    mockLane.next('lease-1')
    emit(miss(0))
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
    // Release all unclassified work to the engine path by failing the cache lane.
    mockLane.next('lease-1')
    mockLane.onError('Cache worker timed out')
    await tick()
    pending.get('Text0')!.resolve({ src: 'Text0', zh: null, error: 'Agent failed' })
    await tick()
    await first
    // Now enable a second engine for the remaining missing item.
    mockEngines = ['google']
    const second = session.fill({ limit: 1 })
    await tick()
    pending.get('Text1')!.resolve({ src: 'Text1', zh: '成功', engine: 'google' })
    await tick()
    expect((await second).translated).toBe(1)
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
    for (;;) {
      const chunk = mockLane.next('lease-1')
      if (!chunk || !chunk.length) break
      for (const t of chunk) emit(miss(t.id))
    }
    await tick()
    expect(mockTranslate.mock.calls.length).toBeLessThanOrEqual(64)
    await stop()
    await running
  })

  it('honors the active character budget and sends an oversized source alone', async () => {
    const running = create(4).fill({ limit: 4, maxChars: 3 })
    await tick()
    for (const t of mockLane.next('lease-1')!) emit(miss(t.id))
    await tick()
    expect(mockTranslate).toHaveBeenCalledTimes(1)
    await stop()
    expect((await running).translated).toBe(1)
  })

  it('releases the lease but does not close the worker on pause', async () => {
    const running = create(10).fill({ limit: 2 })
    await tick()
    for (const t of mockLane.next('lease-1')!) emit(miss(t.id))
    await tick()
    session.pause()
    await tick()
    expect(mockSetLease).toHaveBeenCalledWith('')
    expect(mockClose).not.toHaveBeenCalled()
    for (const [src, work] of pending) work.resolve({ src, zh: '译文' })
    await tick()
    await running
    await session.close()
    expect(mockTranslate).toHaveBeenCalledTimes(2)
    expect(session.progress.done).toBe(2)
  })

  it('aggregates pure cache hits across multiple 32-item shards into 40-item windows', async () => {
    create(96)
    const firstRunning = session.fill({ limit: 4 })
    await tick()

    const shard1 = mockLane.next('lease-1')!
    expect(shard1).toHaveLength(32)
    for (const t of shard1) emit(full(t.id))
    mockLane.onBatchDone(1, 'lease-1', 1)
    await tick()

    const shard2 = mockLane.next('lease-1')!
    expect(shard2).toHaveLength(32)
    for (const t of shard2) emit(full(t.id))
    mockLane.onBatchDone(2, 'lease-1', 1)
    await tick()

    const firstResult = await firstRunning
    expect(firstResult.scanned).toBe(40)
    expect(firstResult.translated).toBe(40)
    expect(firstResult.cacheOnly).toBe(true)
    expect(firstResult.windowReason).toBe('capacity')

    const secondRunning = session.fill({ limit: 4 })
    await tick()

    const shard3 = mockLane.next('lease-1')!
    expect(shard3).toHaveLength(32)
    for (const t of shard3) emit(full(t.id))
    mockLane.onBatchDone(3, 'lease-1', 1)
    await tick()

    const secondResult = await secondRunning
    expect(secondResult.scanned).toBe(40)
    expect(secondResult.translated).toBe(40)
    expect(secondResult.cacheOnly).toBe(true)

    const thirdRunning = session.fill({ limit: 4 })
    await tick()
    const thirdResult = await thirdRunning
    expect(thirdResult.scanned).toBe(16)
    expect(thirdResult.translated).toBe(16)
    expect(thirdResult.cacheOnly).toBe(true)
    expect(thirdResult.windowReason).toBe('finished')

    expect(mockTranslate).not.toHaveBeenCalled()
    await session.close()
  })

  it('does not commit a 1-item window when first shard finishes but more work remains', async () => {
    create(40)
    const running = session.fill({ limit: 4 })
    await tick()

    const shard1 = mockLane.next('lease-1')!
    expect(shard1).toHaveLength(32)
    emit(full(0))
    for (let id = 1; id < 32; id++) emit(miss(id))
    mockLane.onBatchDone(1, 'lease-1', 1)
    await tick()

    const shard2 = mockLane.next('lease-1')!
    expect(shard2).toHaveLength(8)
    for (const t of shard2) emit(full(t.id))
    mockLane.onBatchDone(2, 'lease-1', 1)
    await tick()

    await jest.advanceTimersByTimeAsync(250)
    const result = await running
    expect(result.scanned).toBe(9)
    expect(result.items.filter((item) => item.engine === 'cache:scan')).toHaveLength(9)
    await stop()
  })

  it('waits for 250ms quiet draining window after work exhaustion before committing', async () => {
    create(20)
    const running = session.fill({ limit: 4 })
    await tick()

    const shard = mockLane.next('lease-1')!
    expect(shard).toHaveLength(20)
    for (let id = 0; id < 10; id++) emit(full(id))
    for (let id = 10; id < 20; id++) emit(miss(id))
    mockLane.onBatchDone(1, 'lease-1', 1)
    await tick()

    let resolved = false
    void running.then(() => {
      resolved = true
    })
    await jest.advanceTimersByTimeAsync(100)
    expect(resolved).toBe(false)

    await jest.advanceTimersByTimeAsync(150)
    expect(resolved).toBe(true)
    const result = await running
    expect(result.scanned).toBe(10)
    expect(result.cacheOnly).toBe(true)
    expect(result.windowReason).toBe('cache-drained')
    await stop()
  })

  it('commits pure cache window after 250ms draining even while active slow engine is in flight', async () => {
    create(15)
    const running = session.fill({ limit: 4 })
    await tick()

    const shard = mockLane.next('lease-1')!
    expect(shard).toHaveLength(15)
    emit(miss(0))
    await tick()
    expect(mockTranslate).toHaveBeenCalledTimes(1)

    for (let id = 1; id < 15; id++) emit(full(id))
    mockLane.onBatchDone(1, 'lease-1', 1)
    await tick()

    await jest.advanceTimersByTimeAsync(250)
    const result = await running
    expect(result.scanned).toBe(14)
    expect(result.cacheOnly).toBe(true)
    expect(result.items.every((item) => item.engine === 'cache:scan')).toBe(true)

    pending.get('Text0')!.resolve({ src: 'Text0', zh: '引擎终于返回', engine: 'google' })
    await tick()
    await stop()
  })

  it('caps pure cache window at 10,000 characters and commits an oversized single item alone', async () => {
    const longText = 'A'.repeat(12000)
    const file = gameContentPath(root, 'seed')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ [longText]: '', Normal: '' }))
    session = createScheduledSeedSession(root)

    const running = session.fill({ limit: 4 })
    await tick()

    const shard = mockLane.next('lease-1')!
    expect(shard).toHaveLength(2)
    mockLane.onResult(
      {
        id: 0,
        src: longText,
        stamp: mockGameStamp,
        authorityVersion: mockAuthorityVersion,
        elapsedMs: 2,
        plan: { ...planSentenceTranslation(longText, [{ id: 'cache:0', revision: 1, src: longText, zh: '超长译文', engine: 'manual' }]), corpusVersion: 'v1' },
      },
      1,
      'lease-1'
    )
    mockLane.onResult(
      {
        id: 1,
        src: 'Normal',
        stamp: mockGameStamp,
        authorityVersion: mockAuthorityVersion,
        elapsedMs: 2,
        plan: { ...planSentenceTranslation('Normal', [{ id: 'cache:1', revision: 1, src: 'Normal', zh: '正常译文', engine: 'manual' }]), corpusVersion: 'v1' },
      },
      1,
      'lease-1'
    )
    mockLane.onBatchDone(1, 'lease-1', 1)
    await tick()

    const result = await running
    expect(result.scanned).toBe(1)
    expect(result.items[0].src).toBe(longText)
    expect(result.cacheOnly).toBe(true)

    const nextRunning = session.fill({ limit: 4 })
    await tick()
    const nextResult = await nextRunning
    expect(nextResult.scanned).toBe(1)
    expect(nextResult.items[0].src).toBe('Normal')

    await session.close()
  })
})
