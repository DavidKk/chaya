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
  fillMissingFromSeed: (...args: unknown[]) => mockFill(...args),
  getSeedTranslateProgress: (...args: unknown[]) => mockProgress(...args),
}))
jest.mock('@/services/translate/engine-switches', () => ({ getTranslateEngineSwitches: (...args: unknown[]) => mockSwitches(...(args as [])) }))

import { getSeedJobSnapshot, startSeedJob } from '@/services/translate/seed-job'

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
    startSeedJob()
    await jest.runAllTimersAsync()
    expect(mockFill.mock.calls[3][0].exclude.size).toBe(0)
    expect(mockSwitches).toHaveBeenCalledWith(mockRoot)
  })

  it('starts after a seed change even when polling still has cached completed progress', async () => {
    mockProgress.mockImplementation((_root: string, fresh = false) => ({ ...progress(), missing: fresh ? 2 : 0 }))
    mockFill.mockResolvedValue({ ...progress(), translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] })
    startSeedJob()
    await jest.runAllTimersAsync()
    expect(mockFill).toHaveBeenCalledTimes(1)
  })
})
