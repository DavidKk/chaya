import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let mockRoot = ''
let mockJobs = ''
const mockFill = jest.fn()
const mockProgress = jest.fn()
const mockPeek = jest.fn()
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
  peekSeedInventory: (...args: unknown[]) => mockPeek(...args),
  isSeedInventoryPreparing: () => false,
  prepareSeedInventory: (...args: unknown[]) => mockPrepare(...(args as [string])),
}))

import { seedFileStamp, seedProgressStamp } from '@/services/translate/scheduler/seed-inventory'
import { getSeedJobSnapshot, pauseSeedJob, refreshSeedJobProgress, startSeedJob } from '@/services/translate/seed-job-runtime'
import { readSeedJobState } from '@/services/translate/seed-job-state'

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
    mockPeek.mockReset().mockReturnValue(null)
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

  it.each(['start', 'refresh'])('reprepares stale translation progress on %s even when the seed has not changed', async (action) => {
    const bundle = await mockPrepare(mockRoot)
    mockPrepare.mockClear()
    mockPeek.mockReturnValue({ ...bundle, stamp: seedFileStamp(mockRoot), progressStamp: 'outdated-cache' })
    mockFill.mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    if (action === 'start') startSeedJob()
    else refreshSeedJobProgress()
    expect(mockPrepare).toHaveBeenCalledTimes(1)
    await jest.runAllTimersAsync()
  })

  it.each(['start', 'refresh'])('reuses inventory with matching seed and translation progress on %s', async (action) => {
    const bundle = await mockPrepare(mockRoot)
    mockPrepare.mockClear()
    mockPeek.mockReturnValue({ ...bundle, stamp: seedFileStamp(mockRoot), progressStamp: seedProgressStamp(mockRoot) })
    mockFill.mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    if (action === 'start') startSeedJob()
    else refreshSeedJobProgress()
    expect(mockPrepare).not.toHaveBeenCalled()
    await jest.runAllTimersAsync()
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

  it('persists request and warning logs before an in-flight fill returns any results', async () => {
    let finish!: (result: object) => void
    mockFill.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    await startSeedJobReady()
    const { onTrace } = mockFill.mock.calls[0][0]
    const previous = readSeedJobState(mockRoot)!
    await jest.advanceTimersByTimeAsync(1000)

    onTrace('Agent request submitted: items=199, sourceChars=2997')
    const submitted = readSeedJobState(mockRoot)!
    expect(submitted).toMatchObject({ status: 'running', rounds: 0, sessionDone: 0 })
    expect(submitted.updatedAt).toBeGreaterThan(previous.updatedAt)
    expect(submitted.logs.at(-1)).toMatchObject({ request: { items: 199, chars: 2997 } })

    onTrace('Agent request submitted: items=196, sourceChars=2981')
    expect(readSeedJobState(mockRoot)!.logs.at(-1)).toMatchObject({ id: submitted.logs.at(-1)!.id + 1, request: { items: 196, chars: 2981 } })
    onTrace('Apple request submitted: items=40, sourceChars=1200')
    expect(readSeedJobState(mockRoot)!.logs.at(-1)).toMatchObject({ request: { engine: 'apple', items: 40, chars: 1200 } })
    onTrace('Cache scan unavailable: Worker timed out')
    expect(readSeedJobState(mockRoot)!.logs.at(-1)).toMatchObject({ level: 'warn', text: 'Cache scan failed: Worker timed out' })
    expect(mockFill).toHaveBeenCalledTimes(1)

    finish({ ...progress(), missing: 0, translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    await jest.runAllTimersAsync()
    expect(readSeedJobState(mockRoot)!.status).toBe('done')
  })

  it('finishes when all sources succeeded or terminally failed, without retrying on resume', async () => {
    mockFill
      .mockImplementationOnce(async () => {
        const batch = { ...progress(), missing: 1, failedCount: 1, translated: 0, failed: 1, scanned: 1, unresolved: ['こんにちは'], items: [{ src: 'こんにちは', zh: null }] }
        mockProgress.mockReturnValue(batch)
        return batch
      })
      .mockImplementationOnce(async () => {
        const batch = {
          ...progress(),
          done: 1,
          missing: 0,
          failedCount: 1,
          translated: 1,
          failed: 0,
          scanned: 1,
          unresolved: [],
          items: [{ src: 'さようなら', zh: '再见', engine: 'cache:shared' }],
        }
        mockProgress.mockReturnValue(batch)
        return batch
      })
      .mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    await startSeedJobReady()
    expect(mockFill).toHaveBeenCalledTimes(2)
    expect(getSeedJobSnapshot()).toMatchObject({ done: 1, failedCount: 1, missing: 0, job: { status: 'done', sessionDone: 1 } })
    const logs = getSeedJobSnapshot().job.logs
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'fail', batch: expect.objectContaining({ batch: 1, success: 0, total: 1, failed: 1, chars: 5, cacheHits: 0 }) }),
        expect.objectContaining({ text: 'Translation failed: こんにちは (no translation returned)', failure: { source: 'こんにちは', error: 'no translation returned' } }),
        expect.objectContaining({ level: 'ok', batch: expect.objectContaining({ batch: 2, success: 1, total: 1, failed: 0, chars: 5, cacheHits: 1, finalSources: ['cache'] }) }),
      ])
    )
    const checkpoint = JSON.parse(fs.readFileSync(path.join(mockJobs, fs.readdirSync(mockJobs)[0]), 'utf8'))
    expect(checkpoint.logs.find((entry: { failure?: unknown }) => entry.failure)?.failure).toEqual({ source: 'こんにちは', error: 'no translation returned' })
    expect(logs.some((entry) => /Requesting batch| → |additional items omitted/.test(entry.text))).toBe(false)
    const savedDebug = process.env.CHAYA_TRANSLATE_DEBUG
    delete process.env.CHAYA_TRANSLATE_DEBUG
    try {
      mockFill.mock.calls[0][0].onTrace('Item 1 engine requested: engine=google')
      expect(getSeedJobSnapshot().job.logs).toHaveLength(logs.length)
      mockFill.mock.calls[0][0].onTrace('Agent request submitted: items=100, sourceChars=3000')
      expect(getSeedJobSnapshot().job.logs.at(-1)).toMatchObject({ level: 'info', request: { items: 100, chars: 3000 } })
      mockFill.mock.calls[0][0].onTrace('Cache scan unavailable: Worker timed out')
      expect(getSeedJobSnapshot().job.logs.at(-1)).toMatchObject({ level: 'warn', text: 'Cache scan failed: Worker timed out' })
    } finally {
      if (savedDebug == null) delete process.env.CHAYA_TRANSLATE_DEBUG
      else process.env.CHAYA_TRANSLATE_DEBUG = savedDebug
    }
    const bundle = await mockPrepare(mockRoot)
    const completed = { ...bundle, progress: { ...bundle.progress, done: 1, failedCount: 1, missing: 0 }, pending: [] }
    mockPrepare.mockResolvedValue(completed)
    await startSeedJobReady()
    expect(mockFill).toHaveBeenCalledTimes(2)
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

  it('labels partial-cache completions with their accepted engine and counts only whole cache hits', async () => {
    mockFill
      .mockResolvedValueOnce({
        ...progress(),
        translated: 2,
        failed: 0,
        scanned: 2,
        unresolved: [],
        items: [
          { src: 'こんにちは', zh: '你好', engine: 'cache:partial', resultSources: ['cache', 'live:apple'], engineWork: true },
          { src: 'さようなら', zh: '再见', engine: 'cache:remote' },
        ],
        submittedEngines: ['apple'],
      })
      .mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    await startSeedJobReady()
    const log = getSeedJobSnapshot().job.logs.find((entry) => entry.batch)
    expect(log?.batch).toMatchObject({ finalSources: ['apple', 'cache'], submittedSources: ['apple'], cacheHits: 1 })
    expect(log?.text).toContain('[apple+cache]')
  })

  it('does not label a discarded engine result as an accepted source', async () => {
    mockFill
      .mockResolvedValueOnce({
        ...progress(),
        translated: 1,
        failed: 0,
        scanned: 1,
        unresolved: [],
        items: [{ src: 'こんにちは', zh: '人工译文', engine: 'cache:changed', resultSources: ['cache:changed'], engineWork: true }],
        submittedEngines: ['apple'],
      })
      .mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    await startSeedJobReady()
    expect(getSeedJobSnapshot().job.logs.find((entry) => entry.batch)?.batch).toMatchObject({
      finalSources: ['cache'],
      submittedSources: ['apple'],
      cacheHits: 1,
    })
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

  it('does not revive an expired rate when the first result after a stall arrives', async () => {
    let finish!: (result: object) => void
    mockFill.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    await startSeedJobReady()
    const { onItem } = mockFill.mock.calls[0][0]
    await jest.advanceTimersByTimeAsync(1000)
    onItem({ src: 'Hello', zh: '你好' })
    expect(getSeedJobSnapshot().job.performance?.charsPerSecond).toBeGreaterThan(0)

    await jest.advanceTimersByTimeAsync(31_000)
    onItem({ src: 'World', zh: '世界' })
    expect(getSeedJobSnapshot().job.performance).toBeNull()

    finish({ ...progress(), missing: 0, translated: 2, failed: 0, scanned: 2, unresolved: [], items: [] })
    await jest.runAllTimersAsync()
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

  it('does not inflate engine adaptive budget from pure cache batches', async () => {
    mockFill
      .mockResolvedValueOnce({
        ...progress(),
        translated: 40,
        failed: 0,
        scanned: 40,
        unresolved: [],
        items: Array.from({ length: 40 }, (_, i) => ({ src: `Text${i}`, zh: `译文${i}`, engine: 'cache:scan' })),
        cacheOnly: true,
      })
      .mockResolvedValueOnce({
        ...progress(),
        translated: 40,
        failed: 0,
        scanned: 40,
        unresolved: [],
        items: Array.from({ length: 40 }, (_, i) => ({ src: `Text${i + 40}`, zh: `译文${i + 40}`, engine: 'cache:scan' })),
        cacheOnly: true,
      })
      .mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })

    await startSeedJobReady()

    expect(mockFill).toHaveBeenCalledTimes(3)
    expect(mockFill.mock.calls[0][0]).toMatchObject({ limit: 4, maxChars: 3000 })
    expect(mockFill.mock.calls[1][0]).toMatchObject({ limit: 4, maxChars: 3000 })
    expect(mockFill.mock.calls[2][0]).toMatchObject({ limit: 4, maxChars: 3000 })
  })
})
