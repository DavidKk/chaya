import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let mockRoot = ''
let mockJobs = ''
let mockWorkerAlive = false
let mockWorkerStarted = false
const mockCommand = jest.fn()

jest.mock('@/constants/paths', () => ({
  get TRANSLATE_JOBS_DIR() {
    return mockJobs
  },
  CACHE_WORKER_PATH: '/tmp/chaya-cache-worker.mjs',
}))
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: true, remote: false, contentRoot: mockRoot }) }))
jest.mock('@/services/translate/seed-job-worker-client', () => ({
  commandSeedJobWorker: (...args: unknown[]) => mockCommand(...args),
  seedJobWorkerAlive: () => mockWorkerAlive,
  seedJobWorkerStarted: () => mockWorkerStarted,
}))

import { getSeedJobSnapshot, refreshSeedJobProgress, startSeedJob } from '@/services/translate/seed-job'
import { idleSeedJob, seedJobFile, writeSeedJobState } from '@/services/translate/seed-job-state'

function snapshotState(overrides: Partial<ReturnType<typeof idleSeedJob>> = {}) {
  return {
    ...idleSeedJob(mockRoot),
    hasSeed: true,
    status: 'paused' as const,
    progress: {
      contentRoot: mockRoot,
      hasSeed: true,
      total: 2,
      done: 1,
      missing: 1,
      needCount: 2,
      skipCount: 0,
      needChars: 10,
      skipChars: 0,
      missingChars: 5,
      doneChars: 5,
      lines: 2,
      batchSize: 40,
      batchesLeft: 1,
    },
    ...overrides,
  }
}

describe('seed job facade', () => {
  let dir: string

  beforeEach(() => {
    jest.useFakeTimers()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-seed-facade-'))
    mockJobs = path.join(dir, 'jobs')
    mockRoot = path.join(dir, 'game')
    mockWorkerAlive = false
    mockWorkerStarted = false
    mockCommand.mockReset().mockResolvedValue({})
    const pending = (globalThis as typeof globalThis & { __chayaSeedJobPending?: Map<string, unknown> }).__chayaSeedJobPending
    pending?.clear()
  })

  afterEach(() => {
    jest.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns the disk snapshot without starting a worker on poll', () => {
    writeSeedJobState(snapshotState())
    expect(getSeedJobSnapshot()).toMatchObject({ done: 1, missing: 1, job: { status: 'paused' } })
    expect(mockCommand).not.toHaveBeenCalled()
  })

  it('clears preparing as soon as the start command is accepted', async () => {
    writeSeedJobState(snapshotState())
    expect(startSeedJob()).toMatchObject({ preparing: true })
    await jest.runAllTimersAsync()
    expect(mockCommand).toHaveBeenCalledWith('start')
    expect(getSeedJobSnapshot().preparing).toBeUndefined()
  })

  it('clears preparing after a rejected refresh', async () => {
    writeSeedJobState(snapshotState())
    mockCommand.mockRejectedValueOnce(new Error('worker unavailable'))
    expect(refreshSeedJobProgress()).toMatchObject({ preparing: true })
    await jest.runAllTimersAsync()
    expect(mockCommand).toHaveBeenCalledWith('refresh')
    expect(getSeedJobSnapshot().preparing).toBeUndefined()
  })

  it('demotes a stale running job when the worker is not running it', () => {
    writeSeedJobState(snapshotState({ status: 'running', inventoryPreparing: true }))
    expect(getSeedJobSnapshot().job).toMatchObject({ status: 'paused', inventoryPreparing: false })
    const persisted = JSON.parse(fs.readFileSync(seedJobFile(mockRoot), 'utf8'))
    expect(persisted).toMatchObject({ status: 'paused', inventoryPreparing: false })
  })

  it('keeps a running job while this process owns the started worker', () => {
    writeSeedJobState(snapshotState({ status: 'running', inventoryPreparing: true }))
    mockWorkerAlive = true
    mockWorkerStarted = true
    expect(getSeedJobSnapshot().job).toMatchObject({ status: 'running', inventoryPreparing: true })
  })
})
