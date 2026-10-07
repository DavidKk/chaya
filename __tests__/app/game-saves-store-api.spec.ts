import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { POST } from '@/app/api/game-saves/store/route'

let dataDir = ''

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode', () => ({ requireDisk: () => null }))
jest.mock('@/lib/game/toolkit-data', () => ({ toolkitDataDir: () => dataDir }))

const ctx = { params: Promise.resolve({}) }

async function post(body: Record<string, unknown>) {
  const response = await POST(new Request('http://localhost/api/game-saves/store', { method: 'POST', body: JSON.stringify({ gameId: 'lib-1', ...body }) }), ctx)
  return { status: response.status, json: await response.json() }
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-game-saves-store-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('stores entries and the index under the Chaya data folder per game', async () => {
  expect((await post({ op: 'readIndex' })).json.index).toBeNull()
  const data = Buffer.from([1, 2, 3]).toString('base64')
  expect((await post({ op: 'writeEntry', list: 'quick', id: 'quick-2', data, thumb: 'data:image/jpeg;base64,AA==' })).status).toBe(200)
  await post({ op: 'writeIndex', index: { version: 1, revision: 1, entries: [] } })
  expect(fs.existsSync(path.join(dataDir, 'game-saves', 'games', 'lib-1', 'quick', 'quick-2.rpgsave.gz'))).toBe(true)
  expect((await post({ op: 'readEntry', list: 'quick', id: 'quick-2' })).json.data).toBe(data)
  expect((await post({ op: 'readThumb', list: 'quick', id: 'quick-2' })).json.thumb).toBe('data:image/jpeg;base64,AA==')
  expect((await post({ op: 'listEntries', list: 'quick' })).json.ids).toEqual(['quick-2'])
  expect((await post({ op: 'readIndex' })).json.index).toEqual({ version: 1, revision: 1, entries: [] })
  await post({ op: 'removeEntry', list: 'quick', id: 'quick-2' })
  expect((await post({ op: 'listEntries', list: 'quick' })).json.ids).toEqual([])
})

test('rejects entry ids that could escape the game folder', async () => {
  expect((await post({ op: 'readEntry', list: 'quick', id: '../../settings' })).json.ok).toBe(false)
  expect((await post({ op: 'writeEntry', list: 'auto', id: 'quick-1', data: '' })).json.ok).toBe(false)
  await post({ op: 'readIndex', gameId: '../outside' })
  expect(fs.readdirSync(dataDir)).toEqual([])
})

test('answers 400 for bad entry ids and 404 for missing entry content', async () => {
  expect((await post({ op: 'readEntry', list: 'quick' })).status).toBe(400)
  expect((await post({ op: 'removeEntry', list: 'auto', id: 'quick-1' })).status).toBe(400)
  const missing = await post({ op: 'readEntry', list: 'quick', id: 'quick-3' })
  expect(missing.status).toBe(404)
  expect(JSON.stringify(missing.json)).not.toContain(dataDir)
})

test('treats a corrupt index as empty and keeps a copy instead of failing every read', async () => {
  const dir = path.join(dataDir, 'game-saves', 'games', 'lib-1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.json'), '{"version":1,')
  const read = await post({ op: 'readIndex' })
  expect(read.status).toBe(200)
  expect(read.json.index).toBeNull()
  expect(fs.readdirSync(dir).some((name) => name.startsWith('index.json.corrupt-'))).toBe(true)
})

test('refuses an index without an entries list instead of wiping the saved one', async () => {
  await post({ op: 'writeIndex', index: { version: 1, revision: 3, entries: [] } })
  expect((await post({ op: 'writeIndex' })).status).toBe(400)
  expect((await post({ op: 'writeIndex', index: { version: 1 } })).status).toBe(400)
  expect((await post({ op: 'readIndex' })).json.index).toEqual({ version: 1, revision: 3, entries: [] })
})
