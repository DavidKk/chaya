import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { batchFingerprint, snapshotLogicalBytes } from '@/lib/game-agent/companion/memory-durable'
import { validateWriteBatch } from '@/lib/game-agent/companion/memory-schema'
import type { CompanionDb } from '@/services/game-agent/companion-memory-db'
import { createCompanionMemoryFileBackend } from '@/services/game-agent/companion-memory-file-store.server'

export type CompanionMigrationResult = { gamesMigrated: number; episodesImported: number; evidenceImported: number; batchesImported: number }
const hashId = (id: string) => createHash('sha256').update(id).digest('hex')

/** Reuse the legacy replay/barrier rules and retain every snapshot collection. */
export async function migrateCompanionMemory(db: CompanionDb, memoryRootDir: string, options: { gameIds?: string[] } = {}): Promise<CompanionMigrationResult> {
  const result = { gamesMigrated: 0, episodesImported: 0, evidenceImported: 0, batchesImported: 0 }
  if (!fs.existsSync(memoryRootDir)) return result
  const client = db.$client
  client.exec(`CREATE TABLE IF NOT EXISTS companion_legacy_imports (
    game_id TEXT PRIMARY KEY NOT NULL, source_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, imported_at INTEGER NOT NULL
  )`)
  const known = new Map(['_global', ...(options.gameIds || [])].map((id) => [hashId(id), id]))
  for (const entry of fs.readdirSync(memoryRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue
    const dir = path.join(memoryRootDir, entry.name)
    const manifestPath = path.join(dir, 'manifest.json')
    const manifest = fs.existsSync(manifestPath) ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { checkpoint?: string; appliedBatches?: Record<string, string> }) : null
    const discover = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (typeof record.libraryGameId === 'string') known.set(hashId(record.libraryGameId), record.libraryGameId)
      for (const child of Object.values(record)) if (child && typeof child === 'object') discover(child)
    }
    if (manifest?.checkpoint) {
      if (path.basename(manifest.checkpoint) !== manifest.checkpoint) throw new Error('Invalid checkpoint path')
      discover(JSON.parse(fs.readFileSync(path.join(dir, manifest.checkpoint), 'utf8')))
    }
    const batchesDir = path.join(dir, 'batches')
    const journalFiles = fs.existsSync(batchesDir)
      ? fs
          .readdirSync(batchesDir)
          .filter((name) => name.endsWith('.json'))
          .sort()
      : []
    const applied = new Map(Object.entries(manifest?.appliedBatches || {}).map(([id, value]) => [id, /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : hashId(value)]))
    for (const file of journalFiles) {
      const batch = validateWriteBatch(JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf8')))
      discover(batch)
      const fingerprint = hashId(batchFingerprint(batch))
      const previous = applied.get(batch.batchId)
      if (previous && previous !== fingerprint) throw new Error('Legacy companion batch fingerprint conflict')
      applied.set(batch.batchId, fingerprint)
    }
    const gameId = known.get(entry.name)
    if (!gameId) throw new Error(`Companion memory identity is unresolved: ${entry.name}; supply the library game IDs before migration`)
    if (client.prepare('SELECT game_id FROM companion_legacy_imports WHERE game_id = ?').get(gameId)) continue
    if (client.prepare('SELECT game_id FROM companion_manifest WHERE game_id = ?').get(gameId))
      throw new Error('Companion destination already contains data; refusing to overwrite')
    const backend = createCompanionMemoryFileBackend({ rootDir: memoryRootDir, libraryGameId: gameId })
    // loadSnapshot takes the same locks and replays checkpoint + journal + epoch barriers.
    const snapshot = await backend.loadSnapshot()
    if (!snapshot) throw new Error('Legacy companion snapshot is unavailable')
    const body = JSON.stringify(snapshot)
    client.exec('BEGIN IMMEDIATE')
    try {
      if (client.prepare('SELECT game_id FROM companion_manifest WHERE game_id = ?').get(gameId)) throw new Error('Companion destination changed during import')
      client
        .prepare(
          `INSERT INTO companion_manifest (game_id, schema_version, generation, memory_epoch, recording_revision, recording_enabled, used_bytes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          gameId,
          snapshot.schemaVersion,
          snapshot.generation,
          snapshot.memoryEpoch,
          snapshot.recordingRevision,
          snapshot.recordingEnabled ? 1 : 0,
          snapshotLogicalBytes(snapshot),
          Date.now()
        )
      const episodeIds = new Set<string>()
      for (const ep of snapshot.episodes) {
        const id = hashId(`${gameId}\0${ep.episodeId}`)
        episodeIds.add(ep.episodeId)
        const data = JSON.stringify(ep)
        client
          .prepare(
            `INSERT INTO companion_episodes(id, game_id, kind, persistence, completeness, stable_key, outcome, data_json, bytes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, gameId, ep.kind, ep.persistence, ep.completeness, ep.stableKey ?? null, ep.outcome ?? null, data, Buffer.byteLength(data), ep.at)
      }
      for (const [index, ev] of snapshot.evidence.entries()) {
        if (!episodeIds.has(ev.episodeId)) throw new Error('Legacy evidence has no matching episode; migration aborted')
        const data = JSON.stringify(ev)
        client
          .prepare(
            `INSERT INTO companion_evidence(id, episode_id, game_id, summary, evidence_json, memory_epoch, bytes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(hashId(`${gameId}\0${ev.episodeId}\0${index}`), hashId(`${gameId}\0${ev.episodeId}`), gameId, ev.summary, data, ev.memoryEpoch, Buffer.byteLength(data), Date.now())
      }
      for (const [batchId, fingerprint] of applied) {
        client.prepare('INSERT INTO companion_applied_batches(batch_id, game_id, fingerprint, applied_at) VALUES (?, ?, ?, ?)').run(batchId, gameId, fingerprint, Date.now())
      }
      // This durable full snapshot preserves save links, preferences, projections and scope.
      client.prepare('INSERT INTO companion_legacy_imports(game_id, source_hash, snapshot_json, imported_at) VALUES (?, ?, ?, ?)').run(gameId, hashId(body), body, Date.now())
      client.exec('COMMIT')
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
    result.gamesMigrated++
    result.episodesImported += snapshot.episodes.length
    result.evidenceImported += snapshot.evidence.length
    result.batchesImported += applied.size
  }
  return result
}
