import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import type { MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { openCompanionMemoryDb } from '@/services/game-agent/companion-memory-db'
import { migrateCompanionMemory } from '@/services/storage/migration/companion-migrator.server'

describe('companion-migrator real legacy format', () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-companion-mig-'))
  })
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('replays a checkpoint and journal, retaining scope and non-episode collections', async () => {
    const gameId = 'legacy-game'
    const memoryRoot = path.join(tmpDir, 'legacy')
    const gameDir = path.join(memoryRoot, createHash('sha256').update(gameId).digest('hex'))
    fs.mkdirSync(path.join(gameDir, 'batches'), { recursive: true })
    const snapshot = emptyMemorySnapshot()
    snapshot.generation = 2
    snapshot.preferences.push({ libraryGameId: gameId, source: 'user_settings', key: 'tone', value: 'quiet', revision: 1, updatedAt: 100 })
    fs.writeFileSync(path.join(gameDir, 'checkpoint.gen-2.json'), JSON.stringify(snapshot))
    fs.writeFileSync(
      path.join(gameDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        generation: 2,
        memoryEpoch: 1,
        recordingRevision: 1,
        recordingEnabled: true,
        checkpoint: 'checkpoint.gen-2.json',
        appliedBatches: {},
        usedBytes: 0,
      })
    )
    const scope = { libraryGameId: gameId, dataRevision: 'r1', playthroughId: 'p1', segmentId: 's1', runtimeInstanceId: 'runtime1' }
    const batch: MemoryWriteBatch = {
      schemaVersion: 1,
      batchId: 'journal-only',
      memoryEpoch: 1,
      recordingRevision: 1,
      at: 200,
      episodes: [
        {
          episodeId: 'ep1',
          scope,
          at: 200,
          kind: 'battle_result',
          persistence: 'committed',
          completeness: 'complete_for_claim',
          summary: 'Won',
          evidence: [],
          memoryEpoch: 1,
          outcome: 'win',
        },
      ],
    }
    fs.writeFileSync(path.join(gameDir, 'batches', '0000000000000200-batch.json'), JSON.stringify(batch))
    const { db } = openCompanionMemoryDb(path.join(tmpDir, 'companion.sqlite'))
    try {
      const result = await migrateCompanionMemory(db, memoryRoot, { gameIds: [gameId] })
      expect(result).toMatchObject({ gamesMigrated: 1, episodesImported: 1, batchesImported: 1 })
      const full = db.$client.prepare('SELECT snapshot_json FROM companion_legacy_imports WHERE game_id = ?').get(gameId) as { snapshot_json: string }
      expect(JSON.parse(full.snapshot_json)).toMatchObject({ preferences: snapshot.preferences, episodes: [{ episodeId: 'ep1', scope }] })
      expect((await migrateCompanionMemory(db, memoryRoot, { gameIds: [gameId] })).gamesMigrated).toBe(0)
      expect(fs.existsSync(path.join(gameDir, 'batches', '0000000000000200-batch.json'))).toBe(true)
    } finally {
      db.$client.close()
    }
  })
})
