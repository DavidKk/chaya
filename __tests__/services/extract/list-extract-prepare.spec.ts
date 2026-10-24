jest.mock('@/services/jobs', () => {
  const actual = jest.requireActual<typeof import('@/services/jobs')>('@/services/jobs')
  return {
    ...actual,
    runWorkerOnce: jest.fn(),
  }
})

jest.mock('@/lib/game', () => ({
  resolveGame: () => ({ ok: true, engine: 'VX Ace', contentRoot: '/game' }),
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getListExtractFlightForTests, pollListExtract, requestListExtract, resetListExtractForTests } from '@/services/extract/list-extract-prepare'
import { runWorkerOnce } from '@/services/jobs'

const mockWorker = runWorkerOnce as jest.MockedFunction<typeof runWorkerOnce>

beforeEach(() => {
  resetListExtractForTests()
  mockWorker.mockReset()
})

describe('list-extract-prepare singleFlight', () => {
  it('shares one in-flight worker across request + poll for the same root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-list-extract-'))
    const bodyPath = path.join(root, 'body.json')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockWorker.mockImplementation(async () => {
      await gate
      fs.writeFileSync(bodyPath, JSON.stringify({ ok: true, items: [] }))
      return { path: bodyPath }
    })

    expect(requestListExtract(root)).toEqual({ preparing: true })
    expect(pollListExtract(root)).toEqual({ preparing: true })
    expect(mockWorker).toHaveBeenCalledTimes(1)

    const flight = getListExtractFlightForTests(root)
    expect(flight).toBeDefined()
    release()
    await flight

    expect(pollListExtract(root)).toMatchObject({ preparing: false, bodyPath })
    expect(mockWorker).toHaveBeenCalledTimes(1)
  })
})
