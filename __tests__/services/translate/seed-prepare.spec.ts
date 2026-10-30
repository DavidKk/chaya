jest.mock('@/services/jobs', () => {
  const actual = jest.requireActual<typeof import('@/services/jobs')>('@/services/jobs')
  return {
    ...actual,
    runWorkerOnce: jest.fn(),
  }
})
const mockSyncGameCache = jest.fn()
const mockCloseCache = jest.fn()
jest.mock('@/services/translate/shared-cache', () => ({
  openSharedCache: () => ({ syncGameCache: mockSyncGameCache, close: mockCloseCache }),
}))
jest.mock('@/services/translate/scheduler/seed-inventory', () => ({ readSeedInventory: () => ({ pending: [], stamp: 'fallback' }) }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runWorkerOnce } from '@/services/jobs'
import { peekSeedInventory, prepareSeedInventory, resetSeedPrepareForTests } from '@/services/translate/scheduler/seed-prepare'

const mockWorker = runWorkerOnce as jest.MockedFunction<typeof runWorkerOnce>

beforeEach(() => {
  resetSeedPrepareForTests()
  mockWorker.mockReset()
  mockSyncGameCache.mockReset()
  mockCloseCache.mockReset()
})

describe('prepareSeedInventory', () => {
  it('repairs runtime projections even when the inventory worker is unavailable', async () => {
    mockWorker.mockRejectedValueOnce(new Error('worker missing'))
    await expect(prepareSeedInventory('/tmp/fallback-game')).resolves.toMatchObject({ stamp: 'fallback' })
    expect(mockSyncGameCache).toHaveBeenCalledWith('/tmp/fallback-game')
    expect(mockCloseCache).toHaveBeenCalledTimes(1)
  })
  it('does not silently skip a failed repair in the worker fallback', async () => {
    mockWorker.mockRejectedValueOnce(new Error('worker missing'))
    mockSyncGameCache.mockImplementationOnce(() => {
      throw new Error('cache unavailable')
    })
    await expect(prepareSeedInventory('/tmp/fallback-game')).rejects.toThrow('cache unavailable')
    expect(mockCloseCache).toHaveBeenCalledTimes(1)
  })
  it('shares one in-flight worker for concurrent prepare on the same root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-seed-prepare-'))
    const out = path.join(root, 'bundle.json')
    const bundle = {
      progress: {
        contentRoot: root,
        hasSeed: true,
        total: 1,
        done: 0,
        missing: 1,
        doneChars: 0,
        missingChars: 1,
        stale: false,
      },
      pending: ['あ'],
      stamp: 'stamp-1',
    }
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockWorker.mockImplementation(async () => {
      await gate
      fs.writeFileSync(out, JSON.stringify(bundle))
      return { path: out }
    })

    const a = prepareSeedInventory(root)
    const b = prepareSeedInventory(root)
    // prepare yields once before spawning the worker
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(mockWorker).toHaveBeenCalledTimes(1)
    release()
    await expect(Promise.all([a, b])).resolves.toEqual([bundle, bundle])
    expect(peekSeedInventory(root)).toEqual(bundle)
    expect(mockWorker).toHaveBeenCalledTimes(1)
  })
})
