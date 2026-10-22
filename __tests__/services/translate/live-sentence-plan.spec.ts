jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: false }) }))
jest.mock('@/services/translate/engine-switches', () => ({
  getTranslateEngineSwitches: () => ({
    enabled: ['google'],
    agents: [
      { id: 'a', profileId: 'a', model: '', enabled: true },
      { id: 'b', profileId: 'b', model: '', enabled: true },
    ],
  }),
  TRANSLATE_ENGINE_IDS: ['google'],
  DEFAULT_ENGINE_SWITCHES: { google: true },
}))
jest.mock('@/lib/translate/engine-http', () => ({ requestGoogle: jest.fn() }))
jest.mock('@/services/translate/agent-translate', () => ({ agentJaToZh: jest.fn() }))
jest.mock('@/services/translate/lib/macos-translate', () => ({ appleTranslate: jest.fn() }))
jest.mock('@/services/translate/lib/bergamot-translate', () => ({ bergamotTranslate: jest.fn() }))
let mockDb = ''
jest.mock('@/services/translate/shared-cache', () => {
  const actual = jest.requireActual('@/services/translate/shared-cache')
  return { ...actual, openSharedCache: () => actual.openSharedCache(mockDb) }
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { requestGoogle } from '@/lib/translate/engine-http'
import type { TranslateRunEngine } from '@/lib/translate/engines'
import { agentJaToZh } from '@/services/translate/agent-translate'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { bergamotTranslate } from '@/services/translate/lib/bergamot-translate'
import { appleTranslate } from '@/services/translate/lib/macos-translate'
import { liveTranslateTexts } from '@/services/translate/live-translate'
import { openSharedCache } from '@/services/translate/shared-cache'

describe('live short-sentence integration', () => {
  let dir: string, root: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-live-block-'))
    root = path.join(dir, 'game')
    fs.mkdirSync(root)
    mockDb = path.join(dir, 'shared.sqlite')
    jest.mocked(requestGoogle).mockReset()
    jest.mocked(bergamotTranslate).mockReset()
    jest.mocked(appleTranslate).mockReset()
    jest.mocked(agentJaToZh).mockReset()
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
  it('dispatches bypassed work before opening caches, then preserves a concurrent human edit', async () => {
    const trace = jest.fn()
    jest.mocked(requestGoogle).mockImplementation(async () => {
      expect(trace.mock.calls.some(([message]) => message.startsWith('Shared cache opened'))).toBe(false)
      const edited = openSharedCache()
      edited.writeMany([['Hello', '人工定稿']], 'manual', { from: 'en', to: 'zh' })
      edited.close()
      return '机器结果'
    })
    const result = await liveTranslateTexts(['Hello'], { contentRoot: root, engines: ['google'], cacheMode: 'bypass', onTrace: trace })
    expect(result.items[0]).toMatchObject({ zh: '人工定稿', engine: 'cache:remote' })
    const cache = openSharedCache()
    expect(cache.get('Hello', { from: 'en', to: 'zh' })).toBe('人工定稿')
    cache.close()
  })

  it('protects local human translations when cache search is bypassed', async () => {
    jest.mocked(requestGoogle).mockImplementation(async () => {
      const seed = gameContentPath(root, 'seed')
      fs.mkdirSync(path.dirname(seed), { recursive: true })
      fs.writeFileSync(seed, JSON.stringify({ Hello: '本作人工定稿' }))
      return '机器结果'
    })
    const result = await liveTranslateTexts(['Hello'], { contentRoot: root, engines: ['google'], cacheMode: 'bypass' })
    expect(result.items[0]).toMatchObject({ zh: '本作人工定稿', engine: 'cache:local' })
  })

  it('does not close or flush a borrowed writer after one item', async () => {
    const cache = openSharedCache()
    const close = jest.spyOn(cache, 'close')
    const flush = jest.spyOn(cache, 'flushBackfill')
    jest.mocked(requestGoogle).mockResolvedValue('你好')
    await liveTranslateTexts(['Hello'], { contentRoot: root, engines: ['google'], cacheMode: 'bypass', sharedCache: () => cache })
    expect(close).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
    expect(cache.get('Hello', { from: 'en', to: 'zh' })).toBe('你好')
    cache.close()
  })

  it('does not bypass local authority by translating after the local candidate limit is exceeded', async () => {
    const seed = gameContentPath(root, 'seed')
    fs.mkdirSync(path.dirname(seed), { recursive: true })
    fs.writeFileSync(seed, JSON.stringify(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`Alpha. Other${i}.`, `甲。尾${i}。`]))))
    const result = await liveTranslateTexts(['Alpha. Missing.'], { contentRoot: root, engines: ['apple'] })
    expect(result.items[0]).toMatchObject({ zh: null, plan: { limited: true }, error: expect.stringContaining('candidate limit') })
    expect(appleTranslate).not.toHaveBeenCalled()
  })
  it('traces cache, engine, persistence and completion without logging source text', async () => {
    jest.mocked(appleTranslate).mockResolvedValue('你好')
    const trace = jest.fn()
    await liveTranslateTexts(['Hello'], { contentRoot: root, engines: ['apple'], onTrace: trace })
    const messages = trace.mock.calls.map(([message]) => message as string)
    for (const stage of [
      'Shared cache opened',
      'Game indexes loaded',
      'Item 1 cache plan',
      'Item 1 engine requested',
      'Item 1 engine returned',
      'Item 1 shared cache write',
      'Final backfill flushed',
      'Pipeline finished',
    ]) {
      expect(messages.some((message) => message.startsWith(stage))).toBe(true)
    }
    expect(messages).toContainEqual(expect.stringContaining('items=1, sourceChars=5, engines=apple'))
    expect(messages.every((message) => !message.includes('Hello') && !message.includes('你好'))).toBe(true)
    const cachedTrace = jest.fn()
    await liveTranslateTexts(['Hello'], { contentRoot: root, engines: ['apple'], onTrace: cachedTrace })
    expect(cachedTrace.mock.calls.some(([message]) => message.includes('engine requested'))).toBe(false)
    expect(appleTranslate).toHaveBeenCalledTimes(1)
  })
  it('reuses agreeing numeric labels without a request, then invalidates on human edits', async () => {
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
    const first = await liveTranslateTexts(['Thunder007'], { contentRoot: root, engines: ['google'] })
    expect(first.items[0]).toMatchObject({ zh: '雷霆007', engine: 'cache:numeric' })
    expect(requestGoogle).not.toHaveBeenCalled()
    const edited = openSharedCache()
    edited.writeMany([['Thunder5', '闪电5']], 'manual', { from: 'en', to: 'zh' })
    edited.close()
    jest.mocked(requestGoogle).mockResolvedValue('闪电7')
    const next = await liveTranslateTexts(['Thunder7'], { contentRoot: root, engines: ['google'] })
    expect(next.items[0].engine).toBe('live:google')
    expect(requestGoogle).toHaveBeenCalledTimes(1)
  })
  it('invalidates numeric dependencies when the corpus changes during the same batch', async () => {
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
    jest.mocked(requestGoogle).mockImplementation(async (_url, text) => {
      if (text === 'Hello') {
        const edited = openSharedCache()
        edited.writeMany([['Thunder5', '闪电5']], 'manual', { from: 'en', to: 'zh' })
        edited.close()
      }
      return text === 'Thunder8' ? '闪电8' : '你好'
    })
    const result = await liveTranslateTexts(['Thunder007', 'Hello', 'Other', 'Fourth', 'Thunder8'], { contentRoot: root, engines: ['google'] })
    expect(result.items[0]).toMatchObject({ engine: 'cache:numeric', zh: '雷霆007' })
    expect(result.items[4]).toMatchObject({ engine: 'live:google', zh: '闪电8' })
  })
  it('keeps successful items when another times out and ignores its late response', async () => {
    let late: (text: string) => void = () => {}
    jest.mocked(requestGoogle).mockImplementation(async (_fetch, text) =>
      text === 'Hello'
        ? '你好'
        : new Promise<string>((resolve) => {
            late = resolve
          })
    )
    const checkpoint = jest.fn()
    const result = await liveTranslateTexts(['Hello', 'Welcome'], { contentRoot: root, engines: ['google'], itemTimeoutMs: 50, onItem: checkpoint })
    expect(result.items[0]).toMatchObject({ zh: '你好' })
    expect(result.items[1]).toMatchObject({ zh: null, error: expect.stringContaining('deadline') })
    expect(checkpoint).toHaveBeenCalledTimes(2)
    late('欢迎')
    await new Promise<void>((resolve) => setImmediate(resolve))
    const cache = openSharedCache()
    expect(cache.get('Hello', { from: 'en', to: 'zh' })).toBe('你好')
    expect(cache.get('Welcome', { from: 'en', to: 'zh' })).toBeNull()
    cache.close()
  })

  it('saves a successful gap even if another gap reaches its deadline', async () => {
    const cache = openSharedCache()
    cache.writeMany([['村へ行く,休む', '前往村庄，休息']], 'import')
    cache.close()
    let late: (text: string) => void = () => {}
    jest.mocked(requestGoogle).mockImplementation(async (_fetch, text) =>
      text.includes('準備')
        ? '准备吧，'
        : new Promise<string>((resolve) => {
            late = resolve
          })
    )
    await liveTranslateTexts(['準備する,村へ行く,休む,出発する'], { contentRoot: root, engines: ['google'], itemTimeoutMs: 50 })
    late('出发')
    await new Promise<void>((resolve) => setImmediate(resolve))
    const after = openSharedCache()
    expect(after.get('準備する,')).toBe('准备吧，')
    expect(after.get('出発する')).toBeNull()
    after.close()
  })

  it('dispatches to Bergamot and stores its source tag in the shared cache', async () => {
    jest.mocked(bergamotTranslate).mockResolvedValue('你好')
    const result = await liveTranslateTexts(['こんにちは'], { contentRoot: root, engines: ['bergamot'], sourceLang: 'ja', targetLang: 'zh' })
    expect(result.items[0].zh).toBe('你好')
    expect(bergamotTranslate).toHaveBeenCalledWith('こんにちは', { source: 'ja', target: 'zh' })
    const cache = openSharedCache()
    expect(cache.listPage({ engine: 'bergamot' }).items[0]).toMatchObject({ src: 'こんにちは', engine: 'live:bergamot' })
    cache.close()
    expect(requestGoogle).not.toHaveBeenCalled()
  })
  it('sends only the missing block to the engine and never stores the composite as a new final record', async () => {
    const cache = openSharedCache()
    cache.writeMany([['村へ行く,休む', '前往村庄，休息']], 'import')
    cache.close()
    jest.mocked(requestGoogle).mockResolvedValue('准备吧，')
    const result = await liveTranslateTexts(['準備する,村へ行く,休む'], { contentRoot: root, engines: ['google'] })
    expect(result.items[0]).toMatchObject({ zh: '准备吧,前往村庄，休息', status: 'full' })
    expect(requestGoogle).toHaveBeenCalledTimes(1)
    expect(jest.mocked(requestGoogle).mock.calls[0][1]).toBe('準備する,')
    const after = openSharedCache()
    expect(after.get('準備する,村へ行く,休む')).toBeNull()
    expect(after.get('準備する,')).toBe('准备吧，')
    after.close()
  })
  it('force previews cannot overwrite shared or local manual equivalents', async () => {
    const cache = openSharedCache()
    cache.writeMany([['あん？', '人工译文']], 'manual')
    cache.close()
    jest.mocked(requestGoogle).mockResolvedValue('平台译文')
    await liveTranslateTexts(['あん?'], { contentRoot: root, engines: ['google'], force: true })
    expect(loadGameTranslationRecords(root)).toEqual([])
    const after = openSharedCache()
    expect(after.get('あん?')).toBe('人工译文')
    after.close()
  })
  it('replans instead of applying an old engine result when a human fills the gap during inference', async () => {
    const cache = openSharedCache()
    cache.writeMany([['村へ行く,休む', '前往村庄，休息']], 'import')
    cache.close()
    jest.mocked(requestGoogle).mockImplementation(async () => {
      const other = openSharedCache()
      other.writeMany([['準備する,', '人工准备，']], 'manual')
      other.close()
      return '机器准备，'
    })
    const result = await liveTranslateTexts(['準備する,村へ行く,休む'], { contentRoot: root, engines: ['google'] })
    expect(result.items[0]).toMatchObject({ zh: '人工准备,前往村庄，休息', engine: 'cache:changed', status: 'full' })
  })
  it('persist false does not append cache files', async () => {
    jest.mocked(requestGoogle).mockResolvedValue('你好')
    await liveTranslateTexts(['こんにちは'], { contentRoot: root, engines: ['google'], persist: false })
    expect(fs.existsSync(gameContentPath(root, 'cacheNdjson'))).toBe(false)
  })
  it('waits for the first engine and never invokes fallback after a valid result', async () => {
    let finish!: (value: string) => void
    jest.mocked(requestGoogle).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    jest.mocked(bergamotTranslate).mockResolvedValue('备用译文')
    const pending = liveTranslateTexts(['こんにちは世界'], { contentRoot: root, engines: ['google', 'bergamot'] })
    await Promise.resolve()
    expect(requestGoogle).toHaveBeenCalledTimes(1)
    expect(bergamotTranslate).not.toHaveBeenCalled()
    finish('首选译文')
    expect((await pending).items[0]).toMatchObject({ zh: '首选译文', engine: 'live:google' })
    expect(bergamotTranslate).not.toHaveBeenCalled()
  })

  it('aggregates errors when all ordered engines fail', async () => {
    jest.mocked(bergamotTranslate).mockRejectedValue(new Error('Bergamot 崩溃'))
    jest.mocked(requestGoogle).mockRejectedValue(new Error('Google 限流'))
    const result = await liveTranslateTexts(['こんにちは世界'], { contentRoot: root, engines: ['google', 'bergamot'] })
    expect(result.items[0].zh).toBeNull()
    expect(result.items[0].error).toContain('Bergamot 崩溃')
    expect(result.items[0].error).toContain('Google 限流')
  })

  it('safely handles empty engines without throwing AggregateError', async () => {
    const result = await liveTranslateTexts(['こんにちは世界'], { contentRoot: root, engines: [] })
    expect(result.items[0].zh).toBeNull()
    expect(result.items[0].error).toBe('No translation engines are enabled')
  })
  const chains: TranslateRunEngine[][] = [
    ['agent:a', 'agent:b', 'google', 'apple', 'bergamot'],
    ['apple', 'bergamot', 'agent:a', 'agent:b', 'google'],
    ['google', 'agent:a', 'agent:b', 'apple', 'bergamot'],
  ]
  const scenarios = chains.flatMap((chain) => chain.map((winner) => ({ chain, winner })))
  it.each(scenarios)('stops at $winner after exhausting earlier engines in $chain', async ({ chain, winner }) => {
    const calls: string[] = []
    const attempt = async (engine: string) => {
      calls.push(engine)
      if (engine !== winner) throw new Error(`${engine} unavailable`)
      return '有效译文'
    }
    jest.mocked(agentJaToZh).mockImplementation((_text, config) => attempt(`agent:${config.profileId}`))
    jest.mocked(requestGoogle).mockImplementation(() => attempt('google'))
    jest.mocked(appleTranslate).mockImplementation(() => attempt('apple'))
    jest.mocked(bergamotTranslate).mockImplementation(() => attempt('bergamot'))
    const result = await liveTranslateTexts(['こんにちは世界'], { contentRoot: root, engines: chain })
    expect(calls).toEqual(chain.slice(0, chain.indexOf(winner) + 1))
    expect(result.items[0]).toMatchObject({ zh: '有效译文', engine: `live:${winner}` })
    const cache = openSharedCache()
    expect(cache.get('こんにちは世界')).toBe('有效译文')
    cache.close()
    calls.length = 0
    expect((await liveTranslateTexts(['こんにちは世界'], { contentRoot: root, engines: chain })).items[0].zh).toBe('有效译文')
    expect(calls).toEqual([])
  })

  it('treats empty and untranslated output as failure before falling back', async () => {
    jest.mocked(agentJaToZh).mockResolvedValue('')
    jest.mocked(requestGoogle).mockResolvedValue('こんにちは世界')
    jest.mocked(appleTranslate).mockResolvedValue('有效译文')
    const result = await liveTranslateTexts(['こんにちは世界'], { contentRoot: root, engines: ['agent:a', 'google', 'apple'] })
    expect(result.items[0]).toMatchObject({ zh: '有效译文', engine: 'live:apple' })
  })

  it('uses the fallback chain for a partial-cache gap', async () => {
    const cache = openSharedCache()
    cache.writeMany([['村へ行く,休む', '前往村庄，休息']], 'import')
    cache.close()
    jest.mocked(agentJaToZh).mockRejectedValue(new Error('Agent unavailable'))
    jest.mocked(requestGoogle).mockResolvedValue('准备吧，')
    expect((await liveTranslateTexts(['準備する,村へ行く,休む'], { contentRoot: root, engines: ['agent:a', 'google'] })).items[0]).toMatchObject({
      status: 'full',
      zh: '准备吧,前往村庄，休息',
    })
    expect(agentJaToZh).toHaveBeenCalledTimes(1)
    expect(jest.mocked(requestGoogle).mock.calls[0][1]).toBe('準備する,')
  })

  it('does not fall back or persist after cancellation', async () => {
    const abort = new AbortController()
    jest.mocked(requestGoogle).mockImplementation(async () => {
      abort.abort()
      throw new Error('Cancelled')
    })
    await expect(liveTranslateTexts(['こんにちは世界'], { contentRoot: root, engines: ['google', 'apple'], local: { signal: abort.signal } })).rejects.toThrow()
    expect(appleTranslate).not.toHaveBeenCalled()
    const cache = openSharedCache()
    expect(cache.get('こんにちは世界')).toBeNull()
    cache.close()
  })

  it('processes texts concurrently, isolates their failures and preserves input order', async () => {
    let finish!: (value: string) => void
    jest.mocked(requestGoogle).mockImplementation((_http, text) =>
      text === 'こんにちは世界'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.reject(new Error('Google unavailable'))
    )
    jest.mocked(appleTranslate).mockResolvedValue('再见世界')
    const pending = liveTranslateTexts(['こんにちは世界', 'さようなら世界'], { contentRoot: root, engines: ['google', 'apple'], persist: false })
    for (let i = 0; i < 12; i++) await Promise.resolve()
    expect(requestGoogle).toHaveBeenCalledTimes(2)
    expect(appleTranslate).toHaveBeenCalledTimes(1)
    finish('你好世界')
    expect((await pending).items.map((item) => [item.src, item.engine])).toEqual([
      ['こんにちは世界', 'live:google'],
      ['さようなら世界', 'live:apple'],
    ])
  })
})
