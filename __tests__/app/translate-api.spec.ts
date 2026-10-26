jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { POST } from '@/app/api/translate/route.server'
import { resolveGame } from '@/lib/game'
import { hasManagementAccess } from '@/services/access/management'
import { getTranslateEngineSwitches, setTranslateEngineSwitches } from '@/services/disk-ops'
import { loadRgssTranslationItems, writeRgssTranslations } from '@/services/extract/lib/rgss'
import { resetListExtractForTests } from '@/services/extract/list-extract-prepare'
import { peekLaunchToken } from '@/services/runtime/launch-token'
import { agentJaToZh, listTranslateAgents } from '@/services/translate/agent-translate'
import { getSeedSourceLanguage, resolveTranslateContentRoot } from '@/services/translate/fill-missing'
import { bergamotTranslator } from '@/services/translate/lib/bergamot-translate'
import { appleTranslate, appleTranslator } from '@/services/translate/lib/macos-translate'
import { setTranslationPlaySettings } from '@/services/translate/play-settings'
import { translateDialogue } from '@/services/translate/realtime'

jest.mock('@/services/access/api', () => ({ mayAccessApi: jest.fn(async () => true) }))
jest.mock('@/services/access/management', () => ({ hasManagementAccess: jest.fn() }))
jest.mock('@/services/runtime/launch-token', () => ({ peekLaunchToken: jest.fn() }))
jest.mock('@/lib/game', () => ({ resolveGame: jest.fn() }))
jest.mock('@/services/extract/lib/rgss', () => ({ loadRgssTranslationItems: jest.fn(), writeRgssTranslations: jest.fn() }))
jest.mock('@/services/disk-ops', () => ({ requireDisk: () => null, getTranslateEngineSwitches: jest.fn(), setTranslateEngineSwitches: jest.fn() }))
jest.mock('@/services/translate/fill-missing', () => ({ resolveTranslateContentRoot: jest.fn(), getSeedSourceLanguage: jest.fn() }))
jest.mock('@/services/translate/play-settings', () => ({ getTranslationPlaySettings: jest.fn(), setTranslationPlaySettings: jest.fn() }))
jest.mock('@/services/translate/realtime', () => ({ translateDialogue: jest.fn(), benchmarkLocalModel: jest.fn() }))
jest.mock('@/services/translate/agent-translate', () => ({ agentJaToZh: jest.fn(), listTranslateAgents: jest.fn() }))
jest.mock('@/services/translate/lib/bergamot-translate', () => ({ bergamotTranslator: { translate: jest.fn(), checkStatus: jest.fn() } }))
jest.mock('@/services/translate/lib/macos-translate', () => ({ appleTranslate: jest.fn(), appleTranslator: { checkStatus: jest.fn() } }))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
let mockCacheFile = ''
jest.mock('@/constants/paths', () => Object.defineProperty({ ...jest.requireActual('@/constants/paths') }, 'TRANSLATE_CACHE_DB_PATH', { get: () => mockCacheFile }))

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chaya-Launch-Token': 'game-A-token' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )

beforeEach(() => {
  mockCacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-translate-api-')), 'shared.sqlite')
  resetListExtractForTests()
  jest.mocked(resolveTranslateContentRoot).mockReturnValue('/games/B')
})

afterEach(() => fs.rmSync(path.dirname(mockCacheFile), { recursive: true, force: true }))

it('loads RGSS rows with their engine and bound root in the same response', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(resolveGame).mockReturnValue({ ok: true, contentRoot: '/games/B', engine: 'VX Ace' } as ReturnType<typeof resolveGame>)
  jest.mocked(loadRgssTranslationItems).mockReturnValue([])
  const response = await post({ mode: 'extract-items' })
  expect(await response.json()).toMatchObject({ ok: true, items: [], engine: 'VX Ace', contentRoot: '/games/B', locales: { availableLanguages: expect.any(Array) } })
})

it('rejects RGSS saves from a previously selected game', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  const response = await post({ mode: 'rgss-write', contentRoot: '/games/A', translations: { Hello: '你好' } })
  expect(response.status).toBe(409)
  expect((await response.json()).error.code).toBe('GAME_CHANGED')
  expect(writeRgssTranslations).not.toHaveBeenCalled()
})

it('accepts RGSS saves when contentRoot matches current game', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(resolveGame).mockReturnValue({ ok: true, contentRoot: '/games/B', engine: 'VX Ace' } as ReturnType<typeof resolveGame>)
  jest.mocked(writeRgssTranslations).mockReturnValue({ count: 1, backupCreated: false } as any)
  const response = await post({ mode: 'rgss-write', contentRoot: '/games/B', translations: { Hello: '你好' } })
  expect(response.status).toBe(200)
  expect(writeRgssTranslations).toHaveBeenCalledWith('/games/B', { Hello: '你好' })
})

it('reports unavailable encrypted RGSS data as a recoverable conflict', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(resolveGame).mockReturnValue({ ok: true, contentRoot: '/games/B', engine: 'VX Ace' } as ReturnType<typeof resolveGame>)
  jest.mocked(loadRgssTranslationItems).mockImplementationOnce(() => {
    throw new Error('Unpack Data first')
  })
  const response = await post({ mode: 'extract-items' })
  expect(response.status).toBe(409)
  expect((await response.json()).error).toMatchObject({ code: 'RGSS_DATA_UNAVAILABLE', message: 'Unpack Data first' })
})

it('reports failed RGSS writes instead of acknowledging a save', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(resolveGame).mockReturnValue({ ok: true, contentRoot: '/games/B', engine: 'VX' } as ReturnType<typeof resolveGame>)
  jest.mocked(writeRgssTranslations).mockImplementationOnce(() => {
    throw new Error('RGSS source not found')
  })
  const response = await post({ mode: 'rgss-write', contentRoot: '/games/B', translations: { Hello: '你好' } })
  expect(response.status).toBe(409)
  expect((await response.json()).error).toMatchObject({ code: 'RGSS_WRITE_FAILED', message: 'RGSS source not found' })
})

it('translates the launch credential game even when the console is bound to another game', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(false)
  jest.mocked(peekLaunchToken).mockReturnValue({ token: 'game-A-token', gameRoot: '/games/A' } as ReturnType<typeof peekLaunchToken>)
  jest.mocked(resolveGame).mockReturnValue({ ok: true, contentRoot: '/games/A/www', remote: false } as ReturnType<typeof resolveGame>)
  jest.mocked(translateDialogue).mockResolvedValue({ items: [], contentRoot: '/games/A/www', engines: ['ollama'], elapsedMs: 10 })
  const response = await post({ mode: 'realtime', texts: ['こんにちは'], contentRoot: '/games/B' })
  expect(response.status).toBe(200)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(translateDialogue).toHaveBeenCalledWith('/games/A/www', ['こんにちは'], expect.any(AbortSignal))
})

it('rejects stale setting saves after the selected game changes', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  const response = await post({ mode: 'play-settings', contentRoot: '/games/A', settings: { mode: 'realtime' } })
  expect(response.status).toBe(409)
  expect((await response.json()).error.code).toBe('GAME_CHANGED')
  expect(setTranslationPlaySettings).not.toHaveBeenCalled()
})

it('ai mode translates one text with the chosen agent instance', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(agentJaToZh).mockResolvedValue('你好')
  const response = await post({ mode: 'ai', text: 'こんにちは', ai: { profileId: ' p1 ', model: 'm1', extra: 1 }, interactive: true })
  expect(response.status).toBe(200)
  expect((await response.json()).text).toBe('你好')
  expect(agentJaToZh).toHaveBeenCalledWith('こんにちは', { profileId: 'p1', model: 'm1' }, { interactive: true, signal: expect.any(AbortSignal) })
})

it('ai mode rejects empty text', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(agentJaToZh).mockClear()
  const response = await post({ mode: 'ai', text: '   ' })
  expect(response.status).toBe(400)
  expect(agentJaToZh).not.toHaveBeenCalled()
})

it('bergamot mode forwards the text and language pair to the offline daemon', async () => {
  jest.mocked(bergamotTranslator.translate).mockResolvedValue('你好')
  const response = await post({ mode: 'bergamot', text: 'Hello', from: 'en', to: 'zh' })
  expect(response.status).toBe(200)
  expect((await response.json()).text).toBe('你好')
  expect(bergamotTranslator.translate).toHaveBeenCalledWith('Hello', { source: 'en', target: 'zh' })
})

it.each(['', '   ', 'x'.repeat(20001)])('bergamot mode validates text length', async (text) => {
  const response = await post({ mode: 'bergamot', text })
  expect(response.status).toBe(400)
  expect(bergamotTranslator.translate).not.toHaveBeenCalled()
})

it('bergamot-status reports missing packs without translating', async () => {
  jest.mocked(bergamotTranslator.checkStatus).mockResolvedValue({ status: 'model_pack_missing', installed: false })
  const response = await post({ mode: 'bergamot-status', source: 'ja', target: 'zh' })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'model_pack_missing', installed: false })
  expect(bergamotTranslator.checkStatus).toHaveBeenCalledWith('ja', 'zh')
  expect(bergamotTranslator.translate).not.toHaveBeenCalled()
})

it('agents mode lists instances without endpoints or tokens', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(listTranslateAgents).mockReturnValue({ profiles: [{ id: 'p1', label: 'GPU', defaultModel: 'qwen' }], models: {} })
  const response = await post({ mode: 'agents' })
  expect(response.status).toBe(200)
  expect((await response.json()).profiles).toEqual([{ id: 'p1', label: 'GPU', defaultModel: 'qwen' }])
})

it('cache mode returns cached translation or miss', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  const response = await post({ mode: 'cache', text: '道具' })
  const data = await response.json()
  expect({ status: response.status, error: data.error }).toEqual({ status: 200, error: undefined })
  expect(data.ok).toBe(true)
  expect(Array.isArray(data.items)).toBe(true)
})

it('cache mode rejects empty text', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  const response = await post({ mode: 'cache', text: '   ' })
  expect(response.status).toBe(400)
  expect((await response.json()).error.code).toBe('TRANSLATE_CACHE_INPUT')
})

it('checks Apple readiness without requiring translation text', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(appleTranslator.checkStatus).mockResolvedValue({ status: 'installed', installed: true })
  const response = await post({ mode: 'apple-status', from: 'en', to: 'zh-Hans' })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ installed: true })
  expect(appleTranslator.checkStatus).toHaveBeenCalledWith('en', 'zh-Hans')
})

it('detects English for native translation when no source language is specified', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(appleTranslate).mockResolvedValue('你好')
  expect((await post({ mode: 'apple', text: 'Hello, welcome to the city.' })).status).toBe(200)
  expect(appleTranslate).toHaveBeenCalledWith('Hello, welcome to the city.', { source: 'en', target: 'zh-Hans' })
})

it('rejects enabling an unavailable native engine without changing other switches', async () => {
  jest.mocked(getTranslateEngineSwitches).mockReturnValue({ switches: { apple: false } } as ReturnType<typeof getTranslateEngineSwitches>)
  jest.mocked(getSeedSourceLanguage).mockReturnValue('en')
  jest.mocked(appleTranslator.checkStatus).mockResolvedValue({ installed: false, status: 'supported', message: 'Language pack missing' })
  const response = await post({ mode: 'switches', switches: { apple: true } })
  expect(response.status).toBe(409)
  expect((await response.json()).error.code).toBe('TRANSLATE_ENGINE_NOT_READY')
  expect(setTranslateEngineSwitches).not.toHaveBeenCalled()
})

it.each(['plan', 'status', 'install', 'cancel'])('requires management access for Bergamot pack %s', async (action) => {
  jest.mocked(hasManagementAccess).mockReturnValue(false)
  const response = await post({ mode: 'bergamot-packs', action, from: 'en', to: 'zh', planId: 'anything', jobId: 'anything' })
  expect(response.status).toBe(403)
  expect((await response.json()).error.code).toBe('MANAGEMENT_REQUIRED')
})
