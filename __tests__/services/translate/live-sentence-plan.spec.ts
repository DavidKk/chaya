jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: false }) }))
jest.mock('@/services/translate/engine-switches', () => ({
  getTranslateEngineSwitches: () => ({ enabled: ['google'], agents: [] }),
  TRANSLATE_ENGINE_IDS: ['google'],
  DEFAULT_ENGINE_SWITCHES: { google: true },
}))
jest.mock('@/lib/translate/engine-http', () => ({ requestGoogle: jest.fn() }))
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
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { bergamotTranslate } from '@/services/translate/lib/bergamot-translate'
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
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
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
  it('translates concurrently across enabled engines and picks the faster valid winner', async () => {
    jest.mocked(bergamotTranslate).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return '来自 Bergamot'
    })
    jest.mocked(requestGoogle).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 80))
      return '来自 Google'
    })
    const result = await liveTranslateTexts(['こんにちは世界'], { contentRoot: root, engines: ['google', 'bergamot'] })
    expect(result.items[0]).toMatchObject({ zh: '来自 Bergamot', engine: 'live:bergamot' })
  })

  it('aggregates errors when all concurrent engines fail', async () => {
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
    expect(result.items[0].error).toBe('未开启任何翻译平台')
  })
})
