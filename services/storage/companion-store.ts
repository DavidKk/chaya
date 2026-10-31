import { createHash } from 'node:crypto'

import { recordingFingerprint, validateMemoryManagement } from '@/lib/game-agent/companion/core/recording-schema'
import type { MemoryManagementRequest, MemoryManagementState } from '@/lib/game-agent/companion/core/recording-types'
import { applyWriteBatch, batchFingerprint, emptyMemorySnapshot, snapshotLogicalBytes, trimSnapshotToBudgets } from '@/lib/game-agent/companion/memory-durable'
import { MEMORY_GAME_BUDGET_BYTES, MEMORY_GLOBAL_BUDGET_BYTES } from '@/lib/game-agent/companion/memory-limits'
import { MemoryConflictError, MemoryStaleError, validateWriteBatch } from '@/lib/game-agent/companion/memory-schema'
import type { MemoryStoreSnapshot, MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import type { CompanionDb } from '@/services/game-agent/companion-memory-db'

import { createCompanionRecordingStore } from './companion-recording'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function createCompanionSqliteStore(db: CompanionDb) {
  const client = db.$client
  const recording = createCompanionRecordingStore(client)
  client.exec('CREATE TABLE IF NOT EXISTS companion_snapshots (game_id TEXT PRIMARY KEY NOT NULL, snapshot_json TEXT NOT NULL)')
  function loadBase(gameId: string): MemoryStoreSnapshot {
    const row = client.prepare('SELECT snapshot_json FROM companion_snapshots WHERE game_id=?').get(gameId) as { snapshot_json: string } | undefined
    if (row) return JSON.parse(row.snapshot_json) as MemoryStoreSnapshot
    const imported = client.prepare("SELECT name FROM sqlite_master WHERE name='companion_legacy_imports'").get()
    const legacy = imported
      ? (client.prepare('SELECT snapshot_json FROM companion_legacy_imports WHERE game_id=?').get(gameId) as { snapshot_json: string } | undefined)
      : undefined
    return legacy ? (JSON.parse(legacy.snapshot_json) as MemoryStoreSnapshot) : emptyMemorySnapshot()
  }

  function load(gameId: string): MemoryStoreSnapshot {
    client.exec('BEGIN')
    try {
      const snapshot = { ...loadBase(gameId), battleRecording: recording.load(gameId) }
      client.exec('COMMIT')
      return snapshot
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
  }

  function state(gameId: string): MemoryManagementState {
    const row = client.prepare('SELECT memory_epoch,recording_revision,recording_enabled FROM companion_manifest WHERE game_id=?').get(gameId) as
      { memory_epoch: number; recording_revision: number; recording_enabled: number } | undefined
    if (row) return { memoryEpoch: row.memory_epoch, recordingRevision: row.recording_revision, recordingEnabled: row.recording_enabled === 1 }
    const snapshot = loadBase(gameId)
    return { memoryEpoch: snapshot.memoryEpoch, recordingRevision: snapshot.recordingRevision, recordingEnabled: snapshot.recordingEnabled }
  }

  function writeSnapshot(gameId: string, next: MemoryStoreSnapshot) {
    const otherBytes = Number((client.prepare('SELECT COALESCE(SUM(used_bytes),0) AS n FROM companion_manifest WHERE game_id<>?').get(gameId) as { n: number }).n)
    const used = snapshotLogicalBytes(next) + recording.bytes(gameId)
    if (used > MEMORY_GAME_BUDGET_BYTES || used + otherBytes > MEMORY_GLOBAL_BUDGET_BYTES) throw new Error('Companion recording capacity reached')
    client
      .prepare(
        `INSERT INTO companion_manifest(game_id,schema_version,generation,memory_epoch,recording_revision,recording_enabled,used_bytes,updated_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET generation=excluded.generation,memory_epoch=excluded.memory_epoch,
        recording_revision=excluded.recording_revision,recording_enabled=excluded.recording_enabled,used_bytes=excluded.used_bytes,updated_at=excluded.updated_at`
      )
      .run(gameId, next.schemaVersion, next.generation, next.memoryEpoch, next.recordingRevision, next.recordingEnabled ? 1 : 0, used, Date.now())
    client.prepare('DELETE FROM companion_episodes WHERE game_id=?').run(gameId)
    for (const ep of next.episodes) {
      const body = JSON.stringify(ep)
      client
        .prepare('INSERT INTO companion_episodes VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(hash(`${gameId}\0${ep.episodeId}`), gameId, ep.kind, ep.persistence, ep.completeness, ep.stableKey ?? null, ep.outcome ?? null, body, Buffer.byteLength(body), ep.at)
    }
    for (const [index, ev] of next.evidence.entries()) {
      const body = JSON.stringify(ev)
      client
        .prepare('INSERT INTO companion_evidence VALUES(?,?,?,?,?,?,?,?)')
        .run(hash(`${gameId}\0${ev.episodeId}\0${index}`), hash(`${gameId}\0${ev.episodeId}`), gameId, ev.summary, body, ev.memoryEpoch, Buffer.byteLength(body), Date.now())
    }
    client.prepare('INSERT INTO companion_snapshots VALUES(?,?) ON CONFLICT(game_id) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(gameId, JSON.stringify(next))
  }

  function commit(gameId: string, raw: MemoryWriteBatch) {
    const batch = validateWriteBatch(raw)
    const fingerprint = hash(batchFingerprint(batch))
    client.exec('BEGIN IMMEDIATE')
    try {
      const previous = client.prepare('SELECT fingerprint FROM companion_applied_batches WHERE game_id=? AND batch_id=?').get(gameId, batch.batchId) as
        { fingerprint: string } | undefined
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new MemoryConflictError('Memory batch id conflict')
        client.exec('COMMIT')
        return { ok: true, duplicated: true }
      }
      const otherBytes = Number((client.prepare('SELECT COALESCE(SUM(used_bytes),0) AS n FROM companion_manifest WHERE game_id<>?').get(gameId) as { n: number }).n)
      const old = loadBase(gameId)
      if (batch.clear || batch.setRecording !== undefined) throw new MemoryConflictError('Use memory management for recording and clear operations')
      if (batch.memoryEpoch !== old.memoryEpoch || batch.recordingRevision !== old.recordingRevision) throw new MemoryStaleError('Memory management version changed')
      if (
        !old.recordingEnabled &&
        (batch.battleRecording?.events.length || batch.episodes?.length || batch.evidence?.length || batch.saveLinks?.length || batch.projections?.length)
      ) {
        throw new MemoryStaleError('Recording is disabled')
      }
      // Scope binding, episode application, source de-duplication and statistics share this transaction.
      let next = applyWriteBatch(old, batch, { boundGameId: gameId === '_global' ? undefined : gameId, onConflict: 'throw', otherGamesBytes: otherBytes })
      next.generation = old.generation + 1
      recording.apply(gameId, batch.battleRecording?.events || [])
      client.prepare('INSERT INTO companion_applied_batches VALUES(?,?,?,?)').run(batch.batchId, gameId, fingerprint, Date.now())
      const retainedBytes = recording.bytes(gameId)
      next = trimSnapshotToBudgets(next, {
        gameBudgetBytes: MEMORY_GAME_BUDGET_BYTES - retainedBytes,
        globalBudgetBytes: Math.min(MEMORY_GAME_BUDGET_BYTES, MEMORY_GLOBAL_BUDGET_BYTES - otherBytes) - retainedBytes,
      })
      writeSnapshot(gameId, next)
      // Retain fingerprints: an offline client may replay an old batch after a long absence.
      client.exec('COMMIT')
      return { ok: true, duplicated: false }
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
  }

  function manage(gameId: string, raw: MemoryManagementRequest): MemoryManagementState {
    const request = validateMemoryManagement(raw)
    const fingerprint = hash(recordingFingerprint(request))
    client.exec('BEGIN IMMEDIATE')
    try {
      const previous = client.prepare('SELECT fingerprint,state_json FROM companion_management WHERE game_id=? AND request_id=?').get(gameId, request.requestId) as
        { fingerprint: string; state_json: string } | undefined
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new MemoryConflictError('Memory management request id conflict')
        client.exec('COMMIT')
        return JSON.parse(previous.state_json) as MemoryManagementState
      }
      const old = loadBase(gameId)
      if (request.expectedMemoryEpoch !== old.memoryEpoch || request.expectedRecordingRevision !== old.recordingRevision)
        throw new MemoryStaleError('Memory management version changed')
      const next = applyWriteBatch(old, {
        schemaVersion: old.schemaVersion,
        batchId: request.requestId,
        memoryEpoch: old.memoryEpoch + (request.action === 'clear' ? 1 : 0),
        recordingRevision: old.recordingRevision + (request.action === 'set_recording' ? 1 : 0),
        at: Date.now(),
        ...(request.action === 'clear'
          ? { clear: { libraryGameId: gameId, preferences: request.preferences === true, episodes: request.episodes !== false } }
          : { setRecording: request.enabled }),
      })
      next.generation = old.generation + 1
      if (request.action === 'clear' && request.episodes !== false) recording.clear(gameId)
      const state = { memoryEpoch: next.memoryEpoch, recordingRevision: next.recordingRevision, recordingEnabled: next.recordingEnabled }
      client.prepare('INSERT INTO companion_management VALUES(?,?,?,?)').run(gameId, request.requestId, fingerprint, JSON.stringify(state))
      writeSnapshot(gameId, next)
      client.exec('COMMIT')
      return state
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
  }
  return { load, state, commit, manage }
}
