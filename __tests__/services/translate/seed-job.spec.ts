import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let mockRoot = ''
let mockJobs = ''
const mockFill = jest.fn()
const mockProgress = jest.fn()
const mockSwitches = jest.fn(() => ({ enabled: ['google'] }))
const progress = () => ({ contentRoot: mockRoot, hasSeed: true, total: 2, needCount: 2, done: 0, missing: 2 })
jest.mock('@/constants/paths', () => ({
  get TRANSLATE_JOBS_DIR() {
    return mockJobs
  },
  // Present so scrub/hide logic does not call existsSync(undefined) under the paths mock.
  CACHE_WORKER_PATH: '/tmp/chaya-cache-worker.mjs',
}))
jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs') as typeof import('node:fs')
  return {
    ...actual,
    existsSync: (p: unknown) => (p === '/tmp/chaya-cache-worker.mjs' ? true : actual.existsSync(p as any)),
  }
})
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: true, contentRoot: mockRoot }) }))
jest.mock('@/services/translate/fill-missing', () => ({
  createSeedFillSession: (root: string) => ({
    get progress() {
      return mockProgress(root)
    },
    fill: (opts: object) => mockFill({ contentRoot: root, ...opts }),
  }),
  getSeedTranslateProgress: (...args: unknown[]) => mockProgress(...args),
}))
jest.mock('@/services/translate/engine-switches', () => ({ getTranslateEngineSwitches: (...args: unknown[]) => mockSwitches(...(args as [])) }))
const mockPrepare = jest.fn(async (root: string) => ({
  progress: {
    contentRoot: root,
    hasSeed: true,
    total: 2,
    needCount: 2,
    done: 0,
    missing: 2,
    skipCount: 0,
    needChars: 0,
    skipChars: 0,
    missingChars: 0,
    doneChars: 0,
    lines: 0,
    batchSize: 40,
    batchesLeft: 1,
  },
  pending: ['こんにちは', 'さようなら'],
  stamp: 'test-stamp',
}))
jest.mock('@/services/translate/scheduler/seed-prepare', () => ({
  peekSeedInventory: () => null,
  isSeedInventoryPreparing: () => false,
  prepareSeedInventory: (...args: unknown[]) => mockPrepare(...(args as [string])),
}))

import { getSeedJobSnapshot, pauseSeedJob, refreshSeedJobProgress, startSeedJob } from '@/services/translate/seed-job-runtime'

/** startSeedJob schedules prepare off the HTTP path; flush so beginSeedLoop attaches the fill session. */
async function startSeedJobReady() {
  startSeedJob()
  await Promise.resolve()
  await jest.runAllTimersAsync()
  return getSeedJobSnapshot()
}

describe('seed job failures', () => {
  let dir: string
  beforeEach(() => {
    jest.useFakeTimers()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-job-review-'))
    mockJobs = path.join(dir, 'jobs')
    mockRoot = path.join(dir, 'A')
    mockFill.mockReset()
    mockProgress.mockReset().mockImplementation(progress)
    mockPrepare.mockReset().mockImplementation(async (root: string) => ({
      progress: {
        contentRoot: root,
        hasSeed: true,
        total: 2,
        needCount: 2,
        done: 0,
        missing: 2,
        skipCount: 0,
        needChars: 0,
        skipChars: 0,
        missingChars: 0,
        doneChars: 0,
        lines: 0,
        batchSize: 40,
        batchesLeft: 1,
      },
      pending: ['こんにちは', 'さようなら'],
      stamp: 'test-stamp',
    }))
  })
  afterEach(() => {
    jest.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('keeps polls free of inventory scans and only rescans on explicit refresh', async () => {
    mockPrepare.mockResolvedValueOnce({
      progress: { ...progress(), done: 1, missing: 1, skipCount: 0, needChars: 0, skipChars: 0, missingChars: 0, doneChars: 0, lines: 0, batchSize: 40, batchesLeft: 1 },
      pending: ['さようなら'],
      stamp: 'test-stamp',
    })
    for (let i = 0; i < 40; i++) expect(getSeedJobSnapshot()).toMatchObject({ stale: true, done: 0 })
    expect(mockPrepare).not.toHaveBeenCalled()
    expect(refreshSeedJobProgress()).toMatchObject({ preparing: true })
    expect(mockPrepare).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    await jest.runAllTimersAsync()
    for (let i = 0; i < 40; i++) expect(getSeedJobSnapshot()).toMatchObject({ done: 1, missing: 1 })
    expect(getSeedJobSnapshot().preparing).toBeUndefined()
    expect(mockPrepare).toHaveBeenCalledTimes(1)
    const checkpoint = JSON.parse(fs.readFileSync(path.join(mockJobs, fs.readdirSync(mockJobs)[0]), 'utf8'))
    expect(checkpoint.progress).toMatchObject({ done: 1, missing: 1 })
    expect(checkpoint.progressStamp).toBeTruthy()
  })

  it('processes later items once, then pauses; manual resume retries failures', async () => {
    mockFill
      .mockResolvedValueOnce({ ...progress(), translated: 0, failed: 1, scanned: 1, unresolved: ['こんにちは'], items: [{ src: 'こんにちは', zh: null }] })
      .mockResolvedValueOnce({ ...progress(), translated: 1, failed: 0, scanned: 1, unresolved: [], items: [{ src: 'さようなら', zh: '再见', engine: 'cache:shared' }] })
      .mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    await startSeedJobReady()
    expect(mockFill).toHaveBeenCalledTimes(3)
    expect(mockFill.mock.calls[1][0]).toMatchObject({ contentRoot: mockRoot, exclude: new Set(['こんにちは']) })
    expect(getSeedJobSnapshot().job).toMatchObject({ status: 'paused', failedSources: ['こんにちは'] })
    const logs = getSeedJobSnapshot().job.logs
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'fail', batch: expect.objectContaining({ batch: 1, success: 0, total: 1, failed: 1, chars: 5, cacheHits: 0 }) }),
        expect.objectContaining({ level: 'ok', batch: expect.objectContaining({ batch: 2, success: 1, total: 1, failed: 0, chars: 5, cacheHits: 1, finalSources: ['cache'] }) }),
      ])
    )
    expect(logs.some((entry) => /Requesting batch| → |additional items omitted/.test(entry.text))).toBe(false)
    const savedDebug = process.env.CHAYA_TRANSLATE_DEBUG
    delete process.env.CHAYA_TRANSLATE_DEBUG
    try {
      mockFill.mock.calls[0][0].onTrace('Item 1 engine requested: engine=google')
      expect(getSeedJobSnapshot().job.logs).toHaveLength(logs.length)
      mockFill.mock.calls[0][0].onTrace('Cache scan unavailable: Worker timed out')
      expect(getSeedJobSnapshot().job.logs.at(-1)).toMatchObject({ level: 'warn', text: 'Cache scan failed: Worker timed out' })
    } finally {
      if (savedDebug == null) delete process.env.CHAYA_TRANSLATE_DEBUG
      else process.env.CHAYA_TRANSLATE_DEBUG = savedDebug
    }
    await startSeedJobReady()
    expect(mockFill.mock.calls[3][0].exclude.size).toBe(0)
    expect(mockSwitches).toHaveBeenCalledWith(mockRoot)
  })

  it('keeps structured cache unavailability separate from real engine submissions', async () => {
    mockFill
      .mockResolvedValueOnce({
        ...progress(),
        translated: 1,
        failed: 0,
        scanned: 1,
        unresolved: [],
        items: [{ src: 'こんにちは', zh: '你好', engine: 'live:google' }],
        submittedEngines: ['google'],
        cacheUnavailable: true,
      })
      .mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    await startSeedJobReady()
    const batch = getSeedJobSnapshot().job.logs.find((entry) => entry.batch)?.batch
    expect(batch).toMatchObject({ submittedSources: ['platform'], finalSources: ['platform'], cacheUnavailable: true })
    expect(getSeedJobSnapshot().job.logs.find((entry) => entry.batch)?.text).toContain('[platform]')
    expect(getSeedJobSnapshot().job.logs.find((entry) => entry.batch)?.text).not.toContain('Cache unavailable')
  })

  it('polls snapshots without rescanning while a batch is in flight and pauses at its boundary', async () => {
    let finish: (value: object) => void = () => {}
    mockFill.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await startSeedJobReady()
    const before = mockProgress.mock.calls.length
    for (let i = 0; i < 5; i++) getSeedJobSnapshot()
    expect(mockProgress).toHaveBeenCalledTimes(before)
    pauseSeedJob()
    jest.advanceTimersByTime(2000)
    finish({ ...progress(), translated: 1, failed: 0, scanned: 1, unresolved: [], items: [{ src: 'Hello', zh: '你好' }], performance: { completedChars: 100, cacheMs: 5 } })
    await jest.runAllTimersAsync()
    expect(mockFill).toHaveBeenCalledTimes(1)
    expect(getSeedJobSnapshot().job).toMatchObject({ status: 'paused', performance: { charsPerSecond: 50, cacheMs: 5 } })
    jest.advanceTimersByTime(60_000)
    expect(getSeedJobSnapshot().job.performance?.charsPerSecond).toBe(50)
  })

  it.each([false, true])('resamples speed after a one-day pause (reload persisted job: %s)', async (reload) => {
    let finish: (value: object) => void = () => {}
    mockFill.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const completeBatch = (completedChars: number) =>
      finish({ ...progress(), scanned: 1, translated: 1, failed: 0, unresolved: [], items: [], performance: { completedChars, cacheMs: 3 } })
    await startSeedJobReady()
    pauseSeedJob()
    jest.advanceTimersByTime(2000)
    completeBatch(100)
    await jest.runAllTimersAsync()
    expect(getSeedJobSnapshot().job.performance?.charsPerSecond).toBe(50)

    jest.advanceTimersByTime(24 * 60 * 60 * 1000)
    if (reload) {
      const store = globalThis as typeof globalThis & { __chayaSeedJobs: Map<string, unknown> }
      store.__chayaSeedJobs.delete(mockRoot)
    }
    const resumed = await startSeedJobReady()
    expect(resumed.job.performance).toBeNull()
    expect(getSeedJobSnapshot().job.performance).toBeNull()
    const persisted = JSON.parse(fs.readFileSync(path.join(mockJobs, fs.readdirSync(mockJobs)[0]), 'utf8'))
    expect(persisted.performance).toBeNull()
    pauseSeedJob()
    jest.advanceTimersByTime(1000)
    completeBatch(20)
    await jest.runAllTimersAsync()
    expect(getSeedJobSnapshot().job).toMatchObject({ status: 'paused', performance: { charsPerSecond: 20, cacheMs: 3 } })
  })

  it('measures batch duration independently of wall-clock corrections', async () => {
    let finish: (value: object) => void = () => {}
    mockFill.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await startSeedJobReady()
    pauseSeedJob()
    jest.advanceTimersByTime(2000)
    jest.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
    finish({ ...progress(), scanned: 1, translated: 1, failed: 0, unresolved: [], items: [], performance: { completedChars: 100, cacheMs: 3 } })
    await jest.runAllTimersAsync()
    expect(getSeedJobSnapshot().job.performance?.charsPerSecond).toBe(50)
  })

  it('hands off a drained legacy worker without auto-resuming on the main thread', async () => {
    getSeedJobSnapshot()
    const store = globalThis as typeof globalThis & { __chayaSeedJobs: Map<string, { running: boolean; workerVersion: number; stopRequested: boolean; state: { status: string } }> }
    const legacy = store.__chayaSeedJobs.get(mockRoot)!
    legacy.running = true
    legacy.workerVersion = 0
    legacy.state.status = 'running'
    jest.isolateModules(() => {
      jest.requireActual('@/services/translate/seed-job-runtime')
    })
    expect(legacy.stopRequested).toBe(true)
    legacy.running = false
    legacy.stopRequested = false
    legacy.state.status = 'paused'
    mockFill.mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    await jest.runAllTimersAsync()
    // Must not ensureLoop / fill here — that sync inventory freezes the console.
    expect(mockFill).not.toHaveBeenCalled()
    expect(getSeedJobSnapshot().job).toMatchObject({ status: 'paused' })
    expect(getSeedJobSnapshot().job.logs.some((entry) => entry.text.includes('Translation worker updated; job remains paused'))).toBe(true)
  })

  it('demotes orphaned running jobs on poll without starting inventory', async () => {
    refreshSeedJobProgress()
    await Promise.resolve()
    await jest.runAllTimersAsync()
    const store = globalThis as typeof globalThis & {
      __chayaSeedJobs: Map<string, { running: boolean; inventoryPreparing?: boolean; state: { status: string; progress?: object } }>
    }
    const rt = store.__chayaSeedJobs.get(mockRoot)!
    rt.running = false
    rt.inventoryPreparing = false
    rt.state.status = 'running'
    mockPrepare.mockClear()
    expect(getSeedJobSnapshot().job.status).toBe('paused')
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('keeps preparing inventory as running on poll (not orphan demote)', () => {
    refreshSeedJobProgress()
    const store = globalThis as typeof globalThis & {
      __chayaSeedJobs: Map<string, { running: boolean; inventoryPreparing?: boolean; state: { status: string } }>
    }
    const rt = store.__chayaSeedJobs.get(mockRoot)!
    rt.running = false
    rt.inventoryPreparing = true
    rt.state.status = 'running'
    const snap = getSeedJobSnapshot()
    expect(snap.job.status).toBe('running')
    expect(snap.preparing).toBe(true)
  })

  it('scrubs sticky cache-worker module errors from job logs on poll', async () => {
    refreshSeedJobProgress()
    await Promise.resolve()
    await jest.runAllTimersAsync()
    const store = globalThis as typeof globalThis & {
      __chayaSeedJobs: Map<string, { state: { logs: Array<{ id: number; at: number; level: string; text: string }> } }>
    }
    const rt = store.__chayaSeedJobs.get(mockRoot)!
    rt.state.logs = [
      { id: 1, at: Date.now(), level: 'warn', text: "Cache scan unavailable: Cannot find module '/x/native/bin/chaya-cache-worker.mjs'" },
      { id: 2, at: Date.now(), level: 'ok', text: 'Segment 1 complete: scanned 1, translated 1 · 12 chars · engines google' },
    ]
    const snap = getSeedJobSnapshot()
    expect(snap.job.logs.some((e) => /chaya-cache-worker/.test(e.text))).toBe(false)
    expect(snap.job.logs.some((e) => e.text.startsWith('Segment '))).toBe(true)
  })

  it('honors explicit pause while a legacy handoff is pending', async () => {
    getSeedJobSnapshot()
    const store = globalThis as typeof globalThis & { __chayaSeedJobs: Map<string, { running: boolean; workerVersion: number; state: { status: string } }> }
    const legacy = store.__chayaSeedJobs.get(mockRoot)!
    legacy.running = true
    legacy.workerVersion = 0
    legacy.state.status = 'running'
    jest.isolateModules(() => {
      jest.requireActual('@/services/translate/seed-job-runtime')
    })
    legacy.running = false
    legacy.state.status = 'paused'
    pauseSeedJob()
    await jest.runAllTimersAsync()
    expect(mockFill).not.toHaveBeenCalled()
    expect(getSeedJobSnapshot().job.status).toBe('paused')
  })

  it('starts after a seed change even when polling still has cached completed progress', async () => {
    mockProgress.mockImplementation((_root: string, fresh = false) => ({ ...progress(), missing: fresh ? 2 : 0 }))
    mockFill.mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    startSeedJob()
    await jest.runAllTimersAsync()
    expect(mockFill).toHaveBeenCalledTimes(1)
  })
})
