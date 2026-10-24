import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import { gameContentPath } from '@/lib/game/content-files'
import { seedProgressStamp } from '@/services/translate/scheduler/seed-inventory'

describe('seedProgressStamp', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-seed-stamp-'))
    fs.mkdirSync(path.dirname(gameContentPath(dir, 'seed')), { recursive: true })
    fs.writeFileSync(gameContentPath(dir, 'seed'), JSON.stringify({ こんにちは: '' }))
    fs.writeFileSync(gameContentPath(dir, 'cacheNdjson'), '')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

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
