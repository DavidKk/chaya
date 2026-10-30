jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openSharedCache } from '@/services/translate/shared-cache'

const pair = { from: 'en', to: 'zh' }

describe('append-only translation candidates', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-candidates-'))
    file = path.join(dir, 'shared.sqlite')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('preserves legacy row ids, origin revisions, annotations and sequence high-water marks', () => {
    const legacy = new DatabaseSync(file)
    legacy.exec(`
      CREATE TABLE cache_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO cache_meta VALUES ('sentence_index_v1','1'),('lang_pair_tgt_zh','1'),('nsfw_backfill','1');
      CREATE TABLE translations(
        src TEXT NOT NULL, zh TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL,
        engine TEXT, category TEXT, updated_at INTEGER NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0,
        nsfw INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(src,src_lang,tgt_lang)
      );
      INSERT INTO translations(rowid,src,zh,src_lang,tgt_lang,engine,category,updated_at,hit_count,nsfw)
        VALUES(43,'a,b,c','甲，乙，丙','en','zh','import','dialogue',1234,8,1);
      CREATE TABLE translation_records(
        id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT NOT NULL, src_lang TEXT NOT NULL,
        tgt_lang TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, UNIQUE(src,src_lang,tgt_lang)
      );
      INSERT INTO translation_records VALUES (7,'a,b,c','en','zh',3);
      INSERT INTO translation_records VALUES (200,'deleted','en','zh',1);
      DELETE FROM translation_records WHERE id=200;
      CREATE TABLE alignment_groups(record_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, groups_json TEXT NOT NULL);
      INSERT INTO alignment_groups VALUES (7,3,'[{"sourceStart":2,"sourceEnd":5,"targetStart":2,"targetEnd":5,"evidence":"verified"}]');
      CREATE TABLE game_backfills(root TEXT NOT NULL,src TEXT NOT NULL,record_id INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(root,src));
      INSERT INTO game_backfills VALUES ('/game','a,b,c',7,3);
    `)
    legacy.close()
    let cache = openSharedCache(file)
    try {
      expect(cache.getById(43)).toMatchObject({ src: 'a,b,c', zh: '甲，乙，丙', nsfw: true, hitCount: 8 })
      expect(cache.record('a,b,c', pair)).toMatchObject({ id: '7', candidateId: 43, revision: 3, alignments: [expect.objectContaining({ sourceStart: 2 })] })
      expect(cache.plan('b,c', pair).zh).toBe('乙，丙')
      const appended = cache.writeMany([['other', '其他']], 'live:apple', pair).records[0]
      expect(Number(appended.id)).toBeGreaterThan(200)
      expect(appended.candidateId).toBeGreaterThan(43)
    } finally {
      cache.close()
    }
    cache = openSharedCache(file)
    expect(cache.getById(43)?.zh).toBe('甲，乙，丙')
    cache.close()
    const raw = new DatabaseSync(file)
    try {
      expect(raw.prepare('SELECT record_id,revision FROM game_backfills').get()).toMatchObject({ record_id: 7, revision: 3 })
      const plan = raw
        .prepare('EXPLAIN QUERY PLAN SELECT id FROM translations WHERE src=? AND src_lang=? AND tgt_lang=? ORDER BY engine_rank DESC,updated_at DESC,id DESC LIMIT 1')
        .all('other', 'en', 'zh')
      expect(JSON.stringify(plan)).toContain('idx_translation_selection')
      expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE')
    } finally {
      raw.close()
    }
  })

  it('appends lower-priority alternatives and falls back after deleting the selected candidate', () => {
    const cache = openSharedCache(file)
    try {
      const human = cache.writeMany([['Hello', '人工定稿']], 'manual', pair).records[0]
      const machine = cache.writeMany([['Hello', '机器结果']], 'live:apple', pair).records[0]
      expect(cache.stats().entries).toBe(2)
      expect(cache.get('Hello', pair)).toBe('人工定稿')
      expect(cache.current([human])).toBe(true)
      expect(cache.current([machine])).toBe(false)
      expect(cache.remove('Hello', pair, human.candidateId)).toBe(true)
      expect(cache.getById(machine.candidateId)?.zh).toBe('机器结果')
      expect(cache.get('Hello', pair)).toBe('机器结果')
      expect(cache.current([human])).toBe(false)
      expect(cache.current([machine])).toBe(true)
    } finally {
      cache.close()
    }
  })

  it('isolates NSFW changes and segment annotations by candidate id', () => {
    const cache = openSharedCache(file)
    try {
      const first = cache.writeMany([['a,b,c', '甲，乙，丙']], 'import', pair).records[0]
      const second = cache.writeMany([['a,b,c', '一，二，三']], 'import', pair).records[0]
      expect(cache.setNsfw('a,b,c', true, pair, first.candidateId)).toBe(true)
      expect(cache.getById(first.candidateId)?.nsfw).toBe(true)
      expect(cache.getById(second.candidateId)?.nsfw).toBe(false)
      expect(
        cache.setAlignment('a,b,c', pair, [{ sourceStart: 2, sourceEnd: 5, targetStart: 2, targetEnd: 5, evidence: 'verified' }], first.revision, {
          candidateId: first.candidateId,
        })
      ).toBe(true)
      expect(cache.candidateRecord(first.candidateId)?.revision).toBe(first.revision + 1)
      expect(cache.candidateRecord(second.candidateId)?.revision).toBe(second.revision)
      expect(cache.candidateRecord(second.candidateId)?.alignments).toBeUndefined()
      expect(cache.setNsfw('wrong source', true, pair, first.candidateId)).toBe(false)
      expect(cache.remove('a,b,c', { from: 'ja', to: 'zh' }, first.candidateId)).toBe(false)
    } finally {
      cache.close()
    }
  })
})
