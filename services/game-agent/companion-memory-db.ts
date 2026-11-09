import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { COMPANION_MEMORY_DB_PATH } from '@/constants/paths'

export const companionManifest = sqliteTable('companion_manifest', {
  gameId: text('game_id').primaryKey().notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  generation: integer('generation').notNull().default(1),
  memoryEpoch: integer('memory_epoch').notNull().default(1),
  recordingRevision: integer('recording_revision').notNull().default(1),
  recordingEnabled: integer('recording_enabled').notNull().default(1),
  usedBytes: integer('used_bytes').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})

export const companionEpisodes = sqliteTable(
  'companion_episodes',
  {
    id: text('id').primaryKey().notNull(),
    gameId: text('game_id').notNull(),
    kind: text('kind').notNull(),
    persistence: text('persistence').notNull(),
    completeness: text('completeness').notNull(),
    stableKey: text('stable_key'),
    outcome: text('outcome'),
    dataJson: text('data_json').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_episodes_game').on(table.gameId, table.createdAt)]
)

export const companionEvidence = sqliteTable('companion_evidence', {
  id: text('id').primaryKey().notNull(),
  episodeId: text('episode_id').notNull(),
  gameId: text('game_id').notNull(),
  summary: text('summary').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  memoryEpoch: integer('memory_epoch').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const companionAppliedBatches = sqliteTable(
  'companion_applied_batches',
  {
    batchId: text('batch_id').notNull(),
    gameId: text('game_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    appliedAt: integer('applied_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.batchId] })]
)

export const companionCheckpoints = sqliteTable(
  'companion_checkpoints',
  {
    gameId: text('game_id').notNull(),
    generation: integer('generation').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.generation] })]
)

export const companionSchema = {
  companionManifest,
  companionEpisodes,
  companionEvidence,
  companionAppliedBatches,
  companionCheckpoints,
}

export type CompanionDb = ReturnType<typeof drizzle> & { $client: DatabaseSync }

export function ensureCompanionMemorySchema(db: CompanionDb, _client: DatabaseSync) {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS companion_manifest (
      game_id TEXT PRIMARY KEY NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      generation INTEGER NOT NULL DEFAULT 1,
      memory_epoch INTEGER NOT NULL DEFAULT 1,
      recording_revision INTEGER NOT NULL DEFAULT 1,
      recording_enabled INTEGER NOT NULL DEFAULT 1,
      used_bytes INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(sql`
    CREATE TABLE IF NOT EXISTS companion_episodes (
      id TEXT PRIMARY KEY NOT NULL,
      game_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      persistence TEXT NOT NULL,
      completeness TEXT NOT NULL,
      stable_key TEXT,
      outcome TEXT,
      data_json TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodes_game ON companion_episodes(game_id, created_at)`)

  db.run(sql`
    CREATE TABLE IF NOT EXISTS companion_evidence (
      id TEXT PRIMARY KEY NOT NULL,
      episode_id TEXT NOT NULL REFERENCES companion_episodes(id) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      memory_epoch INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  db.run(sql`
    CREATE TABLE IF NOT EXISTS companion_applied_batches (
      batch_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, batch_id)
    )
  `)

  db.run(sql`
    CREATE TABLE IF NOT EXISTS companion_checkpoints (
      game_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, generation)
    )
  `)
}

export function openCompanionMemoryDb(dbPath = COMPANION_MEMORY_DB_PATH): { db: CompanionDb; path: string } {
  const resolved = path.resolve(dbPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const client = new DatabaseSync(resolved)
  client.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON')
  const db = drizzle({ client }) as CompanionDb
  try {
    ensureCompanionMemorySchema(db, client)
  } catch (error) {
    client.close()
    throw error
  }
  return { db, path: resolved }
}
