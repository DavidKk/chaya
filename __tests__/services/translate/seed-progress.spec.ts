import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { createSeedFillSession, fillMissingFromSeed, getSeedTranslateProgress } from '@/services/translate/fill-missing'
import { liveTranslateTexts } from '@/services/translate/live-translate'
import { openSharedCache } from '@/services/translate/shared-cache'

let mockRoot = ''
let mockDb = ''
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: true, contentRoot: mockRoot }) }))
jest.mock('@/services/translate/live-translate', () => ({ liveTranslateTexts: jest.fn() }))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/services/translate/shared-cache', () => {
  const actual = jest.requireActual('@/services/translate/shared-cache')
  return { ...actual, openSharedCache: () => actual.openSharedCache(mockDb) }
})

function seed(root: string, entries: Record<string, string>) {
  const file = gameContentPath(root, 'seed')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(entries))
}

describe('seed translation context and cache contract', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-seed-review-'))
    mockRoot = path.join(dir, 'A')
    mockDb = path.join(dir, 'cache.sqlite')
    jest.mocked(liveTranslateTexts).mockReset()
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('recovers numeric coverage from durable game examples and invalidates conflicting edits', () => {
    seed(mockRoot, { Thunder5: '雷霆5', Thunder10: '雷霆10', Thunder7: '' })
    expect(getSeedTranslateProgress(mockRoot, true, true)).toMatchObject({ done: 3, missing: 0 })
    seed(mockRoot, { Thunder5: '雷霆5', Thunder10: '闪电10', Thunder7: '' })
    expect(getSeedTranslateProgress(mockRoot, true, true)).toMatchObject({ done: 2, missing: 1 })
    seed(mockRoot, { Thunder5: '雷霆5', Thunder7: '' })
    expect(getSeedTranslateProgress(mockRoot, true, true)).toMatchObject({ done: 1, missing: 1 })
  })

  it('advances a bounded cursor and resumes only unfinished sources after interruption', async () => {
    seed(mockRoot, { Hello: '', Welcome: '', Goodbye: '' })
    jest.mocked(liveTranslateTexts).mockImplementation(async (texts, opts) => {
      opts?.onCacheMatch?.(2)
      opts?.onCacheMatch?.(3)
      const cache = openSharedCache()
      cache.writeMany(
        texts.map((text) => [text, '译文']),
        'live:apple',
        { from: 'en', to: 'zh' }
      )
      cache.close()
      return { items: texts.map((src) => ({ src, zh: '译文' })), contentRoot: mockRoot, engines: ['apple'] }
    })
    const trace = jest.fn()
    const session = createSeedFillSession(mockRoot, trace)
    const first = await session.fill({ limit: 2, maxChars: 6, onTrace: trace })
    expect(first).toMatchObject({ done: 1, missing: 2, scanned: 1, performance: { completedChars: 5, cacheMs: expect.any(Number) } })
    expect(first.performance!.cacheMs).toBeGreaterThanOrEqual(5)
    expect(trace).toHaveBeenCalledWith(expect.stringContaining('Batch selected: items=1, sourceChars=5, budgetUnits=5, charBudget=6'))
    expect(trace).toHaveBeenCalledWith(expect.stringContaining('Batch coverage verified:'))
    expect(trace.mock.calls.every(([message]) => !message.includes('Hello'))).toBe(true)
    const resumed = createSeedFillSession(mockRoot)
    await resumed.fill({ limit: 1 })
    expect(jest.mocked(liveTranslateTexts).mock.calls.map(([texts]) => texts)).toEqual([['Hello'], ['Welcome']])
    const final = await resumed.fill({ limit: 1 })
    expect(final).toMatchObject({ done: 3, missing: 0 })
  })

  it('reconciles manual deletions before reporting the job complete', async () => {
    seed(mockRoot, { Hello: '', Welcome: '' })
    const cache = openSharedCache()
    cache.writeMany([['Hello', '你好']], 'manual', { from: 'en', to: 'zh' })
    cache.close()
    const session = createSeedFillSession(mockRoot)
    jest.mocked(liveTranslateTexts).mockImplementation(async (texts) => {
      const edited = openSharedCache()
      edited.remove('Hello', { from: 'en', to: 'zh' })
      edited.writeMany([['Welcome', '欢迎']], 'live:apple', { from: 'en', to: 'zh' })
      edited.close()
      return { items: texts.map((src) => ({ src, zh: '欢迎' })), contentRoot: mockRoot, engines: ['apple'] }
    })
    expect(await session.fill()).toMatchObject({ done: 1, missing: 1 })
  })

  it('keeps durable successes when the batch deadline interrupts outstanding work', async () => {
    seed(mockRoot, { Hello: '', Welcome: '' })
    const controller = new AbortController()
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    jest.mocked(liveTranslateTexts).mockImplementation(async (_texts, opts) => {
      const cache = openSharedCache()
      cache.writeMany([['Hello', '你好']], 'live:apple', { from: 'en', to: 'zh' })
      cache.close()
      opts?.onItem?.({ src: 'Hello', zh: '你好' })
      controller.abort(new Error('Batch timed out'))
      throw controller.signal.reason
    })
    const session = createSeedFillSession(mockRoot)
    expect(await session.fill()).toMatchObject({ scanned: 2, translated: 1, failed: 1, unresolved: ['Welcome'] })
    expect(createSeedFillSession(mockRoot).progress).toMatchObject({ done: 1, missing: 1 })
  })

  it('reloads changed seeds between slices and skips failures without repeating the remaining queue', async () => {
    seed(mockRoot, { Hello: '', Welcome: '' })
    jest.mocked(liveTranslateTexts).mockResolvedValue({ items: [], contentRoot: mockRoot, engines: ['apple'] })
    const session = createSeedFillSession(mockRoot)
    await session.fill({ limit: 1 })
    await session.fill({ limit: 1, exclude: new Set(['Hello']) })
    expect(jest.mocked(liveTranslateTexts).mock.calls.map(([texts]) => texts)).toEqual([['Hello'], ['Welcome']])
    expect(await session.fill({ exclude: new Set(['Hello', 'Welcome']) })).toMatchObject({ scanned: 0, missing: 2 })
    seed(mockRoot, { NewSource: '' })
    await session.fill()
    expect(jest.mocked(liveTranslateTexts).mock.calls[2][0]).toEqual(['NewSource'])
  })

  it('counts numeric template coverage as complete and invalidates it on edits', () => {
    seed(mockRoot, { Thunder007: '' })
    const cache = openSharedCache()
    cache.writeMany(
      [
        ['Thunder5', '雷霆5'],
        ['Thunder10', '雷霆10'],
      ],
      'manual',
      { from: 'en', to: 'zh' }
    )
    cache.close()
    expect(getSeedTranslateProgress(mockRoot)).toMatchObject({ total: 1, done: 1, missing: 0 })
    const edited = openSharedCache()
    edited.writeMany([['Thunder5', '闪电5']], 'manual', { from: 'en', to: 'zh' })
    edited.close()
    expect(getSeedTranslateProgress(mockRoot)).toMatchObject({ total: 1, done: 0, missing: 1 })
  })
  it('counts normalized control-code and local seed translations as complete', () => {
    seed(mockRoot, { '\\C[0]こんにちは': '', さようなら: '再见', 未翻訳です: '' })
    const cache = openSharedCache()
    cache.upsertMany([['こんにちは', '你好']])
    cache.close()
    expect(getSeedTranslateProgress(mockRoot, true)).toMatchObject({ done: 2, missing: 1 })
  })

  it('keeps the same root when the selected game changes during a request', async () => {
    const rootA = mockRoot
    const rootB = path.join(dir, 'B')
    seed(rootA, { こんにちは: '' })
    seed(rootB, { さようなら: '' })
    jest.mocked(liveTranslateTexts).mockImplementation(async (texts, opts) => {
      expect(opts?.contentRoot).toBe(rootA)
      mockRoot = rootB
      const cache = openSharedCache()
      cache.upsertMany([[texts[0], '你好']])
      cache.close()
      return { items: [{ src: texts[0], zh: '你好' }], contentRoot: rootA, engines: ['google'] }
    })
    expect(await fillMissingFromSeed()).toMatchObject({ contentRoot: rootA, translated: 1, missing: 0 })
    expect(getSeedTranslateProgress(rootB, true)).toMatchObject({ done: 0, missing: 1 })
  })

  it('reports completed cache coverage and failures as disjoint parts of the batch', async () => {
    seed(mockRoot, { Hello: '', Goodbye: '' })
    jest.mocked(liveTranslateTexts).mockImplementation(async () => {
      const cache = openSharedCache()
      cache.writeMany([['Hello', '你好']], 'live:apple', { from: 'en', to: 'zh' })
      cache.close()
      return {
        items: [
          { src: 'Hello', zh: '你好' },
          { src: 'Goodbye', zh: '再见' },
        ],
        contentRoot: mockRoot,
        engines: ['apple'],
      }
    })
    const result = await fillMissingFromSeed({ contentRoot: mockRoot })
    expect(result).toMatchObject({ scanned: 2, translated: 1, failed: 1, unresolved: ['Goodbye'] })
    expect(result.translated + result.failed).toBe(result.scanned)
  })
  it('excludes failed items for this run without poisoning shared cache', async () => {
    seed(mockRoot, { こんにちは: '', さようなら: '' })
    jest.mocked(liveTranslateTexts).mockResolvedValue({ items: [{ src: 'さようなら', zh: null }], contentRoot: mockRoot, engines: ['google'] })
    const result = await fillMissingFromSeed({ contentRoot: mockRoot, exclude: new Set(['こんにちは']) })
    expect(jest.mocked(liveTranslateTexts).mock.calls[0][0]).toEqual(['さようなら'])
    expect(result).toMatchObject({ missing: 2, failed: 1, unresolved: ['さようなら'] })
    const cache = openSharedCache()
    expect(cache.get('こんにちは')).toBeNull()
    cache.close()
  })
  it('reuses unchanged progress but invalidates it on cache writes and seed edits', () => {
    seed(mockRoot, { Hello: '' })
    expect(getSeedTranslateProgress(mockRoot)).toMatchObject({ done: 0, missing: 1 })
    const cache = openSharedCache()
    cache.upsertMany([['Hello', '你好']], undefined, { from: 'en', to: 'zh' })
    cache.close()
    expect(getSeedTranslateProgress(mockRoot)).toMatchObject({ done: 1, missing: 0 })
    seed(mockRoot, { Hello: '', Welcome: '' })
    expect(getSeedTranslateProgress(mockRoot)).toMatchObject({ done: 1, missing: 1 })
    expect(getSeedTranslateProgress(mockRoot)).toMatchObject({ done: 1, missing: 1 })
  })
})
