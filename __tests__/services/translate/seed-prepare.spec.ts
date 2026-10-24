jest.mock('@/services/jobs', () => {
  const actual = jest.requireActual<typeof import('@/services/jobs')>('@/services/jobs')
  return {
    ...actual,
    runWorkerOnce: jest.fn(),
  }
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runWorkerOnce } from '@/services/jobs'
import { peekSeedInventory, prepareSeedInventory, resetSeedPrepareForTests } from '@/services/translate/scheduler/seed-prepare'

const mockWorker = runWorkerOnce as jest.MockedFunction<typeof runWorkerOnce>

beforeEach(() => {
  resetSeedPrepareForTests()
  mockWorker.mockReset()
})

describe('prepareSeedInventory', () => {
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
