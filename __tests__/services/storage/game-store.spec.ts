jest.mock('wordguard', () => ({
  wordguard: () => ({
    matchAll: () => [],
  }),
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { GAME_CONTENT_RELS } from '@/lib/game/content-paths'
import { createPublicGameStore } from '@/services/storage/game-store'
import type { SharedCacheDb } from '@/services/translate/shared-cache/db'
import { openSharedCacheDb } from '@/services/translate/shared-cache/db'

describe('game-store decoupled view materialization (F03)', () => {
  let tmpDir: string
  let sharedDb: SharedCacheDb
  let store: ReturnType<typeof createPublicGameStore>
  let gameRoot: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-game-store-test-'))
    gameRoot = path.join(tmpDir, 'game')
    fs.mkdirSync(gameRoot, { recursive: true })
    // Create a mock Game.rpgproject so mount recognizes it
    fs.writeFileSync(path.join(gameRoot, 'Game.rpgproject'), '')

    const { db } = openSharedCacheDb(path.join(tmpDir, 'shared.sqlite'))
    sharedDb = db
    store = createPublicGameStore(sharedDb, tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('decouples companionTranscript writes from translation file views', async () => {
    const mounted = await store.mount(gameRoot)
    expect(mounted.directory).toBeDefined()

    // Initial mount creates public views
    const cacheFile = path.join(mounted.directory, GAME_CONTENT_RELS.cacheNdjson)
    expect(fs.existsSync(cacheFile)).toBe(true)
    const cacheStatBefore = fs.statSync(cacheFile)

    // Write companionTranscript (chat message)
    const transcript = { messages: [{ id: '1', role: 'chaya', text: 'hello' }], activity: [] }
    const res = await store.write(gameRoot, 'companionTranscript', transcript)
    expect(res).toEqual({ ok: true, committed: true, viewStatus: 'ready' })

    // Document is readable from db
    const readDoc = await store.read(gameRoot, 'companionTranscript')
    expect(readDoc).toEqual(transcript)

    // cache.ndjson should NOT have been re-written or touched
    const cacheStatAfter = fs.statSync(cacheFile)
    expect(cacheStatAfter.mtimeMs).toBe(cacheStatBefore.mtimeMs)
  })

  it('only materializes the specific dirty document when writing game documents', async () => {
    const mounted = await store.mount(gameRoot)
    const cacheFile = path.join(mounted.directory, GAME_CONTENT_RELS.cacheNdjson)
    const cacheStatBefore = fs.statSync(cacheFile)

    // Write gameEdit document
    const editConfig = { enabled: true, test: 123 }
    const res = await store.write(gameRoot, 'gameEdit', editConfig)
    expect(res).toEqual({ ok: true, committed: true, viewStatus: 'ready' })

    // game-edit.json view was updated
    const editFile = path.join(mounted.directory, GAME_CONTENT_RELS.gameEdit)
    expect(fs.existsSync(editFile)).toBe(true)
    expect(JSON.parse(fs.readFileSync(editFile, 'utf8'))).toEqual(editConfig)

    // cache.ndjson was NOT touched
    const cacheStatAfter = fs.statSync(cacheFile)
    expect(cacheStatAfter.mtimeMs).toBe(cacheStatBefore.mtimeMs)
  })
})
