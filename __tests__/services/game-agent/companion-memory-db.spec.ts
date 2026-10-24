import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { companionEpisodes, companionManifest, openCompanionMemoryDb } from '@/services/game-agent/companion-memory-db'

describe('companion-memory-db', () => {
  let tmpDbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-db-test-'))
    tmpDbPath = path.join(tmpDir, 'companion.sqlite')
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('initializes schema and allows inserting and querying episodes', () => {
    const { db } = openCompanionMemoryDb(tmpDbPath)

    db.insert(companionManifest)
      .values({
        gameId: 'game-1',
        schemaVersion: 1,
        generation: 1,
        memoryEpoch: 1,
        recordingRevision: 1,
        recordingEnabled: 1,
        usedBytes: 100,
        updatedAt: 1729760000000,
      })
      .run()

    const manifest = db.select().from(companionManifest).where(eq(companionManifest.gameId, 'game-1')).get()
    expect(manifest?.generation).toBe(1)

    db.insert(companionEpisodes)
      .values({
        id: 'ep-1',
        gameId: 'game-1',
        kind: 'combat',
        persistence: 'committed',
        completeness: 'full',
        dataJson: JSON.stringify({ summary: 'Defeated boss' }),
        bytes: 50,
        createdAt: 1729760000000,
      })
      .run()

    const episodes = db.select().from(companionEpisodes).where(eq(companionEpisodes.gameId, 'game-1')).all()
    expect(episodes).toHaveLength(1)
    expect(episodes[0].id).toBe('ep-1')
  })
})
