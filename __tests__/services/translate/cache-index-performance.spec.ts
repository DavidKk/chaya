jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { gameContentPath } from '@/lib/game/content-files'
import { getGameCacheContext, noteGameSharedBackfill } from '@/services/translate/game-cache-context'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { openSharedCache } from '@/services/translate/shared-cache'
import { createMatchIndex } from '@/services/translate/shared-cache/match-index'

const pair = { from: 'en' as const, to: 'zh' as const }
describe('indexed cache query contract', () => {
  let dir: string, file: string, root: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-cache-index-'))
    file = path.join(dir, 'cache.sqlite')
    root = path.join(dir, 'game')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('uses indexed equality queries for punctuation, sentence candidates and numeric families', () => {
    const cache = openSharedCache(file)
    cache.writeMany(
      [
        ['Wait……!', '等一下……！'],
        ['Thunder5', '雷霆5'],
        ['Thunder10', '雷霆10'],
        ['Ice5', '冰5'],
      ],
      'manual',
      pair
    )
    const db = new DatabaseSync(file)
    const prepare = jest.spyOn(db, 'prepare')
    const index = createMatchIndex(db)
    expect(index.plan('Wait.........!', pair).zh).toBe('等一下……！')
    expect(index.equivalent('Wait......!', pair)[0].engine).toBe('manual')
    expect(
      index
        .numericRecords(pair, 'Thunder007')
        .map((r) => r.src)
        .sort()
    ).toEqual(['Thunder10', 'Thunder5'])
    expect(index.plan('Wait?', pair).zh).toBeNull()
    const queries = prepare.mock.calls.map(([sql]) => sql)
    expect(queries.every((sql) => !/\b(?:LIKE|GLOB)\b/i.test(sql))).toBe(true)
    for (const [table, indexName] of [
      ['match_keys', 'idx_match_key'],
      ['sentence_positions', 'idx_sentence_key'],
      ['numeric_label_keys', 'idx_numeric_family'],
    ]) {
      const query = queries.find((sql) => sql.includes(`JOIN ${table} `))!
      expect(query).toBeDefined()
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + query).all(...Array((query.match(/\?/g) || []).length).fill('en')) as Array<{ detail: string }>
      expect(plan.some((row) => row.detail.includes('SEARCH') && row.detail.includes(indexName))).toBe(true)
    }
    db.close()
    cache.close()
  })

  it('reuses local indexes through shared backfills, then refreshes external manual edits', () => {
    const seed = gameContentPath(root, 'seed')
    fs.mkdirSync(path.dirname(seed), { recursive: true })
    fs.writeFileSync(seed, JSON.stringify({ Hello: '本作问候' }))
    const cache = openSharedCache(file)
    const context = getGameCacheContext(root)
    const write = cache.writeMany([['Welcome', '欢迎']], 'live:apple', pair)
    cache.queueBackfill(root, write.records)
    cache.flushBackfill(root)
    expect(getGameCacheContext(root)).toBe(context)
    expect(context.records.map((r) => r.src)).toEqual(['Hello'])
    expect(cache.plan('Welcome', pair, context.resolver.select('Welcome')).zh).toBe('欢迎')
    const reads = jest.spyOn(fs, 'readFileSync')
    cache.flushBackfill(root)
    expect(reads).not.toHaveBeenCalled()
    reads.mockRestore()

    // A changed SQLite revision is checked even while parsed game files are cached.
    cache.update('Welcome', '共享修订', 'manual', pair)
    expect(loadGameTranslationRecords(root, (origin) => origin.database === cache.path && cache.current([{ ...origin, src: '', zh: '' }])).map((r) => r.src)).toEqual(['Hello'])
    cache.flushBackfill(root)
    expect(getGameCacheContext(root)).toBe(context)
    expect(cache.plan('Welcome', pair, context.resolver.select('Welcome')).zh).toBe('共享修订')

    fs.appendFileSync(gameContentPath(root, 'cacheNdjson'), JSON.stringify({ s: 'Welcome', t: '本作人工', engine: 'manual' }) + '\n')
    const edited = getGameCacheContext(root)
    expect(edited).not.toBe(context)
    expect(cache.plan('Welcome', pair, edited.resolver.select('Welcome')).zh).toBe('本作人工')
    cache.remove('Welcome', pair)
    cache.flushBackfill(root)
    expect(getGameCacheContext(root).resolver.plan('Welcome').zh).toBe('本作人工')
    cache.close()
  })

  it('invalidates snapshots after replacing seed files and does not restore deleted shared mirrors', () => {
    const cache = openSharedCache(file)
    const write = cache.writeMany([['Welcome', '欢迎']], 'import', pair)
    cache.queueBackfill(root, write.records)
    cache.flushBackfill(root)
    expect(getGameCacheContext(root).records).toHaveLength(0)
    cache.remove('Welcome', pair)
    cache.flushBackfill(root)
    expect(cache.plan('Welcome', pair, getGameCacheContext(root).resolver.select('Welcome')).zh).toBeNull()
    const seed = gameContentPath(root, 'seed')
    fs.writeFileSync(seed, JSON.stringify({ Hello: '你好' }))
    const first = getGameCacheContext(root)
    const replacement = seed + '.replacement'
    fs.writeFileSync(replacement, JSON.stringify({ Hello: '您好' }))
    fs.renameSync(replacement, seed)
    noteGameSharedBackfill(root, first.stamp)
    expect(getGameCacheContext(root).resolver.plan('Hello').zh).toBe('您好')
    expect(getGameCacheContext(root)).not.toBe(first)
    cache.close()
  })
})
