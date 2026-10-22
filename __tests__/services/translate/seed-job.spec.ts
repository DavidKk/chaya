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
}))
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

import { getSeedJobSnapshot, pauseSeedJob, startSeedJob } from '@/services/translate/seed-job'

describe('seed job failures', () => {
  let dir: string
  beforeEach(() => {
    jest.useFakeTimers()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-job-review-'))
    mockJobs = path.join(dir, 'jobs')
    mockRoot = path.join(dir, 'A')
    mockFill.mockReset()
    mockProgress.mockReset().mockImplementation(progress)
  })
  afterEach(() => {
    jest.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('checkpoints recovered progress and reuses it across unchanged paused polling', () => {
    mockProgress.mockReturnValue({ ...progress(), done: 1, missing: 1 })
    expect(getSeedJobSnapshot()).toMatchObject({ done: 1, missing: 1 })
    expect(getSeedJobSnapshot()).toMatchObject({ done: 1, missing: 1 })
    expect(mockProgress).toHaveBeenCalledTimes(1)
    const checkpoint = JSON.parse(fs.readFileSync(path.join(mockJobs, fs.readdirSync(mockJobs)[0]), 'utf8'))
    expect(checkpoint.progress).toMatchObject({ done: 1, missing: 1 })
    expect(checkpoint.progressStamp).toBeTruthy()
  })

  it('processes later items once, then pauses; manual resume retries failures', async () => {
    mockFill
      .mockResolvedValueOnce({ ...progress(), translated: 0, failed: 1, scanned: 1, unresolved: ['こんにちは'], items: [{ src: 'こんにちは', zh: null }] })
      .mockResolvedValueOnce({ ...progress(), translated: 1, failed: 0, scanned: 1, unresolved: [], items: [{ src: 'さようなら', zh: '再见' }] })
      .mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    startSeedJob()
    await jest.runAllTimersAsync()
    expect(mockFill).toHaveBeenCalledTimes(3)
    expect(mockFill.mock.calls[1][0]).toMatchObject({ contentRoot: mockRoot, exclude: new Set(['こんにちは']) })
    expect(getSeedJobSnapshot().job).toMatchObject({ status: 'paused', failedSources: ['こんにちは'] })
    const logs = getSeedJobSnapshot().job.logs
    expect(logs.some((entry) => entry.text.startsWith('Batch '))).toBe(true)
    expect(logs.some((entry) => /Requesting batch| → |additional items omitted/.test(entry.text))).toBe(false)
    const savedDebug = process.env.CHAYA_TRANSLATE_DEBUG
    delete process.env.CHAYA_TRANSLATE_DEBUG
    try {
      mockFill.mock.calls[0][0].onTrace('Item 1 engine requested: engine=google')
      expect(getSeedJobSnapshot().job.logs).toHaveLength(logs.length)
      mockFill.mock.calls[0][0].onTrace('Cache scan unavailable: Worker timed out')
      expect(getSeedJobSnapshot().job.logs.at(-1)).toMatchObject({ level: 'warn', text: 'Cache scan unavailable: Worker timed out' })
    } finally {
      if (savedDebug == null) delete process.env.CHAYA_TRANSLATE_DEBUG
      else process.env.CHAYA_TRANSLATE_DEBUG = savedDebug
    }
    startSeedJob()
    await jest.runAllTimersAsync()
    expect(mockFill.mock.calls[3][0].exclude.size).toBe(0)
    expect(mockSwitches).toHaveBeenCalledWith(mockRoot)
  })

  it('polls snapshots without rescanning while a batch is in flight and pauses at its boundary', async () => {
    let finish: (value: object) => void = () => {}
    mockFill.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    startSeedJob()
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
    startSeedJob()
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
    const resumed = startSeedJob()
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
    startSeedJob()
    pauseSeedJob()
    jest.advanceTimersByTime(2000)
    jest.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
    finish({ ...progress(), scanned: 1, translated: 1, failed: 0, unresolved: [], items: [], performance: { completedChars: 100, cacheMs: 3 } })
    await jest.runAllTimersAsync()
    expect(getSeedJobSnapshot().job.performance?.charsPerSecond).toBe(50)
  })

  it('hands off a drained legacy worker without requiring page polling', async () => {
    getSeedJobSnapshot()
    const store = globalThis as typeof globalThis & { __chayaSeedJobs: Map<string, { running: boolean; workerVersion: number; stopRequested: boolean; state: { status: string } }> }
    const legacy = store.__chayaSeedJobs.get(mockRoot)!
    legacy.running = true
    legacy.workerVersion = 0
    legacy.state.status = 'running'
    jest.isolateModules(() => {
      jest.requireActual('@/services/translate/seed-job')
    })
    expect(legacy.stopRequested).toBe(true)
    legacy.running = false
    legacy.stopRequested = false
    legacy.state.status = 'paused'
    mockFill.mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    await jest.runAllTimersAsync()
    expect(mockFill).toHaveBeenCalledTimes(1)
    expect(getSeedJobSnapshot().job.logs.some((entry) => entry.text.startsWith('Translation worker updated'))).toBe(true)
  })

  it('honors explicit pause while a legacy handoff is pending', async () => {
    getSeedJobSnapshot()
    const store = globalThis as typeof globalThis & { __chayaSeedJobs: Map<string, { running: boolean; workerVersion: number; state: { status: string } }> }
    const legacy = store.__chayaSeedJobs.get(mockRoot)!
    legacy.running = true
    legacy.workerVersion = 0
    legacy.state.status = 'running'
    jest.isolateModules(() => {
      jest.requireActual('@/services/translate/seed-job')
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
