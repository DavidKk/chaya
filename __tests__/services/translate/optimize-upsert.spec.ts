jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('wordguard', () => ({
  wordguard: () => ({
    matchAll: () => [],
  }),
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openSharedCache, resetSharedCacheScrubGuardForTests } from '@/services/translate/shared-cache'

describe('shared-cache upsertOptimizeMany', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    resetSharedCacheScrubGuardForTests()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-opt-'))
    dbPath = path.join(dir, 't.sqlite')
  })

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* */
    }
  })

  it('appends new candidates, selects authoritative translations, and keeps 原文=译文 out of shared', () => {
    const cache = openSharedCache(dbPath)
    expect(cache.upsertMany([['好感度', '好感度']], 'import')).toBe(0)
    cache.upsertMany([['レオン', '雷欧']], 'import')

    const stats = cache.upsertOptimizeMany(
      [
        ['好感度', '好感度'],
        ['レオン', '里昂'],
        ['短い台詞', '短台词'],
      ],
      'manual:optimize',
      { from: 'ja', to: 'zh' }
    )

    expect(stats).toMatchObject({ inserted: 2, identical: 0, conflict: 0, total: 3 })
    expect(stats.localOnly).toEqual([['好感度', '好感度']])
    expect(cache.get('好感度', { from: 'ja', to: 'zh' })).toBeNull()
    expect(cache.get('レオン', { from: 'ja', to: 'zh' })).toBe('雷欧')
    expect(cache.get('短い台詞', { from: 'ja', to: 'zh' })).toBe('短台词')
    cache.close()
  })
})
