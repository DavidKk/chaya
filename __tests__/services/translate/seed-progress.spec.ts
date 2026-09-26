import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { fillMissingFromSeed, getSeedTranslateProgress } from '@/services/translate/fill-missing'
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
})
