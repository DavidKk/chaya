jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openSharedCache } from '@/services/translate/shared-cache'
import { isSharedCacheMigrating, resetSharedCacheMigrateForTests, scheduleSharedCacheHeavyMigrate, waitSharedCacheHeavyMigrate } from '@/services/translate/shared-cache/migrate-bg'

describe('scheduleSharedCacheHeavyMigrate', () => {
  let dir: string
  let dbPath: string
  let jestWorkerId: string | undefined

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-migrate-bg-'))
    dbPath = path.join(dir, 'shared.sqlite')
    const cache = openSharedCache(dbPath)
    cache.close()
    resetSharedCacheMigrateForTests()
    jestWorkerId = process.env.JEST_WORKER_ID
    delete process.env.JEST_WORKER_ID
  })

  afterEach(() => {
    if (jestWorkerId === undefined) delete process.env.JEST_WORKER_ID
    else process.env.JEST_WORKER_ID = jestWorkerId
    resetSharedCacheMigrateForTests()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('shares one async flight for concurrent schedule on the same db', async () => {
    scheduleSharedCacheHeavyMigrate(dbPath)
    const first = waitSharedCacheHeavyMigrate(dbPath)
    scheduleSharedCacheHeavyMigrate(dbPath)
    const second = waitSharedCacheHeavyMigrate(dbPath)

    expect(first).toBe(second)
    expect(isSharedCacheMigrating(dbPath)).toBe(true)

    await first
    expect(isSharedCacheMigrating(dbPath)).toBe(false)
  })
})
