jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
let mockDb = ''
jest.mock('@/constants/paths', () => Object.defineProperty({ ...jest.requireActual('@/constants/paths') }, 'TRANSLATE_CACHE_DB_PATH', { get: () => mockDb }))
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import { gameContentPath } from '@/lib/game/content-files'
import { seedProgressStamp } from '@/services/translate/scheduler/seed-inventory'
import { attachSeedFailures, readSeedFailures, seedFailureFile, writeSeedFailure } from '@/services/translate/seed-failures'
import { idleSeedJob, seedJobFile, writeSeedJobState } from '@/services/translate/seed-job-state'

describe('seedProgressStamp', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-seed-stamp-'))
    mockDb = path.join(dir, 'cache.sqlite')
    fs.mkdirSync(path.dirname(gameContentPath(dir, 'seed')), { recursive: true })
    fs.writeFileSync(gameContentPath(dir, 'seed'), JSON.stringify({ こんにちは: '' }))
    fs.writeFileSync(gameContentPath(dir, 'cacheNdjson'), '')
  })
  afterEach(() => {
    fs.rmSync(seedFailureFile(dir), { force: true })
    fs.rmSync(seedJobFile(dir), { force: true })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('invalidates inventory on terminal failure and explicit clear, without reacting to job polling checkpoints', () => {
    const before = seedProgressStamp(dir)
    writeSeedFailure(dir, 'こんにちは', 'No valid translation returned')
    const failedStamp = seedProgressStamp(dir)
    expect(failedStamp).not.toBe(before)
    writeSeedJobState({ ...idleSeedJob(dir), updatedAt: Date.now(), rounds: 12 })
    expect(seedProgressStamp(dir)).toBe(failedStamp)
    writeSeedFailure(dir, 'こんにちは', null)
    expect(seedProgressStamp(dir)).not.toBe(failedStamp)
  })

  it('migrates legacy failures, honors clears across restarts, and isolates games and languages', () => {
    writeSeedJobState({ ...idleSeedJob(dir), failedSources: ['こんにちは'] })
    expect(readSeedFailures(dir).has('こんにちは')).toBe(true)
    expect(readSeedFailures(`${dir}/another-game`).has('こんにちは')).toBe(false)
    expect(attachSeedFailures(dir, [{ src: 'こんにちは' }], 'fr')[0].translationFailure).toBeUndefined()
    expect(attachSeedFailures(dir, [{ src: 'こんにちは' }], 'zh')[0].translationFailure).toBeDefined()
    writeSeedFailure(dir, 'こんにちは', null)
    expect(readSeedFailures(dir).has('こんにちは')).toBe(false)
    writeSeedFailure(dir, 'こんにちは', 'Failed again')
    expect(readSeedFailures(dir).get('こんにちは')).toBe('Failed again')
  })

  it('stays stable when only the shared SQLite WAL mtime changes', () => {
    const before = seedProgressStamp(dir)
    if (TRANSLATE_CACHE_DB_PATH) {
      const wal = `${TRANSLATE_CACHE_DB_PATH}-wal`
      fs.mkdirSync(path.dirname(wal), { recursive: true })
      fs.writeFileSync(wal, `wal-${Date.now()}`)
      try {
        fs.utimesSync(wal, new Date(), new Date(Date.now() + 60_000))
      } catch {
        /* Windows may refuse utimes on some volumes. */
      }
    }
    expect(seedProgressStamp(dir)).toBe(before)
  })

  it('changes when the game cache.ndjson changes', () => {
    const before = seedProgressStamp(dir)
    fs.writeFileSync(gameContentPath(dir, 'cacheNdjson'), `${JSON.stringify({ s: 'こんにちは', t: '你好' })}\n`)
    expect(seedProgressStamp(dir)).not.toBe(before)
  })
})
