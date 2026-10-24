jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: false }) }))
jest.mock('@/services/translate/engine-switches', () => ({
  getTranslateEngineSwitches: () => ({ enabled: ['google'], agents: [] }),
  TRANSLATE_ENGINE_IDS: ['google'],
  DEFAULT_ENGINE_SWITCHES: { google: true },
}))
jest.mock('@/lib/translate/engine-http', () => ({ requestGoogle: jest.fn() }))
let mockDb = ''
jest.mock('@/constants/paths', () => Object.defineProperty({ ...jest.requireActual('@/constants/paths') }, 'TRANSLATE_CACHE_DB_PATH', { get: () => mockDb }))
jest.mock('@/services/translate/shared-cache', () => {
  const actual = jest.requireActual('@/services/translate/shared-cache')
  return { ...actual, openSharedCache: () => actual.openOwnedSharedCache(mockDb) }
})
jest.mock('@/services/translate/shared-cache/db', () => {
  const actual = jest.requireActual('@/services/translate/shared-cache/db')
  return { ...actual, defaultSharedDbPath: () => mockDb }
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { requestGoogle } from '@/lib/translate/engine-http'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { createScheduledSeedSession } from '@/services/translate/scheduler/seed-session'
import { openSharedCache } from '@/services/translate/shared-cache'

beforeAll(() => execFileSync(process.execPath, ['services/translate/build.mjs'], { cwd: process.cwd(), stdio: 'pipe' }))

it('fills a real seed with a real cache worker, persists each success and counts each task once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-scheduled-fill-'))
  const root = path.join(dir, 'game')
  mockDb = path.join(dir, 'cache.sqlite')
  const file = gameContentPath(root, 'seed')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Array.from({ length: 50 }, (_, id) => [`Greeting${id}`, '']))))
  const cache = openSharedCache()
  cache.writeMany([['Greeting0', '人工定稿']], 'manual', { from: 'en', to: 'zh' })
  cache.close()
  jest.mocked(requestGoogle).mockImplementation(async (_fetch, text) => `译文${text.match(/\d+/)?.[0] || ''}`)
  const trace = jest.fn()
  const onItem = jest.fn()
  const session = createScheduledSeedSession(root, trace)
  try {
    let rounds = 0
    for (;;) {
      const result = await session.fill({ limit: 8, maxChars: 3000, onItem })
      if ((!result.missing && !result.pendingResults) || !result.scanned) break
      if (++rounds > 100) throw new Error('Scheduler failed to drain')
    }
    expect(session.progress).toMatchObject({ done: 50, missing: 0 })
    expect(session.processed).toBe(50)
    expect(onItem).toHaveBeenCalledTimes(50)
    expect(new Set(onItem.mock.calls.map(([item]) => item.src)).size).toBe(50)
    expect(jest.mocked(requestGoogle).mock.calls.length).toBeLessThanOrEqual(50)
    const saved = openSharedCache()
    expect(saved.get('Greeting0', { from: 'en', to: 'zh' })).toBe('人工定稿')
    expect(saved.get('Greeting49', { from: 'en', to: 'zh' })).toBe('译文49')
    saved.close()
    expect(trace.mock.calls.some(([message]) => message.startsWith('Scheduler progress:'))).toBe(true)
    expect(loadGameTranslationRecords(root).find((record) => record.src === 'Greeting0')?.zh).toBe('人工定稿')
    session.pause()
    await session.close()
    jest.mocked(requestGoogle).mockClear()
    const resumed = createScheduledSeedSession(root)
    try {
      expect(resumed.progress).toMatchObject({ done: 50, missing: 0 })
      expect((await resumed.fill({ limit: 8 })).scanned).toBe(0)
      expect(requestGoogle).not.toHaveBeenCalled()
    } finally {
      await resumed.close()
    }
    const edited = openSharedCache()
    edited.remove('Greeting49', { from: 'en', to: 'zh' })
    edited.close()
    const afterDeletion = createScheduledSeedSession(root)
    try {
      expect(afterDeletion.progress).toMatchObject({ done: 49, missing: 1 })
    } finally {
      await afterDeletion.close()
    }
  } finally {
    session.pause()
    await session.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}, 20000)
