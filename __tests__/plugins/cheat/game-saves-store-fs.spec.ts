import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let root = ''

jest.mock('@/plugins/src/helpers/node/node-require', () => ({
  tryNodeRequire: () => require,
  tryNodeFsPath: () => ({ fs: jest.requireActual('node:fs'), path: jest.requireActual('node:path') }),
}))
jest.mock('@/plugins/src/helpers/game/game-identity', () => ({ detectGameIdentity: () => ({ contentRoot: root }) }))

import { createGameSavesBackend, gunzipText, gzipText } from '@/plugins/src/cheat/game-saves/store'

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-saves-'))
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const THUMB = 'data:image/jpeg;base64,/9j/AA=='

it('round-trips gzip text', async () => {
  expect(await gunzipText(await gzipText('{"a":"存档"}'))).toBe('{"a":"存档"}')
})

it('stores entries, thumbnails, settings and the index under the game folder', async () => {
  const backend = createGameSavesBackend('room')
  expect(backend.kind).toBe('fs')
  const data = await gzipText('{"state":"A"}')
  await backend.writeEntry('auto', 'auto-1', data, THUMB)
  await backend.writeSettings({ enabled: true })
  await backend.writeIndex({ version: 1, revision: 3, entries: [] })

  expect(await gunzipText(await backend.readEntry('auto', 'auto-1'))).toBe('{"state":"A"}')
  expect(await backend.readThumb('auto', 'auto-1')).toBe(THUMB)
  expect(await backend.readSettings()).toEqual({ enabled: true })
  expect(await backend.readIndex()).toEqual({ version: 1, revision: 3, entries: [] })
  expect(await backend.listEntries('auto')).toEqual(['auto-1'])
  expect(await backend.listEntries('quick')).toEqual([])

  await backend.writeEntry('auto', 'auto-1', data, null)
  expect(await backend.readThumb('auto', 'auto-1')).toBeNull()
  await backend.removeEntry('auto', 'auto-1')
  expect(await backend.listEntries('auto')).toEqual([])
  await expect(backend.readEntry('auto', 'auto-1')).rejects.toThrow()
})

it('treats a missing index as empty but keeps a copy of a corrupt one', async () => {
  const backend = createGameSavesBackend('room')
  expect(await backend.readIndex()).toBeNull()
  await backend.writeIndex({ version: 1, revision: 1, entries: [] })
  const indexDir = fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .find((f) => f.endsWith('index.json'))!
  fs.writeFileSync(path.join(root, indexDir), '{broken')
  expect(await backend.readIndex()).toBeNull()
  expect(fs.readdirSync(path.dirname(path.join(root, indexDir))).some((f) => f.startsWith('index.json.corrupt-'))).toBe(true)
})

it('cleans up leftover temp files when listing', async () => {
  const backend = createGameSavesBackend('room')
  await backend.writeEntry('quick', 'quick-1', await gzipText('x'), null)
  const dir = path.dirname(
    fs
      .readdirSync(root, { recursive: true })
      .map((f) => path.join(root, String(f)))
      .find((f) => f.endsWith('.rpgsave.gz'))!
  )
  fs.writeFileSync(path.join(dir, 'quick-2.rpgsave.gz.tmp'), 'partial')
  expect(await backend.listEntries('quick')).toEqual(['quick-1'])
  expect(fs.readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false)
})
