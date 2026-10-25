jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { openSharedCache } from '@/services/translate/shared-cache'

const pair = { from: 'ja' as const, to: 'zh' as const }
describe('versioned game backfill', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-backfill-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
  it('refreshes or removes only the shared-owned value and preserves later manual edits', () => {
    const cache = openSharedCache(path.join(dir, 'shared.sqlite'))
    const root = path.join(dir, 'game')
    const result = cache.writeMany([['村へ行く', '前往村庄']], 'live:google', pair)
    cache.queueBackfill(root, result.records)
    cache.flushBackfill(root)
    expect(loadGameTranslationRecords(root)[0]).toMatchObject({ zh: '前往村庄', local: false })
    cache.update('村へ行く', '去村子', 'manual', pair)
    cache.flushBackfill(root)
    expect(loadGameTranslationRecords(root)[0].zh).toBe('去村子')
    fs.appendFileSync(gameContentPath(root, 'cacheNdjson'), JSON.stringify({ s: '村へ行く', t: '本作人工', engine: 'manual' }) + '\n')
    cache.remove('村へ行く', pair)
    cache.flushBackfill(root)
    expect(loadGameTranslationRecords(root)[0]).toMatchObject({ zh: '本作人工', engine: 'manual', local: true })
    cache.close()
  })
  it('recovers an incomplete final event and makes replay idempotent', () => {
    const cache = openSharedCache(path.join(dir, 'shared.sqlite'))
    const root = path.join(dir, 'game')
    const result = cache.writeMany([['村へ行く', '前往村庄']], 'import', pair)
    cache.flushBackfill(root)
    fs.mkdirSync(path.dirname(gameContentPath(root, 'cacheNdjson')), { recursive: true })
    fs.writeFileSync(gameContentPath(root, 'cacheNdjson'), '{"s":"半行')
    cache.queueBackfill(root, result.records)
    cache.flushBackfill(root)
    cache.flushBackfill(root)
    expect(loadGameTranslationRecords(root)).toHaveLength(1)
    const lines = fs.readFileSync(gameContentPath(root, 'cacheNdjson'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).origin.revision).toBe(1)
    cache.close()
  })

  it('deduplicates queued backfills for the same source and revision', () => {
    const cache = openSharedCache(path.join(dir, 'shared.sqlite'))
    const root = path.join(dir, 'game')
    const result = cache.writeMany([['村へ行く', '前往村庄']], 'live:google', pair)
    cache.queueBackfill(root, result.records)
    cache.queueBackfill(root, result.records)
    cache.flushBackfill(root)
    expect(loadGameTranslationRecords(root)).toHaveLength(1)
    const lines = fs.readFileSync(gameContentPath(root, 'cacheNdjson'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    cache.close()
  })

  it('reports an owned append only when the flush wrote exactly its shared mirror', () => {
    const cache = openSharedCache(path.join(dir, 'shared.sqlite'))
    const root = path.join(dir, 'game')
    const result = cache.writeMany([['村へ行く', '前往村庄']], 'live:google', pair)
    cache.queueBackfill(root, result.records)
    expect(cache.flushBackfill(root)).toEqual({ sharedOnly: true })
    expect(cache.flushBackfill(root)).toEqual({ sharedOnly: false })
    expect(cache.flushBackfill(root)).toEqual({ sharedOnly: false })

    const other = cache.writeMany([['宿へ戻る', '返回旅馆']], 'live:apple', pair)
    cache.queueBackfill(root, other.records)
    const append = fs.appendFileSync.bind(fs)
    const write = jest.spyOn(fs, 'appendFileSync').mockImplementationOnce((file, data, options) => {
      append(file, data, options)
      fs.writeFileSync(gameContentPath(root, 'seed'), JSON.stringify({ 村へ行く: '并发 seed 修改' }))
    })
    expect(cache.flushBackfill(root)).toEqual({ sharedOnly: false })
    expect(write).toHaveBeenCalled()
    write.mockRestore()
    cache.close()
  })
})
