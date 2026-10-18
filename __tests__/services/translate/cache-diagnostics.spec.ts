jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: jest.fn() }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { ensureGameContentDir } from '@/lib/game/content-files'
import { createSentenceResolver } from '@/lib/translate/sentence-plan'
import { getResolvedFromConfig } from '@/services/game/binding'
import { testTranslationCache } from '@/services/translate/cache-diagnostics'
import { openSharedCache } from '@/services/translate/shared-cache'
import { CacheIndexNotReadyError, withReadOnlyCache } from '@/services/translate/shared-cache/read-only'

let root: string, file: string
const pair = { from: 'en' as const, to: 'zh' as const }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-cache-test-'))
  file = path.join(root, 'shared.sqlite')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
it('queries the real planner without changing translations, counters, revisions or files', () => {
  const cache = openSharedCache(file)
  cache.writeMany(
    [
      ['Conditions', '条件'],
      ['Level 60', '等级60'],
      ['Finish quest', '完成委托'],
    ],
    'manual',
    pair
  )
  const snapshot = cache.listPage({ from: 'en', to: 'zh' })
  const version = cache.version()
  const result = testTranslationCache({ ...pair, text: 'Conditions: 1. Level 60 2. Finish quest', scope: 'shared' }, file)
  expect(result.plan).toMatchObject({ status: 'full', zh: '条件: 1. 等级60 2. 完成委托' })
  expect(cache.version()).toBe(version)
  expect(cache.listPage({ from: 'en', to: 'zh' })).toEqual(snapshot)
  expect(fs.existsSync(path.join(root, 'game'))).toBe(false)
  cache.close()
})
it('does not create a missing database or upgrade an old one', () => {
  expect(testTranslationCache({ ...pair, text: 'hello', scope: 'shared' }, file).plan.status).toBe('miss')
  expect(fs.existsSync(file)).toBe(false)
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE original(value TEXT)')
  db.close()
  const before = fs.readFileSync(file)
  expect(() => withReadOnlyCache(() => null, file)).toThrow(CacheIndexNotReadyError)
  expect(fs.readFileSync(file)).toEqual(before)
})
it('rejects game changes and unsupported game-cache language pairs', () => {
  jest.mocked(getResolvedFromConfig).mockReturnValue({ ok: false, config: { gameRoot: '', shellSource: '', library: [] }, error: '' })
  expect(() => testTranslationCache({ ...pair, text: 'hello', scope: 'game', gameId: 'old' }, file)).toThrow('当前游戏')
  expect(() => testTranslationCache({ ...pair, to: 'ja', text: 'hello', scope: 'combined' }, file)).toThrow('译入中文')
})
it('never exposes low-confidence suggestions as automatic cache matches', () => {
  const cache = openSharedCache(file)
  cache.writeMany(
    [
      ['A', '甲'],
      ['B', '乙'],
    ],
    'manual',
    pair
  )
  const result = testTranslationCache({ ...pair, text: 'i A ii B', scope: 'shared' }, file)
  expect(result.structure.units.every((u) => u.state === 'suggested')).toBe(true)
  expect(result.plan.status).not.toBe('full')
  expect(testTranslationCache({ ...pair, text: 'i A ii B', scope: 'shared', structure: { mode: 'accept' } }, file).plan.zh).toBe('i 甲 ii 乙')
  cache.close()
})
it('keeps mapping confirmation atomic and persists manual structure across reopen', () => {
  let cache = openSharedCache(file)
  const src = 'Items: i Apple ii Pear',
    zh = '材料：①苹果 ②梨'
  cache.writeMany([[src, zh]], 'manual', pair)
  const record = cache.record(src, pair)!
  const structure = { source: { mode: 'accept' as const }, target: { mode: 'accept' as const } }
  const rejected = cache.confirmSegments(
    { src, zh },
    [
      ['Apple', '苹果'],
      ['missing', '不存在'],
    ],
    pair,
    { structure }
  )
  expect(rejected).toMatchObject({ inserted: 0, conflict: 1 })
  expect(cache.record(src, pair)?.revision).toBe(record.revision)
  expect(
    cache.confirmSegments(
      { src, zh },
      [
        ['Apple', '苹果'],
        ['Pear', '梨'],
      ],
      pair,
      { structure, expectedRevision: record.revision }
    )
  ).toMatchObject({ inserted: 2, conflict: 0 })
  cache.close()
  cache = openSharedCache(file)
  expect(cache.record(src, pair)?.structure).toEqual(structure)
  expect(cache.plan('Apple', pair).zh).toBe('苹果')
  expect(cache.confirmSegments({ src, zh }, [], pair, { structure: { source: { mode: 'disabled' } }, replaceGroups: true })).toMatchObject({ conflict: 0, stale: false })
  expect(cache.record(src, pair)?.alignments).toEqual([])
  expect(cache.record(src, pair)?.structure).toEqual({ source: { mode: 'disabled' } })
  expect(cache.plan('Apple', pair).status).toBe('miss')
  cache.update(src, '整段修改', 'manual', pair)
  expect(cache.record(src, pair)?.structure).toBeUndefined()
  expect(cache.plan('Apple', pair).status).toBe('miss')
  cache.close()
})

it('reuses an entire punctuated item consistently in SQLite and the plugin resolver', () => {
  const cache = openSharedCache(file)
  cache.writeMany(
    [
      ['Conditions', '条件'],
      ['Level 60, finish quest!', '等级60且完成委托！'],
      ['Return home', '返回家中'],
    ],
    'manual',
    pair
  )
  const text = 'Conditions: 1. Level 60, finish quest! 2. Return home'
  const diagnostic = testTranslationCache({ ...pair, text, scope: 'shared' }, file)
  expect(diagnostic.plan.zh).toBe('条件: 1. 等级60且完成委托！ 2. 返回家中')
  const resolver = createSentenceResolver(['Conditions', 'Level 60, finish quest!', 'Return home'].map((s) => cache.record(s, pair)!))
  expect(resolver.plan(text).zh).toBe(diagnostic.plan.zh)
  expect(cache.plan(text, pair).zh).toBe(diagnostic.plan.zh)
  cache.close()
})

it('keeps current-game and combined scopes isolated and read-only', () => {
  const game = path.join(root, 'game')
  const seed = ensureGameContentDir(game, 'seed')
  const contents = JSON.stringify({ 'Hello.': '你好。', こんにちは: '您好' })
  fs.writeFileSync(seed, contents)
  jest.mocked(getResolvedFromConfig).mockReturnValue({
    ok: true,
    selected: game,
    contentRoot: game,
    projectRoot: game,
    kind: 'content-root',
    shellApp: '',
    hasShell: false,
    hasWwwLayout: false,
    bundled: false,
    config: { gameRoot: game, shellSource: '', library: [{ id: 'game-a', gameRoot: game, name: 'A', lastOpenedAt: 0, addedAt: 0 }] },
  })
  const cache = openSharedCache(file)
  cache.writeMany([['World.', '世界。']], 'manual', pair)
  const gameOnly = testTranslationCache({ ...pair, text: 'Hello. World.', scope: 'game', gameId: 'game-a' }, file)
  expect(gameOnly.plan.status).toBe('partial')
  expect(gameOnly.plan.gaps.map((g) => g.text).join('')).toContain('World')
  const combined = testTranslationCache({ ...pair, text: 'Hello. World.', scope: 'combined', gameId: 'game-a' }, file)
  expect(combined.plan.status).toBe('full')
  expect(combined.plan.matches.some((m) => m.record.local)).toBe(true)
  expect(fs.readFileSync(seed, 'utf8')).toBe(contents)
  cache.close()
})

it('rejects oversized input and reports structural limits without a false full hit', () => {
  expect(() => testTranslationCache({ ...pair, text: 'x'.repeat(20001), scope: 'shared' }, file)).toThrow('20000')
  const text = 'Items: ' + Array.from({ length: 201 }, (_, i) => `${i + 1}. Item${i}`).join(' ')
  const result = testTranslationCache({ ...pair, text, scope: 'shared' }, file)
  expect(result.diagnostics).toContain('candidate_limit')
  expect(result.plan).toMatchObject({ limited: true, status: 'miss', zh: null })
  expect(fs.existsSync(file)).toBe(false)
})

it('matches cached dialogue after the test query removes line indentation', () => {
  const cache = openSharedCache(file)
  const src = '「こう見えて魔法研究にも熱中していてな、\n　いくらか知見はあるつもりだ。\n　それとそうだな、知り合いの魔術師にも協力してもらうとするか」'
  const zh = '「别看我这样，对魔法研究也颇有心得，\n自认还是有些见解的。\n对了对了，再找认识的魔术师来帮忙如何？」'
  const languages = { from: 'ja' as const, to: 'zh' as const }
  cache.writeMany([[src, zh]], 'manual', languages)
  const text = src.replace(/\n　/g, '\n')
  expect(testTranslationCache({ ...languages, text, scope: 'shared' }, file).plan).toMatchObject({ status: 'full', zh })
  expect(createSentenceResolver([cache.record(src, languages)!]).plan(text).zh).toBe(zh)
  expect(cache.record(src, languages)?.src).toBe(src)
  cache.close()
})

it('partially translates an open dialogue using an independent cached prefix', () => {
  const cache = openSharedCache(file)
  const languages = { from: 'ja' as const, to: 'zh' as const }
  const prefix = '「う゛ぎゅ……、'
  const translated = '「唔嗯……、'
  const remainder = '自分の所有物だからって堂々とd視姦すんな……っ！'
  cache.writeMany([[prefix, translated]], 'manual', languages)
  const text = prefix + '\n' + remainder
  const result = testTranslationCache({ ...languages, text, scope: 'shared' }, file)
  expect(result.plan.status).toBe('partial')
  expect(result.plan.matches).toEqual([expect.objectContaining({ start: 0, end: prefix.length, text: translated })])
  expect(result.plan.gaps.map((g) => g.text)).toEqual([remainder])
  expect(result.preview).toBe(translated + '\n' + remainder)
  expect(createSentenceResolver([cache.record(prefix, languages)!]).plan(text)).toEqual(result.plan)
  cache.close()
})

it('reuses a cached open-parenthetical prefix without inserting its parenthesis', () => {
  const cache = openSharedCache(file)
  const languages = { from: 'ja' as const, to: 'zh' as const }
  const src = '（この店で売られてる魔法水晶って、'
  cache.writeMany([[src, '（这家店卖的魔法水晶']], 'manual', languages)
  const text = 'この店で売られてる魔法水晶って、\nどう考えても“そういう”映 3像よね'
  const result = testTranslationCache({ ...languages, text, scope: 'shared' }, file)
  expect(result.plan.status).toBe('partial')
  expect(result.preview).toBe('这家店卖的魔法水晶、\nどう考えても“そういう”映 3像よね')
  expect(result.plan.matches).toHaveLength(1)
  expect(
    createSentenceResolver([cache.record(src, languages)!])
      .plan(text)
      .matches.map((m) => m.text)
  ).toEqual(result.plan.matches.map((m) => m.text))
  cache.close()
})

it('infers complete sentences read-only using the existing SQLite candidates and the same plugin algorithm', () => {
  const cache = openSharedCache(file)
  const languages = { from: 'ja' as const, to: 'zh' as const }
  const src = '勇者パーティの天才美少女魔法使い。勇者レオンとは幼馴染で許嫁。'
  const zh = '勇者队伍的天才美少女魔法使。与勇者里昂是青梅竹马兼未婚夫。'
  const text = '勇者パーティの天才美少女魔法使い。勇者レオンとは幼馴 3染で許嫁。'
  cache.writeMany([[src, zh]], 'manual', languages)
  const record = cache.record(src, languages)!
  const before = cache.listPage(languages)
  const version = cache.version()
  const result = testTranslationCache({ ...languages, text, scope: 'shared' }, file)
  expect(result.plan).toMatchObject({ status: 'partial', ambiguous: false })
  expect(result.plan.matches).toEqual([expect.objectContaining({ alignment: 'inferred', record: expect.objectContaining({ id: record.id, revision: record.revision }) })])
  expect(result.diagnostics).toContain('inferred_alignment')
  expect(result.preview).toBe('勇者队伍的天才美少女魔法使。勇者レオンとは幼馴 3染で許嫁。')
  expect(createSentenceResolver([record]).plan(text)).toEqual(result.plan)
  expect(cache.plan(text, languages).matches).toEqual(result.plan.matches)
  expect(cache.record(src, languages)).toEqual(record)
  expect(cache.listPage(languages)).toEqual(before)
  expect(cache.version()).toBe(version)
  cache.update(src, '新的译文。第二句。', 'manual', languages)
  expect(testTranslationCache({ ...languages, text, scope: 'shared' }, file).plan.matches[0].text).toBe('新的译文。')
  cache.close()
})

it('keeps SQLite, diagnostics and the plugin conservative when sentence candidates exceed the limit', () => {
  const cache = openSharedCache(file)
  const rows = Array.from({ length: 501 }, (_, i) => [`Alpha. Other${i}.`, `甲。尾${i}。`] as [string, string])
  rows.push(['Alpha. Charlie.', '甲。丙。'])
  cache.writeMany(rows, 'manual', pair)
  const text = 'Alpha. Charlie. Missing.'
  expect(testTranslationCache({ ...pair, text, scope: 'shared' }, file).plan).toMatchObject({ status: 'miss', limited: true })
  expect(cache.plan(text, pair)).toMatchObject({ status: 'miss', limited: true })
  expect(createSentenceResolver(rows.map(([src]) => cache.record(src, pair)!)).plan(text)).toMatchObject({ status: 'miss', limited: true })
  cache.close()
})

it('matches both independent clauses when their cached seam variants produce identical output', () => {
  const cache = openSharedCache(file)
  const languages = { from: 'ja' as const, to: 'zh' as const }
  cache.writeMany(
    [
      ['美少女と形容するほかにない、', '只能用美少女来形容的、'],
      ['美少女と形容するほかにない', '只能用美少女来形容的'],
      ['凛としたセリカの顔立ちが露わになる。', '赛莉卡凛然的面容完全暴露出来。'],
    ],
    'manual',
    languages
  )
  const text = '美少女と形容するほかにない、\n凛としたセリカの顔立ちが露わになる。\n普段の気品溢れる様とは違い、羞 2恥に赤く染まってはいたが。'
  const result = testTranslationCache({ ...languages, text, scope: 'shared' }, file)
  expect(result.plan).toMatchObject({ status: 'partial', ambiguous: false })
  expect(result.plan.matches).toHaveLength(2)
  expect(result.plan.gaps.map((g) => g.text)).toEqual(['普段の気品溢れる様とは違い、羞 2恥に赤く染まってはいたが。'])
  expect(result.preview).toBe('只能用美少女来形容的、\n赛莉卡凛然的面容完全暴露出来。\n普段の気品溢れる様とは違い、羞 2恥に赤く染まってはいたが。')
  cache.close()
})

it('finds independent cache rows behind soft-wrapped lines through existing SQLite keys', () => {
  const cache = openSharedCache(file)
  const languages = { from: 'ja' as const, to: 'zh' as const }
  const rows: Array<[string, string]> = [
    ['あ', '啊'],
    ['セリカは', '赛莉卡'],
    ['魔法を使います', '使用魔法'],
  ]
  cache.writeMany(rows, 'manual', languages)
  const before = cache.listPage(languages),
    version = cache.version()
  const text = 'あ、3あたし、\nセリカは\n魔法を使います'
  const result = testTranslationCache({ ...languages, text, scope: 'shared' }, file)
  expect(result.plan).toMatchObject({ status: 'partial', ambiguous: false })
  expect(result.preview).toBe('啊、3あたし、\n赛莉卡\n使用魔法')
  expect(result.plan.gaps.map((g) => g.text)).toEqual(['3あたし、'])
  expect(createSentenceResolver(rows.map(([src]) => cache.record(src, languages)!)).plan(text)).toEqual(result.plan)
  expect(cache.plan(text, languages).matches).toEqual(result.plan.matches)
  expect(cache.listPage(languages)).toEqual(before)
  expect(cache.version()).toBe(version)
  cache.close()
})
