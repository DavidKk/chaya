import fs from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

import { ensureGameContentDir } from '@/lib/game/content-files'
import { appendCacheLines, lockCacheFile } from '@/lib/translate/cache-file-lock'
import { applyCacheRow, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'

import type { IndexedRecord, MatchIndex } from './match-index'

/** Recover an incomplete append before writing the next complete event. */
export function appendCacheEvents(file: string, events: CacheRow[]): void {
  appendCacheLines(fs, file, events)
}

export function createGameBackfill(client: DatabaseSync, index: MatchIndex, database: string) {
  client.exec(`CREATE TABLE IF NOT EXISTS game_backfills (root TEXT NOT NULL,src TEXT NOT NULL,record_id INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(root,src));
    CREATE TABLE IF NOT EXISTS game_backfill_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,root TEXT NOT NULL,src TEXT NOT NULL,record_id INTEGER NOT NULL,revision INTEGER NOT NULL);`)
  const joined =
    'SELECT r.src,t.zh,t.engine,r.revision FROM translation_records r JOIN translations t ON t.src=r.src AND t.src_lang=r.src_lang AND t.tgt_lang=r.tgt_lang WHERE r.id=?'
  function rowMeta(recordId: number, revision: number): Pick<CacheRow, 'alignments' | 'newlines'> {
    const alignment = client.prepare('SELECT groups_json FROM alignment_groups WHERE record_id=? AND revision=?').get(recordId, revision) as { groups_json: string } | undefined
    const newlines = client.prepare('SELECT annotations_json FROM newline_annotations WHERE record_id=? AND revision=?').get(recordId, revision) as
      { annotations_json: string } | undefined
    return {
      ...(alignment ? { alignments: JSON.parse(alignment.groups_json) } : {}),
      ...(newlines ? { newlines: JSON.parse(newlines.annotations_json) } : {}),
    }
  }
  return {
    queue(root: string, records: IndexedRecord[]) {
      client.exec('BEGIN IMMEDIATE')
      try {
        for (const r of records) {
          if (!index.current([r])) continue
          client.prepare('INSERT INTO game_backfill_tasks(root,src,record_id,revision) VALUES(?,?,?,?)').run(root, r.src, r.id, r.revision)
        }
        client.exec('COMMIT')
      } catch (e) {
        client.exec('ROLLBACK')
        throw e
      }
    },
    flush(root: string) {
      const file = ensureGameContentDir(root, 'cacheNdjson')
      const release = lockCacheFile(fs, file)
      try {
        const rows = new Map<string, CacheRow>(),
          seen = new Set<string>()
        for (const line of (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n')) {
          try {
            const r = parseCacheRow(JSON.parse(line))
            if (r) {
              applyCacheRow(rows, r)
              if (r.event) seen.add(r.event)
            }
          } catch {
            /* Recover tails during append. */
          }
        }
        const tasks = client.prepare('SELECT * FROM game_backfill_tasks WHERE root=? ORDER BY id').all(root) as Array<{
          id: number
          src: string
          record_id: number
          revision: number
        }>
        for (const task of tasks) {
          const event = `${database}:fill:${task.id}`
          const record = client.prepare(joined).get(task.record_id) as { src: string; zh: string; engine: string; revision: number } | undefined
          if (!seen.has(event) && record?.revision === task.revision) {
            const meta = rowMeta(task.record_id, task.revision)
            const value: CacheRow = {
              s: task.src,
              t: record.zh,
              engine: record.engine,
              origin: { id: String(task.record_id), revision: task.revision, database },
              event,
              ...meta,
            }
            const old = rows.get(task.src)
            if (!old || old.origin) {
              appendCacheEvents(file, [value])
              applyCacheRow(rows, value)
            }
          }
          client.prepare('INSERT OR REPLACE INTO game_backfills VALUES(?,?,?,?)').run(root, task.src, task.record_id, task.revision)
          client.prepare('DELETE FROM game_backfill_tasks WHERE id=?').run(task.id)
        }
        const links = client.prepare('SELECT * FROM game_backfills WHERE root=?').all(root) as Array<{ src: string; record_id: number; revision: number }>
        for (const link of links) {
          const old = rows.get(link.src)
          if (!old?.origin || old.origin.database !== database || old.origin.id !== String(link.record_id)) {
            client.prepare('DELETE FROM game_backfills WHERE root=? AND src=?').run(root, link.src)
            continue
          }
          const record = client.prepare(joined).get(link.record_id) as { zh: string; engine: string; revision: number } | undefined
          if (record?.revision === old.origin.revision) continue
          const revision = record?.revision || link.revision + 1
          const meta = record ? rowMeta(link.record_id, record.revision) : {}
          const value: CacheRow = {
            s: link.src,
            t: record?.zh ?? null,
            engine: record?.engine,
            origin: { id: String(link.record_id), revision, database },
            event: `${database}:refresh:${link.record_id}:${record?.revision || 'deleted'}`,
            ...meta,
          }
          if (!seen.has(value.event!)) {
            appendCacheEvents(file, [value])
            applyCacheRow(rows, value)
          }
          if (record) client.prepare('UPDATE game_backfills SET revision=? WHERE root=? AND src=?').run(record.revision, root, link.src)
          else client.prepare('DELETE FROM game_backfills WHERE root=? AND src=?').run(root, link.src)
        }
        client.exec(
          'DELETE FROM translation_outbox WHERE NOT EXISTS (SELECT 1 FROM game_backfills l WHERE l.record_id=translation_outbox.record_id AND l.revision<translation_outbox.revision)'
        )
      } finally {
        release()
      }
    },
  }
}
