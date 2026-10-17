jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openSharedCache } from '@/services/translate/shared-cache'

const pair = { from: 'en' as const, to: 'zh' as const }
describe('persistent sentence cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-sentences-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('preserves raw records and mappings across reopen, invalidating old revisions', () => {
    const file = path.join(dir, 'shared.sqlite')
    let cache = openSharedCache(file)
    cache.writeMany([['a,b,c', '甲，乙，丙']], 'import', pair)
    expect(cache.get('b,c', pair)).toBeNull()
    expect(cache.plan('b,c', pair).status).toBe('miss')
    expect(cache.setAlignment('a,b,c', pair, [{ sourceStart: 2, sourceEnd: 5, targetStart: 2, targetEnd: 5, evidence: 'verified' }])).toBe(true)
    const plan = cache.plan('b,c', pair)
    expect(plan.zh).toBe('乙，丙')
    cache.close()
    cache = openSharedCache(file)
    expect(cache.plan('b,c', pair).zh).toBe('乙，丙')
    cache.update('a,b,c', '新的完整译文', 'manual', pair)
    expect(cache.current(plan.matches.map((m) => m.record))).toBe(false)
    expect(cache.plan('b,c', pair).status).toBe('miss')
    expect(cache.get('a,b,c', pair)).toBe('新的完整译文')
    cache.close()
  })
  it('human optimize confirmation builds extraction mappings without inserting child records', () => {
    const cache = openSharedCache(path.join(dir, 'cache.sqlite'))
    cache.writeMany([['a,b,c,d', '甲，乙，丙，丁']], 'import', pair)
    expect(
      cache.confirmSegments(
        { src: 'a,b,c,d', zh: '甲，乙，丙，丁' },
        [
          ['b', '乙'],
          ['c', '丙'],
        ],
        pair
      )
    ).toMatchObject({ inserted: 2, stale: false })
    expect(cache.stats().entries).toBe(1)
    expect(cache.plan('b,c', pair).zh).toBe('乙，丙')
    expect(cache.plan('b', pair).zh).toBe('乙')
    expect(cache.confirmSegments({ src: 'a,b,c,d', zh: '旧译文' }, [['b', '乙']], pair).stale).toBe(true)
    cache.close()
  })
  it('migrates legacy match_keys without kind column on open', () => {
    const file = path.join(dir, 'legacy-kind.sqlite')
    const raw = new DatabaseSync(file)
    raw.exec(`
      CREATE TABLE cache_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE translations (
        src TEXT NOT NULL, zh TEXT NOT NULL, src_lang TEXT NOT NULL DEFAULT 'ja', tgt_lang TEXT NOT NULL DEFAULT 'zh',
        engine TEXT, updated_at INTEGER NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0, nsfw INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (src, src_lang, tgt_lang)
      );
      CREATE TABLE translation_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        UNIQUE(src, src_lang, tgt_lang)
      );
      CREATE TABLE match_keys (
        record_id INTEGER NOT NULL, match_key TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL,
        PRIMARY KEY(record_id, match_key)
      );
      INSERT INTO translations VALUES ('hello', '你好', 'en', 'zh', 'import', 1, 0, 0);
      INSERT INTO translation_records(src, src_lang, tgt_lang) VALUES ('hello', 'en', 'zh');
      INSERT INTO match_keys VALUES (1, 'hello', 'en', 'zh');
      CREATE TRIGGER match_record_delete AFTER DELETE ON translation_records BEGIN
        DELETE FROM match_keys WHERE record_id=OLD.id;
      END;
      CREATE TRIGGER match_record_insert AFTER INSERT ON translation_records BEGIN
        INSERT INTO match_keys VALUES (NEW.id, NEW.src, NEW.src_lang, NEW.tgt_lang);
      END;
      INSERT INTO cache_meta VALUES ('sentence_index_v1', '1');
    `)
    raw.close()
    const cache = openSharedCache(file)
    expect(cache.get('hello', pair)).toBe('你好')
    expect(cache.plan('hello', pair).zh).toBe('你好')
    cache.close()
    const check = new DatabaseSync(file)
    const cols = check.prepare('PRAGMA table_info(match_keys)').all() as Array<{ name: string }>
    expect(cols.some((c) => c.name === 'kind')).toBe(true)
    check.close()
  })

  it('persists soft newline annotations and matches continuous queries', () => {
    const cache = openSharedCache(path.join(dir, 'cache.sqlite'))
    const ja = { from: 'ja' as const, to: 'zh' as const }
    const wrapped = '好きじゃ\n　ないんスよ'
    const continuous = '好きじゃないんスよ'
    const nl = wrapped.indexOf('\n')
    cache.writeMany([[wrapped, '其实不太喜欢啊']], 'import', ja)
    const dry = cache.confirmSegments({ src: wrapped, zh: '其实不太喜欢啊' }, [], ja, {
      dryRun: true,
      newlines: [{ start: nl, end: nl + 1, kind: 'soft' }],
    })
    expect(dry).toMatchObject({ dryRun: true, stale: false })
    expect(
      cache.confirmSegments({ src: wrapped, zh: '其实不太喜欢啊' }, [], ja, {
        newlines: [{ start: nl, end: nl + 1, kind: 'soft' }],
      })
    ).toMatchObject({ stale: false })
    expect(cache.record(wrapped, ja)?.newlines).toEqual([{ start: nl, end: nl + 1, kind: 'soft' }])
    expect(cache.plan(continuous, ja).zh).toBe('其实不太喜欢啊')
    expect(cache.confirmSegments({ src: wrapped, zh: '其实不太喜欢啊' }, [['好きじゃ', '喜欢']], ja, { expectedRevision: 1 }).stale).toBe(true)
    cache.close()
  })
  it('does not expose unfinished legacy translations through the new index', () => {
    const file = path.join(dir, 'legacy.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE translations(src TEXT PRIMARY KEY NOT NULL,zh TEXT NOT NULL,engine TEXT,updated_at INTEGER NOT NULL,hit_count INTEGER NOT NULL DEFAULT 0)')
    db.prepare('INSERT INTO translations(src,zh,engine,updated_at) VALUES(?,?,?,?)').run('村へ行く,待って', '去村子吧,待って', 'import', 1)
    db.close()
    const cache = openSharedCache(file)
    expect(cache.plan('村へ行く,待って', { from: 'ja', to: 'zh' }).status).toBe('miss')
    cache.close()
  })
  it('rejects lower authority writes including punctuation variants', () => {
    const cache = openSharedCache(path.join(dir, 'cache.sqlite'))
    cache.writeMany([['あん？', '人工译文']], 'manual')
    expect(cache.writeMany([['あん?', '机器译文']], 'live:google').rejected).toEqual([{ src: 'あん?', reason: 'rank' }])
    expect(cache.get('あん?')).toBe('人工译文')
    expect(cache.writeMany([['あん？', '导入译文']], 'import:x').accepted).toEqual([])
    cache.close()
  })
  it('uses explicit language pairs and does not erase spaces or infer alignment', () => {
    const cache = openSharedCache(path.join(dir, 'cache.sqlite'))
    cache.writeMany(
      [
        ['hello world', '你好世界'],
        ['a,b,c', '甲，乙，丙'],
      ],
      'import',
      pair
    )
    expect(cache.get('hello world')).toBeNull()
    expect(cache.get('hello world', pair)).toBe('你好世界')
    expect(cache.plan('helloworld', pair).status).toBe('miss')
    expect(cache.plan('b,c', pair).status).toBe('miss')
    expect(cache.plan('x,a,b,c', pair).matches.map((m) => m.text)).toEqual(['甲，乙，丙'])
    cache.close()
  })
})
