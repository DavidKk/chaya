jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { applyCacheRow, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { openSharedCache } from '@/services/translate/shared-cache'

const pair = { from: 'en' as const, to: 'zh' as const }
const src = 'Yeah. I can do 22 pushups in a row now.'
const tail = 'I can do 22 pushups in a row now.'
const zh = '是的。 我现在可以连续做22个俯卧撑。'

describe('durable game sentence projections', () => {
  let dir: string, root: string, cache: ReturnType<typeof openSharedCache>
  function append(row: CacheRow) {
    fs.appendFileSync(gameContentPath(root, 'cacheNdjson'), JSON.stringify(row) + '\n')
  }
  function rows() {
    const result = new Map<string, CacheRow>()
    for (const line of fs.readFileSync(gameContentPath(root, 'cacheNdjson'), 'utf8').split('\n')) {
      if (!line) continue
      const row = parseCacheRow(JSON.parse(line))
      if (row) applyCacheRow(result, row)
    }
    return result
  }
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-projections-'))
    root = path.join(dir, 'game')
    const seed = gameContentPath(root, 'seed')
    fs.mkdirSync(path.dirname(seed), { recursive: true })
    fs.writeFileSync(seed, JSON.stringify({ [src]: '', [`\\C[1]${src}\\C[0]`]: '' }))
    cache = openSharedCache(path.join(dir, 'shared.sqlite'))
    cache.writeMany(
      [
        ['Yeah.', '是的。'],
        [tail, '我现在可以连续做22个俯卧撑。'],
      ],
      'import',
      pair
    )
  })
  afterEach(() => {
    cache.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('repairs old completed items, persists controls, survives reopen, and never becomes authority', () => {
    cache.syncGameCache(root)
    expect(rows().get(src)).toMatchObject({ t: zh, engine: 'derived:sentence' })
    expect(rows().get(`\\C[1]${src}\\C[0]`)?.t).toMatch(/^\\C\[1\]是的[。.] 我现在可以连续做22个俯卧撑[。.]\\C\[0\]$/)
    expect(loadGameTranslationRecords(root).some((record) => record.src === src)).toBe(false)
    expect(cache.record(src, pair)).toBeNull()
    const before = fs.readFileSync(gameContentPath(root, 'cacheNdjson'), 'utf8')
    cache.close()
    cache = openSharedCache(path.join(dir, 'shared.sqlite'))
    cache.syncGameCache(root)
    expect(fs.readFileSync(gameContentPath(root, 'cacheNdjson'), 'utf8')).toBe(before)
    cache.update(tail, '我能连续做二十二个俯卧撑了。', 'manual', pair)
    cache.flushBackfill(root)
    expect(rows().get(src)?.t).toBe('是的。 我能连续做二十二个俯卧撑了。')
    cache.remove(tail, pair)
    cache.flushBackfill(root)
    expect(rows().has(src)).toBe(false)
  })
  it('honors local atom changes, whole manual values and local deletions', () => {
    cache.syncGameCache(root)
    append({ s: 'Yeah.', t: '没错。', engine: 'manual' })
    cache.flushBackfill(root)
    expect(rows().get(src)?.t).toBe('没错。 我现在可以连续做22个俯卧撑。')
    append({ s: src, t: '人工整句', engine: 'manual' })
    cache.update('Yeah.', '对。', 'manual', pair)
    cache.flushBackfill(root)
    expect(rows().get(src)?.t).toBe('人工整句')
    append({ s: src, t: null, engine: 'manual' })
    cache.update(tail, '新的尾句。', 'manual', pair)
    cache.flushBackfill(root)
    expect(rows().has(src)).toBe(false)
  })
  it('skips unchanged seed scans and repairs newly extracted sources and corpus edits', () => {
    cache.syncGameCache(root)
    const read = jest.spyOn(fs, 'readFileSync')
    try {
      cache.syncGameCache(root)
      expect(read.mock.calls.some(([file]) => file === gameContentPath(root, 'seed'))).toBe(false)
      const extra = 'Yeah. Yeah.'
      fs.writeFileSync(gameContentPath(root, 'seed'), JSON.stringify({ [src]: '', [extra]: '' }))
      cache.syncGameCache(root)
      expect(read.mock.calls.some(([file]) => file === gameContentPath(root, 'seed'))).toBe(true)
      expect(rows().get(extra)?.t).toBe('是的。 是的。')
      cache.update('Yeah.', '没错。', 'manual', pair)
      cache.syncGameCache(root)
      expect(rows().get(extra)?.t).toBe('没错。 没错。')
    } finally {
      read.mockRestore()
    }
  })
  it('replaces a projection when an exact translation is added and falls back after its removal', () => {
    cache.syncGameCache(root)
    const written = cache.writeMany([[src, '整句优先。']], 'manual', pair)
    cache.queueBackfill(root, written.records)
    cache.flushBackfill(root)
    expect(rows().get(src)?.t).toBe('整句优先。')
    cache.remove(src, pair)
    cache.flushBackfill(root)
    expect(rows().get(src)?.t).toBe(zh)
  })
  it('retries an append failure rather than acknowledging an unwritten projection', () => {
    cache.queueGameProjections(root, [{ src, pair }])
    const append = jest.spyOn(fs, 'appendFileSync').mockImplementationOnce(() => {
      throw new Error('disk unavailable')
    })
    expect(() => cache.flushBackfill(root)).toThrow('disk unavailable')
    append.mockRestore()
    cache.flushBackfill(root)
    expect(rows().get(src)?.t).toBe(zh)
  })
})
