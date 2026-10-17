import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { DB_SPECS } from '@/lib/translate/database-fields'
import { extractAndEnsureSeed } from '@/services/extract/ensure-seed'

let mockRoot = ''
const mockShared = new Map<string, string>()
jest.mock('@/services/translate/shared-cache', () => ({ openSharedCache: () => ({ get: (key: string) => mockShared.get(key) ?? null, close: jest.fn() }) }))
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: true, remote: false, contentRoot: mockRoot }) }))

beforeEach(() => {
  mockShared.clear()
  mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-missing-content-'))
  fs.mkdirSync(path.join(mockRoot, 'data'))
  for (const [file] of DB_SPECS) fs.writeFileSync(path.join(mockRoot, 'data', file), '[]')
  fs.writeFileSync(path.join(mockRoot, 'data/System.json'), JSON.stringify({ terms: {} }))
  fs.writeFileSync(path.join(mockRoot, 'data/Troops.json'), '[]')
  fs.writeFileSync(path.join(mockRoot, 'data/CommonEvents.json'), JSON.stringify([{ id: 1, list: [{ code: 401, parameters: ['こんにちは'] }] }]))
})
afterEach(() => fs.rmSync(mockRoot, { recursive: true, force: true }))

it('creates extraction outputs and the seed when the entire chaya directory is missing', () => {
  expect(fs.existsSync(path.join(mockRoot, 'chaya'))).toBe(false)
  expect(extractAndEnsureSeed({ entries: true }).entries).toEqual({ こんにちは: '' })
  for (const kind of ['extractStrings', 'extractCompare', 'seed'] as const) expect(fs.existsSync(gameContentPath(mockRoot, kind))).toBe(true)
})

it.each(['extractStrings', 'extractCompare', 'seed', 'translate-directory'] as const)('recreates missing %s while preserving other files', (missing) => {
  extractAndEnsureSeed()
  const seed = gameContentPath(mockRoot, 'seed')
  fs.writeFileSync(seed, JSON.stringify({ こんにちは: '你好' }))
  fs.mkdirSync(path.join(mockRoot, 'chaya/config'))
  const config = path.join(mockRoot, 'chaya/config/game-edit.json')
  fs.writeFileSync(config, '{"keep":true}')
  if (missing === 'translate-directory') fs.rmSync(path.dirname(seed), { recursive: true })
  else fs.unlinkSync(gameContentPath(mockRoot, missing))
  extractAndEnsureSeed()
  for (const kind of ['extractStrings', 'extractCompare', 'seed'] as const) expect(fs.existsSync(gameContentPath(mockRoot, kind))).toBe(true)
  expect(JSON.parse(fs.readFileSync(seed, 'utf8'))).toEqual({ こんにちは: missing === 'seed' || missing === 'translate-directory' ? '' : '你好' })
  expect(fs.readFileSync(config, 'utf8')).toBe('{"keep":true}')
})

it('exports the latest local and shared translations instead of empty seed placeholders', () => {
  fs.writeFileSync(path.join(mockRoot, 'data/CommonEvents.json'), JSON.stringify([{ id: 1, list: [{ code: 102, parameters: [['こんにちは', 'さようなら', '待って']] }] }]))
  extractAndEnsureSeed()
  fs.writeFileSync(gameContentPath(mockRoot, 'seed'), JSON.stringify({ こんにちは: '旧译文', さようなら: '', 待って: '' }))
  fs.writeFileSync(gameContentPath(mockRoot, 'cacheNdjson'), JSON.stringify(['こんにちは', '你好']) + '\n')
  mockShared.set('こんにちは', '共享你好')
  mockShared.set('さようなら', '再见')
  expect(extractAndEnsureSeed({ entries: true }).entries).toEqual({ こんにちは: '你好', さようなら: '再见', 待って: '' })
})

it('preserves punctuation in export keys while the internal seed and cache use body keys', () => {
  fs.writeFileSync(
    path.join(mockRoot, 'data/CommonEvents.json'),
    JSON.stringify([{ id: 1, list: [{ code: 102, parameters: [[String.raw`\n\b「こんにちは。」`, '【こんにちは】', 'こんにちは！', 'さようなら？', '待って。']] }] }])
  )
  extractAndEnsureSeed()
  fs.writeFileSync(
    gameContentPath(mockRoot, 'cacheNdjson'),
    [
      ['こんにちは', '你好'],
      ['こんにちは。', '你好。'],
      ['こんにちは！', '你好！'],
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n'
  )
  mockShared.set('さようなら？', '再见？')
  expect(extractAndEnsureSeed({ entries: true }).entries).toEqual({
    '「こんにちは。」': '「你好。」',
    '【こんにちは】': '【你好】',
    'こんにちは！': '你好！',
    'さようなら？': '再见？',
    '待って。': '',
  })
  expect(JSON.parse(fs.readFileSync(gameContentPath(mockRoot, 'seed'), 'utf8'))).toEqual({ こんにちは: '', さようなら: '', 待って: '' })
})
