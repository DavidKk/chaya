import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import { recordingFingerprint } from '@/lib/game-agent/companion/core/recording-schema'
import type { BattleRecordEvent, BattleRecordingSnapshot, BattleRecordingStatistics } from '@/lib/game-agent/companion/core/recording-types'
import { MemoryConflictError, MemorySchemaError } from '@/lib/game-agent/companion/memory-schema'

const digest = (value: unknown) => createHash('sha256').update(recordingFingerprint(value)).digest('hex')
const RETAINED_EVENTS = 512

/** These tables are always mutated inside the companion batch/management transaction. */
export function createCompanionRecordingStore(client: DatabaseSync) {
  client.exec(`
    CREATE TABLE IF NOT EXISTS companion_record_sources (
      game_id TEXT NOT NULL, source_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
      PRIMARY KEY (game_id, source_key)
    );
    CREATE TABLE IF NOT EXISTS companion_record_details (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, event_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_record_details_game ON companion_record_details(game_id, seq);
    CREATE TABLE IF NOT EXISTS companion_encounter_totals (
      game_id TEXT NOT NULL, encounter_key TEXT NOT NULL, revision TEXT NOT NULL, playthrough TEXT NOT NULL,
      outcome TEXT NOT NULL, PRIMARY KEY (game_id, encounter_key)
    );
    CREATE TABLE IF NOT EXISTS companion_management (
      game_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, state_json TEXT NOT NULL,
      PRIMARY KEY (game_id, request_id)
    );
  `)

  function apply(gameId: string, events: BattleRecordEvent[]) {
    for (const event of events) {
      const scope = event.scope
      if (scope.libraryGameId !== gameId) throw new MemorySchemaError('Battle recording game scope mismatch')
      const encounterKey = digest([scope.libraryGameId, scope.dataRevision, scope.playthroughId, scope.runtimeInstanceId, scope.segmentId, event.encounterId])
      const sourceKey = digest([encounterKey, event.kind, event.eventId])
      const fingerprint = digest(event)
      const previous = client.prepare('SELECT fingerprint FROM companion_record_sources WHERE game_id=? AND source_key=?').get(gameId, sourceKey) as
        { fingerprint: string } | undefined
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new MemoryConflictError('Battle source event id conflict')
        continue
      }
      client.prepare('INSERT INTO companion_record_sources VALUES(?,?,?)').run(gameId, sourceKey, fingerprint)
      client.prepare('INSERT OR IGNORE INTO companion_encounter_totals VALUES(?,?,?,?,?)').run(gameId, encounterKey, scope.dataRevision, scope.playthroughId, 'unknown')
      if (event.kind === 'encounter_finished' && event.outcome !== 'unknown') {
        const old = client.prepare('SELECT outcome FROM companion_encounter_totals WHERE game_id=? AND encounter_key=?').get(gameId, encounterKey) as { outcome: string }
        if (old.outcome !== 'unknown' && old.outcome !== event.outcome) throw new MemoryConflictError('Conflicting encounter outcome')
        client.prepare('UPDATE companion_encounter_totals SET outcome=? WHERE game_id=? AND encounter_key=?').run(event.outcome, gameId, encounterKey)
      }
      client.prepare('INSERT INTO companion_record_details(game_id,event_json) VALUES(?,?)').run(gameId, JSON.stringify(event))
    }
    client
      .prepare(
        `DELETE FROM companion_record_details WHERE game_id=? AND seq NOT IN
         (SELECT seq FROM companion_record_details WHERE game_id=? ORDER BY seq DESC LIMIT ?)`
      )
      .run(gameId, gameId, RETAINED_EVENTS)
  }

  function clear(gameId: string) {
    for (const table of ['companion_record_sources', 'companion_record_details', 'companion_encounter_totals']) {
      client.prepare(`DELETE FROM ${table} WHERE game_id=?`).run(gameId)
    }
  }

  function load(gameId: string): BattleRecordingSnapshot {
    const rows = client
      .prepare(
        `SELECT revision,playthrough,COUNT(*) AS encounters,
         SUM(outcome='win') AS win,SUM(outcome='lose') AS lose,SUM(outcome='escape') AS "escape",
         SUM(outcome='abort') AS abort,SUM(outcome='unknown') AS unknown
         FROM companion_encounter_totals WHERE game_id=? GROUP BY revision,playthrough ORDER BY revision,playthrough`
      )
      .all(gameId) as Array<Omit<BattleRecordingStatistics, 'libraryGameId' | 'dataRevision' | 'playthroughId'> & { revision: string; playthrough: string }>
    const statistics = rows.map(({ revision, playthrough, ...stats }) => ({ ...stats, libraryGameId: gameId, dataRevision: revision, playthroughId: playthrough }))
    const details = client.prepare('SELECT event_json FROM companion_record_details WHERE game_id=? ORDER BY seq').all(gameId) as Array<{ event_json: string }>
    const count = client.prepare('SELECT COUNT(*) AS n FROM companion_record_sources WHERE game_id=?').get(gameId) as { n: number }
    return {
      schemaVersion: 1,
      projectionVersion: 1,
      coverage: 'observed_only',
      statistics,
      recentEvents: details.map((item) => JSON.parse(item.event_json) as BattleRecordEvent),
      detailsTrimmed: count.n > details.length,
    }
  }

  function bytes(gameId: string): number {
    const row = client
      .prepare(
        `SELECT
         (SELECT COALESCE(SUM(length(CAST(event_json AS BLOB))+64),0) FROM companion_record_details WHERE game_id=?) +
         (SELECT COUNT(*)*192 FROM companion_record_sources WHERE game_id=?) +
         (SELECT COALESCE(SUM(length(CAST(revision AS BLOB))+length(CAST(playthrough AS BLOB))+192),0) FROM companion_encounter_totals WHERE game_id=?) +
         (SELECT COALESCE(SUM(length(CAST(request_id AS BLOB))+length(CAST(state_json AS BLOB))+128),0) FROM companion_management WHERE game_id=?) +
         (SELECT COALESCE(SUM(length(CAST(batch_id AS BLOB))+128),0) FROM companion_applied_batches WHERE game_id=?) AS n`
      )
      .get(gameId, gameId, gameId, gameId, gameId) as { n: number }
    return row.n
  }

  return { apply, clear, load, bytes }
}
