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

import { lookupCachedTranslation, translationLookupKeys } from '@/services/translate/cache-lookup'
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

  it('rejects 原文=译文 labels from shared import/upsert (they belong in per-game ndjson)', () => {
    const cache = openSharedCache(dbPath)
    const labels = { 第1部: '第1部', 第2部: '第2部', 第3部: '第3部' }
    expect(cache.importIgnoreExisting(labels).inserted).toBe(0)
    expect(cache.loadAll()).toEqual({})
    expect(cache.upsertMany([['第4部', '第4部']], 'live:ollama')).toBe(0)
    expect(cache.upsertMany([['第4部', '第4部']], 'import')).toBe(0)
    expect(cache.get('第1部')).toBeNull()
    cache.upsertMany([['村へ行く', '前往村庄']], 'import')
    expect(cache.scrubDirty().removed).toBe(0)
    expect(cache.get('村へ行く')).toBe('前往村庄')
    cache.close()
  })

  it('scrubs legacy identical label rows even when engine was import', () => {
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE translations (
        src TEXT NOT NULL,
        zh TEXT NOT NULL,
        src_lang TEXT NOT NULL DEFAULT 'ja',
        tgt_lang TEXT NOT NULL DEFAULT 'zh',
        engine TEXT,
        updated_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        nsfw INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (src, src_lang, tgt_lang)
      );
    `)
    const now = Date.now()
    const ins = db.prepare('INSERT INTO translations (src, zh, src_lang, tgt_lang, engine, updated_at, hit_count, nsfw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    ins.run('好感度', '好感度', 'ja', 'zh', 'import:labels', now, 0, 0)
    // Quote-noise identical after normalizeTranslateKey
    ins.run('"ラベル"', 'ラベル', 'ja', 'zh', 'import:noise', now, 0, 0)
    db.close()
    resetSharedCacheScrubGuardForTests()
    const cache = openSharedCache(dbPath)
    expect(cache.get('好感度')).toBeNull()
    expect(cache.get('"ラベル"')).toBeNull()
    expect(cache.get('ラベル')).toBeNull()
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

  it('supports manual NSFW mark without changing text', () => {
    const cache = openSharedCache(dbPath)
    cache.upsertMany([['村へ行く', '前往村庄']], 'live:google')
    expect(cache.listPage({ page: 1, pageSize: 10 }).items[0]?.nsfw).toBe(false)
    expect(cache.setNsfw('村へ行く', true)).toBe(true)
    expect(cache.get('村へ行く')).toBe('前往村庄')
    expect(cache.listPage({ page: 1, pageSize: 10 }).items[0]?.nsfw).toBe(true)
    expect(cache.update('村へ行く', '去村子', 'manual', undefined, { nsfw: false })).toBe(true)
    expect(cache.listPage({ page: 1, pageSize: 10 }).items[0]).toMatchObject({ zh: '去村子', nsfw: false })
    // Auto upsert must not clear a manual NSFW mark.
    expect(cache.setNsfw('村へ行く', true)).toBe(true)
    cache.upsertMany([['村へ行く', '前往村庄']], 'live:google')
    expect(cache.listPage({ page: 1, pageSize: 10 }).items[0]?.nsfw).toBe(true)
    expect(cache.setNsfw('missing', true)).toBe(false)
    cache.close()
  })

  it('keeps unknown whitespace distinct and exact values up to date', () => {
    const cache = openSharedCache(dbPath)
    cache.upsertMany([['来店\n　する', '进店\n　购物']], 'manual')
    expect(cache.get('来店する')).toBeNull()
    expect(cache.getMany(['来 店する']).has('来 店する')).toBe(false)
    cache.upsertMany([['来 店する', '走进店铺']], 'manual')
    expect(cache.get('来 店する')).toBe('走进店铺')
    cache.remove('来 店する')
    expect(cache.get('来店する')).toBeNull()
    cache.close()
  })

  it('resolves safe condition aliases explicitly without inferring paragraph mappings', () => {
    const cache = openSharedCache(dbPath)
    cache.upsertMany(
      [
        ['en(!s[671])様子を観察する', 'en(!s[671])暗中观察'],
        ['こんにちは，村へ行こう。', '你好，去村子吧。'],
      ],
      'manual'
    )
    expect(cache.get('様子を観察する')).toBeNull()
    expect(cache.plan('様子を観察する', { from: 'ja', to: 'zh' }).zh).toBe('暗中观察')
    expect(cache.plan('村へ行こう！', { from: 'ja', to: 'zh' }).zh).toBeNull()
    cache.remove('en(!s[671])様子を観察する')
    expect(cache.plan('様子を観察する', { from: 'ja', to: 'zh' }).zh).toBeNull()
    cache.close()
  })

  it('indexes explicit numbered prefixes but does not infer punctuation alignment', () => {
    const cache = openSharedCache(dbPath)
    cache.importIgnoreExisting({ M06_サブイベ1: 'M06_支线事件1', '受付係の！マーク消去': '接待员！标记消除' })
    expect(cache.plan('サブイベ1', { from: 'ja', to: 'zh' }).zh).toBe('支线事件1')
    expect(cache.plan('受付係の！', { from: 'ja', to: 'zh' }).zh).toBeNull()
    expect(cache.get('M06_サブイベ1')).toBe('M06_支线事件1')
    cache.remove('M06_サブイベ1')
    expect(cache.plan('サブイベ1', { from: 'ja', to: 'zh' }).zh).toBeNull()
    cache.close()
  })

  it('never treats erased boundaries or a changed tone as whole-body equivalence', () => {
    const cache = openSharedCache(dbPath)
    cache.importIgnoreExisting({ 'こんにちは，村へ行こう。': '你好，去村子吧。', 休もう: '休息吧', 準備を確認する: '确认准备情况' })
    for (const source of ['「こんにちは\n村へ行こう！」', '「休もう、\n準備を確認する！」']) expect(cache.plan(source, { from: 'ja', to: 'zh' }).zh).toBeNull()
    cache.close()
  })

  it('retrieves display-separated candidate keys before reconstructing a complete translation', () => {
    const cache = openSharedCache(dbPath)
    cache.importIgnoreExisting({ 聖騎士団: '圣骑士团', 'へ行こう。': '去那里吧。', 王国軍: '王国军', を見よう: '看看吧' })
    const source = '「\\C[9]聖騎士団\\C[0]へ行こう。\n\\C[20]王国軍\\C[0]を見よう」'
    const rows = cache.getMany(translationLookupKeys(source))
    expect(lookupCachedTranslation((key) => rows.get(key), source)).toBe('「\\C[9]圣骑士团\\C[0]去那里吧。\n\\C[20]王国军\\C[0]看看吧」')
    cache.close()
  })

  it('assembles imported visual lines through the batched shared-cache path', () => {
    const cache = openSharedCache(dbPath)
    cache.upsertMany(
      [
        ['「セリカ様、', '「赛莉卡大人，'],
        ['カウンター内は従業員以外立ち入り禁止ですよ」', '柜台后方禁止非工作人员进入哦」'],
      ],
      'manual'
    )
    const source = '「セリカ様、\nカウンター内は従業員以外立ち入り禁止ですよ」'
    const rows = cache.getMany(translationLookupKeys(source))
    expect(rows.get('セリカ様')).toBeUndefined()
    expect(lookupCachedTranslation((key) => rows.get(key), source)).toBeNull()
    cache.close()
  })

  it('keeps original paragraphs and requires verified mappings for isolated lines', () => {
    const cache = openSharedCache(dbPath)
    const source = '「ほう、よくわかったな。\n　お前の想像通り、これは催眠魔法でな。」'
    const target = '「嚯，挺敏锐嘛。\n正如你所想，这是催眠魔法。」'
    cache.importIgnoreExisting({ [source]: target })
    expect(cache.get(source)).toBe(target)
    expect(cache.get(source.replace(/\u3000/g, ''))).toBeNull()
    expect(cache.plan('お前の想像通り、これは催眠魔法でな。', { from: 'ja', to: 'zh' }).zh).toBeNull()
    cache.close()
  })

  it('observes versioned exact writes from another connection without whitespace erasure', () => {
    const cache = openSharedCache(dbPath),
      writer = openSharedCache(dbPath)
    writer.upsertMany([['来 店する', '走进店铺']], 'manual')
    expect(cache.get('来店する')).toBeNull()
    expect(cache.get('来 店する')).toBe('走进店铺')
    writer.update('来 店する', '进入店铺')
    expect(cache.get('来 店する')).toBe('进入店铺')
    writer.remove('来 店する')
    expect(cache.get('来 店する')).toBeNull()
    writer.close()
    cache.close()
  })

  it('scrubs identical / skip rows while preserving raw control shells', () => {
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
    expect(cache.get('\\c[16]次のレベルまで')).toBe('\\c[16]更上一层楼')
    expect(cache.get('次のレベルまで')).toBeNull()
    expect(cache.get('\\C[0]ミレリア学園に通う三年生')).toBe('\\C[0]就读 Mireria 学院的三年级学生')
    expect(cache.get('ミレリア学園に通う三年生')).toBeNull()
    expect(cache.get('干净键')).toBe('\\c[16]只有译文带壳')
    cache.close()
  })

  it('returns the nearest legal page after the original last page is deleted', () => {
    const cache = openSharedCache(dbPath)
    cache.upsertMany(
      [
        ['項目一', '项目一'],
        ['項目二', '项目二'],
        ['項目三', '项目三'],
      ],
      'manual'
    )
    expect(cache.listPage({ page: 3, pageSize: 1 }).page).toBe(3)
    cache.remove('項目三')
    const nearest = cache.listPage({ page: 3, pageSize: 1 })
    expect(nearest.page).toBe(2)
    expect(nearest.totalPages).toBe(2)
    expect(nearest.items).toHaveLength(1)
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
    expect(all.engines).toEqual(['agent', 'bing'])
    const agents = cache.listPage({ page: 1, pageSize: 50, engine: 'agent' })
    expect(agents.items.map((item) => item.src)).toEqual(['タグ付き'])
    const imported = cache.listPage({ page: 1, pageSize: 50, engine: 'import' })
    expect(imported.total).toBe(0)
    cache.upsertMany([['导入文', '导入译文']], 'import:file')
    expect(cache.listPage({ live: 'stored' }).items.map((item) => item.src)).toEqual(['导入文'])
    expect(cache.listPage({ live: 'live' }).total).toBe(4)
    expect(cache.listPage({ nsfwFlag: 'safe' }).total).toBe(3)
    expect(cache.listPage({ nsfwFlag: 'safe', live: 'live' }).total).toBe(2)
    cache.close()
  })

  it('stores the same source under different language pairs', () => {
    const cache = openSharedCache(dbPath)
    expect(cache.upsertMany([['Hello', '你好']], 'import:en', { from: 'en', to: 'zh' })).toBe(1)
    expect(cache.upsertMany([['Hello', 'こんにちは']], 'import:ja', { from: 'en', to: 'ja' })).toBe(1)
    expect(cache.upsertMany([['こんにちは', '你好']], 'import:ja', { from: 'ja', to: 'zh' })).toBe(1)

    expect(cache.get('Hello', { from: 'en', to: 'zh' })).toBe('你好')
    expect(cache.get('Hello', { from: 'en', to: 'ja' })).toBe('こんにちは')
    expect(cache.get('こんにちは', { from: 'ja', to: 'zh' })).toBe('你好')
    expect(cache.get('Hello')).toBeNull()

    expect(cache.upsertMany([['你好', 'Hello']], 'import:zh', { from: 'zh', to: 'en' })).toBe(1)

    const enZh = cache.listPage({ from: 'en', to: 'zh' })
    expect(enZh.total).toBe(2)
    expect(enZh.items.map((item) => `${item.from}→${item.to}`).sort()).toEqual(['en→zh', 'zh→en'])
    // Swapped dropdowns still match the same unordered pair.
    expect(cache.listPage({ from: 'zh', to: 'en' }).total).toBe(2)
    expect(cache.listPage({ from: 'ja' }).total).toBe(1)
    expect(cache.listPage({ to: 'ja' }).items.map((item) => item.zh)).toEqual(['こんにちは'])
    cache.close()
  })
})
