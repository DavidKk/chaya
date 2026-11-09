import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { openCompanionMemoryDb } from '@/services/game-agent/companion-memory-db'
import { createCompanionSqliteStore } from '@/services/storage/companion-store'

it('persists every memory collection, rejects conflicting retries and enforces evidence foreign keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-memory-sqlite-'))
  const file = path.join(root, 'companion.sqlite')
  let connection = openCompanionMemoryDb(file)
  const scope = { libraryGameId: 'game-a', dataRevision: 'r1', playthroughId: 'p1', segmentId: 's1', runtimeInstanceId: 'runtime1' }
  const batch: MemoryWriteBatch = {
    schemaVersion: 1,
    batchId: 'all-collections',
    memoryEpoch: 1,
    recordingRevision: 1,
    at: 100,
    episodes: [
      {
        episodeId: 'ep1',
        scope,
        at: 100,
        kind: 'battle_result',
        persistence: 'committed',
        completeness: 'complete_for_claim',
        summary: 'Won',
        evidence: [],
        memoryEpoch: 1,
        outcome: 'win',
      },
    ],
    evidence: [
      { episodeId: 'ep1', scope, sourceRefs: ['source-1'], completeness: 'complete_for_claim', persistence: 'committed', summary: 'Battle result', evidence: [], memoryEpoch: 1 },
    ],
    preferences: [{ libraryGameId: 'game-a', source: 'user_settings', key: 'verbosity', value: 'quiet', revision: 1, updatedAt: 100 }],
    saveLinks: [{ id: 'save1', scope, origin: 'native', slot: 1, at: 100, memoryEpoch: 1 }],
    projections: [{ key: scope, encounters: 1, defeats: 0, knockouts: 0, victories: 1, memoryEpoch: 1, updatedAt: 100 }],
  }
  try {
    let store = createCompanionSqliteStore(connection.db)
    expect(store.commit('game-a', batch)).toMatchObject({ ok: true, duplicated: false })
    expect(store.commit('game-a', batch)).toMatchObject({ duplicated: true })
    expect(() => store.commit('game-a', { ...batch, setRecording: false })).toThrow('conflict')
    connection.db.$client.close()
    connection = openCompanionMemoryDb(file)
    store = createCompanionSqliteStore(connection.db)
    const snapshot = store.load('game-a')
    expect(snapshot.episodes).toHaveLength(1)
    expect(snapshot.evidence).toHaveLength(1)
    expect(snapshot.preferences).toHaveLength(1)
    expect(snapshot.saveLinks).toHaveLength(1)
    expect(snapshot.projections).toHaveLength(1)
    connection.db.$client.prepare('DELETE FROM companion_episodes WHERE game_id=?').run('game-a')
    expect(connection.db.$client.prepare('SELECT COUNT(*) AS n FROM companion_evidence').get()).toMatchObject({ n: 0 })
    const generation = store.load('game-a').generation
    expect(() => store.commit('game-a', { ...batch, batchId: 'invalid-scope', episodes: [{ ...batch.episodes![0], scope: { ...scope, libraryGameId: 'game-b' } }] })).toThrow()
    expect(store.load('game-a').generation).toBe(generation)
    expect(connection.db.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    connection.db.$client.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('supports incremental updates and range queries without dropping full episodes (F02)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-memory-inc-'))
  const file = path.join(root, 'companion.sqlite')
  const connection = openCompanionMemoryDb(file)
  const scope = { libraryGameId: 'game-inc', dataRevision: 'r1', playthroughId: 'p1', segmentId: 's1', runtimeInstanceId: 'runtime1' }
  const store = createCompanionSqliteStore(connection.db)

  try {
    // Batch 1
    store.commit('game-inc', {
      schemaVersion: 1,
      batchId: 'batch-1',
      memoryEpoch: 1,
      recordingRevision: 1,
      at: 100,
      episodes: [
        {
          episodeId: 'ep-1',
          scope,
          at: 100,
          kind: 'milestone',
          persistence: 'committed',
          completeness: 'complete_for_claim',
          summary: 'Milestone 1',
          evidence: [],
          memoryEpoch: 1,
        },
      ],
    })

    // Batch 2 (incremental append of ep-2)
    store.commit('game-inc', {
      schemaVersion: 1,
      batchId: 'batch-2',
      memoryEpoch: 1,
      recordingRevision: 1,
      at: 200,
      episodes: [
        {
          episodeId: 'ep-2',
          scope,
          at: 200,
          kind: 'milestone',
          persistence: 'committed',
          completeness: 'complete_for_claim',
          summary: 'Milestone 2',
          evidence: [],
          memoryEpoch: 1,
        },
      ],
    })

    // Both episodes exist in DB
    const qAll = store.query('game-inc')
    expect(qAll.total).toBe(2)
    expect(qAll.items).toHaveLength(2)

    // Range pagination
    const qPage1 = store.query('game-inc', { limit: 1 })
    expect(qPage1.items).toHaveLength(1)
    expect(qPage1.items[0].episodeId).toBe('ep-2')
    expect(qPage1.nextCursor).not.toBeNull()

    const qPage2 = store.query('game-inc', { limit: 1, cursor: qPage1.nextCursor! })
    expect(qPage2.items).toHaveLength(1)
    expect(qPage2.items[0].episodeId).toBe('ep-1')
    expect(qPage2.nextCursor).toBeNull()
  } finally {
    connection.db.$client.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
