jest.mock('wordguard', () => ({
  wordguard: () => ({
    matchAll: (text: string) => {
      const hits: Array<{ word: string }> = []
      for (const w of ['レイプ', 'セックス', '強姦']) {
        if (String(text).includes(w)) hits.push({ word: w })
      }
      return hits
    },
  }),
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openSharedCache, resetSharedCacheScrubGuardForTests } from '@/services/translate/shared-cache'

describe('shared-cache identical skip + scrub', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    resetSharedCacheScrubGuardForTests()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-cache-'))
    dbPath = path.join(dir, 't.sqlite')
  })

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* */
    }
  })

  it('does not upsert when src === zh', () => {
    const cache = openSharedCache(dbPath)
    const n = cache.upsertMany(
      [
        ['値', '値'],
        ['現', '現'],
        ['次のレベルまで', '更上一层楼'],
      ],
      'skip:control'
    )
    expect(n).toBe(1)
    expect(cache.get('値')).toBeNull()
    expect(cache.get('現')).toBeNull()
    expect(cache.get('次のレベルまで')).toBe('更上一层楼')
    cache.close()
  })

  it('rejects partially untranslated rows from both automatic and imported writes', () => {
    const cache = openSharedCache(dbPath)
    expect(
      cache.upsertMany(
        [
          ['こんにちは', '你好、こんにちは'],
          ['村へ行く', '前往村庄'],
        ],
        'live:ollama'
      )
    ).toBe(1)
    expect(cache.importIgnoreExisting({ 次の場所: '下一个ばしょ', 次の村: '下一个村庄' })).toMatchObject({ inserted: 1 })
    expect(cache.get('こんにちは')).toBeNull()
    expect(cache.get('次の場所')).toBeNull()
    expect(cache.update('村へ行く', '前往村庄、です')).toBe(false)
    cache.close()
  })

  it('update and remove by src', () => {
    const cache = openSharedCache(dbPath)
    cache.upsertMany([['次のレベルまで', '更上一层楼']], 'live:google')
    expect(cache.update('次のレベルまで', '到下一级', 'manual')).toBe(true)
    expect(cache.get('次のレベルまで')).toBe('到下一级')
    expect(cache.update('次のレベルまで', '次のレベルまで', 'manual')).toBe(false)
    expect(cache.update('missing', 'x', 'manual')).toBe(false)
    expect(cache.remove('次のレベルまで')).toBe(true)
    expect(cache.get('次のレベルまで')).toBeNull()
    expect(cache.remove('次のレベルまで')).toBe(false)
    cache.close()
  })

  it('scrubs identical / skip engines / leading control shells on open', () => {
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE translations (
        src TEXT PRIMARY KEY NOT NULL,
        zh TEXT NOT NULL,
        engine TEXT,
        updated_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );
    `)
    const ins = db.prepare('INSERT INTO translations (src, zh, engine, updated_at, hit_count) VALUES (?, ?, ?, ?, ?)')
    const now = Date.now()
    ins.run('値', '値', 'skip:control', now, 0)
    ins.run('現', '現', 'skip:control', now, 0)
    ins.run('\\c[16]次のレベルまで', '\\c[16]更上一层楼', 'live:google', now, 2)
    ins.run('\\C[0]ミレリア学園に通う三年生', '\\C[0]就读 Mireria 学院的三年级学生', 'live:google', now, 1)
    ins.run('干净键', '\\c[16]只有译文带壳', 'live:google', now, 0)
    db.close()

    const cache = openSharedCache(dbPath)
    expect(cache.get('値')).toBeNull()
    expect(cache.get('現')).toBeNull()
    expect(cache.get('\\c[16]次のレベルまで')).toBeNull()
    expect(cache.get('次のレベルまで')).toBe('更上一层楼')
    expect(cache.get('\\C[0]ミレリア学園に通う三年生')).toBeNull()
    expect(cache.get('ミレリア学園に通う三年生')).toBe('就读 Mireria 学院的三年级学生')
    expect(cache.get('干净键')).toBe('只有译文带壳')
    cache.close()
  })

  it('listPage nsfw filter uses stored flag (engine tag + sensitive src)', () => {
    const cache = openSharedCache(dbPath)
    cache.upsertMany(
      [
        ['普通の会話です', '普通的对话'],
        ['セックスする', '做爱'],
        ['挨拶します', '打招呼'],
      ],
      'live:bing'
    )
    cache.upsertMany([['タグ付き', '带标签']], 'live:ollama:nsfw')

    const page = cache.listPage({ page: 1, pageSize: 50, nsfw: true, sort: 'updated', order: 'desc' })
    expect(page.nsfw).toBe(true)
    expect(page.total).toBe(2)
    const srcs = page.items.map((i) => i.src).sort()
    expect(srcs).toEqual(['セックスする', 'タグ付き'].sort())
    expect(page.items.every((i) => i.nsfw)).toBe(true)

    const all = cache.listPage({ page: 1, pageSize: 50 })
    expect(all.total).toBe(4)
    cache.close()
  })
})
