import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { GET, PUT } from '@/app/api/game-saves/settings/route'
import { DEFAULT_GAME_SAVES_SETTINGS, type GameSavesSettings } from '@/lib/game/game-saves'

let dataDir = ''

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode', () => ({ requireDisk: () => null }))
jest.mock('@/lib/game/toolkit-data', () => ({ toolkitDataDir: () => dataDir }))

const ctx = { params: Promise.resolve({}) }

function put(settings: unknown, expectedRevision = 0) {
  return PUT(new Request('http://localhost/api/game-saves/settings', { method: 'PUT', body: JSON.stringify({ settings, expectedRevision }) }), ctx)
}

async function stored(): Promise<GameSavesSettings> {
  const response = await GET(new Request('http://localhost/api/game-saves/settings'), ctx)
  return (await response.json()).settings
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-game-saves-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('starts from defaults and saves without any game connected', async () => {
  expect(await stored()).toEqual(DEFAULT_GAME_SAVES_SETTINGS)
  expect((await put({ ...DEFAULT_GAME_SAVES_SETTINGS, revision: 1, enabled: true, quickEnabled: true })).status).toBe(200)
  expect(await stored()).toEqual(expect.objectContaining({ revision: 1, enabled: true, quickEnabled: true }))
})

test('adopts a newer revision from a game in one step but rejects stale writes', async () => {
  expect((await put({ ...DEFAULT_GAME_SAVES_SETTINGS, revision: 7, maxCount: 60 })).status).toBe(200)
  const stale = await put({ ...DEFAULT_GAME_SAVES_SETTINGS, revision: 8 }, 0)
  expect(stale.status).toBe(400)
  expect((await stale.json()).error.code).toBe('REVISION_CONFLICT')
  expect((await put({ ...DEFAULT_GAME_SAVES_SETTINGS, revision: 7 }, 7)).status).toBe(400)
  expect(await stored()).toEqual(expect.objectContaining({ revision: 7, maxCount: 60 }))
})

test('moves a corrupt settings file aside and serves defaults', async () => {
  const dir = path.join(dataDir, 'game-saves')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'settings.json'), '{broken')
  expect(await stored()).toEqual(DEFAULT_GAME_SAVES_SETTINGS)
  expect(fs.readdirSync(dir).filter((f) => f.startsWith('settings.json.corrupt-'))).toHaveLength(1)
  expect((await put({ ...DEFAULT_GAME_SAVES_SETTINGS, revision: 1, enabled: true })).status).toBe(200)
  expect(await stored()).toEqual(expect.objectContaining({ revision: 1, enabled: true }))
})

test('rejects out-of-range values', async () => {
  expect((await put({ ...DEFAULT_GAME_SAVES_SETTINGS, revision: 1, maxCount: 5 })).status).toBe(400)
  expect(await stored()).toEqual(DEFAULT_GAME_SAVES_SETTINGS)
})
