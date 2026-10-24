import { createHash } from 'node:crypto'

import { applyWriteBatch, batchFingerprint, emptyMemorySnapshot, snapshotLogicalBytes, trimSnapshotToBudgets } from '@/lib/game-agent/companion/memory-durable'
import { MEMORY_GAME_BUDGET_BYTES, MEMORY_GLOBAL_BUDGET_BYTES } from '@/lib/game-agent/companion/memory-limits'
import { MemoryConflictError, validateWriteBatch } from '@/lib/game-agent/companion/memory-schema'
import type { MemoryStoreSnapshot, MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import type { CompanionDb } from '@/services/game-agent/companion-memory-db'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function createCompanionSqliteStore(db: CompanionDb) {
  const client = db.$client
  client.exec('CREATE TABLE IF NOT EXISTS companion_snapshots (game_id TEXT PRIMARY KEY NOT NULL, snapshot_json TEXT NOT NULL)')
  function load(gameId: string): MemoryStoreSnapshot {
    const row = client.prepare('SELECT snapshot_json FROM companion_snapshots WHERE game_id=?').get(gameId) as { snapshot_json: string } | undefined
    if (row) return JSON.parse(row.snapshot_json) as MemoryStoreSnapshot
    const imported = client.prepare("SELECT name FROM sqlite_master WHERE name='companion_legacy_imports'").get()
    const legacy = imported
      ? (client.prepare('SELECT snapshot_json FROM companion_legacy_imports WHERE game_id=?').get(gameId) as { snapshot_json: string } | undefined)
      : undefined
    return legacy ? (JSON.parse(legacy.snapshot_json) as MemoryStoreSnapshot) : emptyMemorySnapshot()
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
      const old = load(gameId)
      const next = trimSnapshotToBudgets(
        applyWriteBatch(old, batch, { boundGameId: gameId === '_global' ? undefined : gameId, onConflict: 'throw', otherGamesBytes: otherBytes }),
        {
          gameBudgetBytes: MEMORY_GAME_BUDGET_BYTES,
          globalBudgetBytes: Math.min(MEMORY_GAME_BUDGET_BYTES, MEMORY_GLOBAL_BUDGET_BYTES - otherBytes),
        }
      )
      next.generation = old.generation + 1
      client
        .prepare(
          `INSERT INTO companion_manifest(game_id,schema_version,generation,memory_epoch,recording_revision,recording_enabled,used_bytes,updated_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET generation=excluded.generation,memory_epoch=excluded.memory_epoch,
        recording_revision=excluded.recording_revision,recording_enabled=excluded.recording_enabled,used_bytes=excluded.used_bytes,updated_at=excluded.updated_at`
        )
        .run(gameId, next.schemaVersion, next.generation, next.memoryEpoch, next.recordingRevision, next.recordingEnabled ? 1 : 0, snapshotLogicalBytes(next), Date.now())
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
      client.prepare('INSERT INTO companion_applied_batches VALUES(?,?,?,?)').run(batch.batchId, gameId, fingerprint, Date.now())
      // Retain fingerprints: an offline client may replay an old batch after a long absence.
      client.exec('COMMIT')
      return { ok: true, duplicated: false }
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
  }
  return { load, commit }
}
