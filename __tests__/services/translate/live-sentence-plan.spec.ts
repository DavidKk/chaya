jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: false }) }))
jest.mock('@/services/translate/engine-switches', () => ({
  getTranslateEngineSwitches: () => ({ enabled: ['google'], agents: [] }),
  TRANSLATE_ENGINE_IDS: ['google'],
  DEFAULT_ENGINE_SWITCHES: { google: true },
}))
jest.mock('@/lib/translate/engine-http', () => ({ requestGoogle: jest.fn() }))
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
})
