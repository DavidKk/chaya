import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { SourceGameEvent } from '@/lib/game-agent/audit'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import {
  type AgentTraceArchive,
  AgentTraceConflictError,
  type AgentTraceExport,
  type AgentTraceSummary,
  sameTraceEvent,
  traceCleanupIds,
  traceEventKey,
  traceExport,
  traceSummary,
} from '@/lib/game-agent/trace'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export type TraceListPageOptions = {
  gameId?: string
  runtimeInstanceId?: string
  limit?: number
  cursor?: string
}

export type TraceListPageResult = {
  items: AgentTraceSummary[]
  nextCursor: string | null
  total: number
}

export type TraceReadPageOptions = {
  limit?: number
  cursor?: string
}

export type TraceReadPageResult = {
  task: AgentTraceSummary
  events: AgentTaskEvent[]
  nextCursor: string | null
}

export type TraceSqliteStore = AgentTraceArchive & {
  appendSource(event: SourceGameEvent): Promise<void>
  listPage(options?: TraceListPageOptions): Promise<TraceListPageResult>
  readPage(taskId: string, options?: TraceReadPageOptions): Promise<TraceReadPageResult | null>
  removeForGame(gameId: string, taskId?: string): Promise<number>
  removeForRuntime(runtimeInstanceId: string, taskId?: string, gameId?: string): Promise<number>
  cleanup(): Promise<number>
  close(): void
  dbPath: string
}

export function createTraceSqliteStore(dbPath: string, legacyDir?: string): TraceSqliteStore {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const client = new DatabaseSync(dbPath)

  client.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS trace_events (
      event_key TEXT PRIMARY KEY NOT NULL,
      archive_seq INTEGER NOT NULL,
      event_id TEXT,
      epoch INTEGER NOT NULL DEFAULT 1,
      producer_seq INTEGER NOT NULL DEFAULT 0,
      occurred_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trace_events_archive_seq ON trace_events(archive_seq);
    CREATE INDEX IF NOT EXISTS idx_trace_events_occurred_at ON trace_events(occurred_at);

    CREATE TABLE IF NOT EXISTS trace_event_targets (
      event_key TEXT NOT NULL,
      game_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      target_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (event_key, game_id, runtime_id)
    );
    CREATE INDEX IF NOT EXISTS idx_trace_targets_lookup ON trace_event_targets(game_id, runtime_id, event_key);

    CREATE TABLE IF NOT EXISTS trace_tasks (
      task_id TEXT PRIMARY KEY NOT NULL,
      game_id TEXT NOT NULL,
      runtime_id TEXT,
      summary_json TEXT NOT NULL,
      state TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_trace_tasks_updated ON trace_tasks(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trace_tasks_game ON trace_tasks(game_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS trace_task_events (
      task_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      task_seq INTEGER NOT NULL,
      link_seq INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (task_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_trace_task_events_link ON trace_task_events(task_id, link_seq);
    CREATE INDEX IF NOT EXISTS idx_trace_task_events_seq ON trace_task_events(task_id, task_seq);

    CREATE TABLE IF NOT EXISTS trace_imports (
      source_id TEXT PRIMARY KEY NOT NULL,
      fingerprint TEXT NOT NULL,
      imported_offset INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error TEXT
    );
  `)

  function nextArchiveSeq(): number {
    const row = client.prepare('SELECT COALESCE(MAX(archive_seq), 0) + 1 AS n FROM trace_events').get() as { n: number }
    return Number(row.n)
  }

  function nextLinkSeq(): number {
    const row = client.prepare('SELECT COALESCE(MAX(link_seq), 0) + 1 AS n FROM trace_task_events').get() as { n: number }
    return Number(row.n)
  }

  function nextTargetSeq(): number {
    const row = client.prepare('SELECT COALESCE(MAX(target_seq), 0) + 1 AS n FROM trace_event_targets').get() as { n: number }
    return Number(row.n)
  }

  async function append(task: AgentTask, event: AgentTaskEvent): Promise<void> {
    const key = traceEventKey(task.id, event)
    const payloadStr = JSON.stringify(event)
    const fp = hash(payloadStr)
    const eventBytes = Buffer.byteLength(payloadStr, 'utf8')
    const now = Date.now()

    client.exec('BEGIN IMMEDIATE')
    try {
      const existing = client.prepare('SELECT payload FROM trace_events WHERE event_key = ?').get(key) as { payload: string } | undefined
      if (existing) {
        const parsed = JSON.parse(existing.payload)
        if (!sameTraceEvent(parsed, event)) {
          throw new AgentTraceConflictError(key)
        }
      } else {
        client
          .prepare(
            `INSERT INTO trace_events(event_key, archive_seq, event_id, epoch, producer_seq, occurred_at, payload, fingerprint, bytes, created_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(key, nextArchiveSeq(), event.eventId ?? null, 1, event.seq ?? 0, event.at || now, payloadStr, fp, eventBytes, now)
      }

      const taskSeq = event.taskSeq ?? event.seq ?? 0
      const existingLink = client.prepare('SELECT task_seq FROM trace_task_events WHERE task_id = ? AND event_key = ?').get(task.id, key)
      if (!existingLink) {
        client
          .prepare(
            `INSERT INTO trace_task_events(task_id, event_key, task_seq, link_seq, fingerprint)
             VALUES(?, ?, ?, ?, ?)`
          )
          .run(task.id, key, taskSeq, nextLinkSeq(), fp)
      }

      const currentTask = client.prepare('SELECT bytes, revision FROM trace_tasks WHERE task_id = ?').get(task.id) as { bytes: number; revision: number } | undefined
      const newBytes = (currentTask?.bytes ?? 0) + (existingLink ? 0 : eventBytes)
      const newRevision = (currentTask?.revision ?? 0) + 1
      const summaryObj = traceSummary(task, task.lastSeq ?? taskSeq, newBytes)

      client
        .prepare(
          `INSERT INTO trace_tasks(task_id, game_id, runtime_id, summary_json, state, updated_at, bytes, revision)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(task_id) DO UPDATE SET
             summary_json = excluded.summary_json,
             state = excluded.state,
             updated_at = excluded.updated_at,
             bytes = excluded.bytes,
             revision = excluded.revision`
        )
        .run(task.id, task.gameId, task.runtimeInstanceId ?? null, JSON.stringify(summaryObj), task.state, task.updatedAt || now, newBytes, newRevision)

      client.exec('COMMIT')
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
  }

  async function appendSource(event: SourceGameEvent): Promise<void> {
    const key = event.eventId
    if (!key) throw new Error('Source event missing eventId')
    const payloadStr = JSON.stringify(event)
    const fp = hash(payloadStr)
    const eventBytes = Buffer.byteLength(payloadStr, 'utf8')
    const now = Date.now()

    client.exec('BEGIN IMMEDIATE')
    try {
      const existing = client.prepare('SELECT payload FROM trace_events WHERE event_key = ?').get(key) as { payload: string } | undefined
      if (existing) {
        const parsed = JSON.parse(existing.payload)
        if (!sameTraceEvent(parsed, event)) {
          throw new AgentTraceConflictError(key)
        }
      } else {
        const producerSeq = event.taskSeq ?? (event as unknown as { seq?: number }).seq ?? 0
        client
          .prepare(
            `INSERT INTO trace_events(event_key, archive_seq, event_id, epoch, producer_seq, occurred_at, payload, fingerprint, bytes, created_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(key, nextArchiveSeq(), event.eventId, 1, producerSeq, event.at || now, payloadStr, fp, eventBytes, now)
      }

      for (const target of event.targets) {
        const gameId = target.libraryGameId || (target.kind === 'game' ? target.id : '') || target.runtimeInstanceId || ''
        const runtimeId = target.runtimeInstanceId || (target.kind === 'runtime' ? target.id : '') || ''
        if (gameId || runtimeId) {
          client
            .prepare(
              `INSERT OR IGNORE INTO trace_event_targets(event_key, game_id, runtime_id, target_seq)
               VALUES(?, ?, ?, ?)`
            )
            .run(key, gameId, runtimeId, nextTargetSeq())
        }
      }

      if (event.correlation?.taskId) {
        const taskId = event.correlation.taskId
        const taskSeq = event.taskSeq ?? (event as unknown as { seq?: number }).seq ?? 0
        const existingLink = client.prepare('SELECT task_seq FROM trace_task_events WHERE task_id = ? AND event_key = ?').get(taskId, key)
        if (!existingLink) {
          client
            .prepare(
              `INSERT OR IGNORE INTO trace_task_events(task_id, event_key, task_seq, link_seq, fingerprint)
               VALUES(?, ?, ?, ?, ?)`
            )
            .run(taskId, key, taskSeq, nextLinkSeq(), fp)
        }
      }

      client.exec('COMMIT')
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
  }

  async function list(): Promise<AgentTraceSummary[]> {
    const rows = client.prepare('SELECT summary_json FROM trace_tasks ORDER BY updated_at DESC').all() as Array<{ summary_json: string }>
    return rows.map((r) => JSON.parse(r.summary_json) as AgentTraceSummary)
  }

  async function listPage(options?: TraceListPageOptions): Promise<TraceListPageResult> {
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 200)
    const filters: string[] = []
    const params: unknown[] = []

    if (options?.gameId) {
      filters.push('game_id = ?')
      params.push(options.gameId)
    }
    if (options?.runtimeInstanceId) {
      filters.push('runtime_id = ?')
      params.push(options.runtimeInstanceId)
    }

    if (options?.cursor) {
      try {
        const [cursorTime, cursorId] = Buffer.from(options.cursor, 'base64').toString('utf8').split(':')
        filters.push('(updated_at < ? OR (updated_at = ? AND task_id < ?))')
        params.push(Number(cursorTime), Number(cursorTime), cursorId)
      } catch {
        // ignore invalid cursor
      }
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
    const countRow = client.prepare(`SELECT COUNT(*) as cnt FROM trace_tasks ${whereClause}`).get(...params) as { cnt: number }
    const total = Number(countRow.cnt)

    const query = `SELECT task_id, summary_json, updated_at FROM trace_tasks ${whereClause} ORDER BY updated_at DESC, task_id DESC LIMIT ?`
    const rows = client.prepare(query).all(...params, limit + 1) as Array<{ task_id: string; summary_json: string; updated_at: number }>

    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const items = slice.map((r) => JSON.parse(r.summary_json) as AgentTraceSummary)

    let nextCursor: string | null = null
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1]
      nextCursor = Buffer.from(`${last.updated_at}:${last.task_id}`).toString('base64')
    }

    return { items, nextCursor, total }
  }

  async function read(taskId: string): Promise<AgentTask | null> {
    const taskRow = client.prepare('SELECT summary_json FROM trace_tasks WHERE task_id = ?').get(taskId) as { summary_json: string } | undefined
    if (!taskRow) return null
    const summary = JSON.parse(taskRow.summary_json) as AgentTraceSummary

    const eventRows = client
      .prepare(
        `SELECT te.payload
         FROM trace_task_events tte
         JOIN trace_events te ON tte.event_key = te.event_key
         WHERE tte.task_id = ?
         ORDER BY tte.task_seq ASC, tte.link_seq ASC`
      )
      .all(taskId) as Array<{ payload: string }>

    const events = eventRows.map((r) => JSON.parse(r.payload) as AgentTaskEvent)
    return { ...summary, events, messages: [] } as AgentTask
  }

  async function readPage(taskId: string, options?: TraceReadPageOptions): Promise<TraceReadPageResult | null> {
    const taskRow = client.prepare('SELECT summary_json FROM trace_tasks WHERE task_id = ?').get(taskId) as { summary_json: string } | undefined
    if (!taskRow) return null
    const summary = JSON.parse(taskRow.summary_json) as AgentTraceSummary

    const limit = Math.min(Math.max(1, options?.limit ?? 50), 200)
    const cursorSeq = options?.cursor ? Number(Buffer.from(options.cursor, 'base64').toString('utf8')) : -1

    const query = `
      SELECT tte.task_seq, te.payload
      FROM trace_task_events tte
      JOIN trace_events te ON tte.event_key = te.event_key
      WHERE tte.task_id = ? AND tte.task_seq > ?
      ORDER BY tte.task_seq ASC, tte.link_seq ASC
      LIMIT ?
    `
    const rows = client.prepare(query).all(taskId, cursorSeq, limit + 1) as Array<{ task_seq: number; payload: string }>
    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const events = slice.map((r) => JSON.parse(r.payload) as AgentTaskEvent)

    let nextCursor: string | null = null
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1]
      nextCursor = Buffer.from(String(last.task_seq)).toString('base64')
    }

    return { task: summary, events, nextCursor }
  }

  async function remove(taskId?: string): Promise<number> {
    if (taskId) {
      client.exec('BEGIN IMMEDIATE')
      try {
        client.prepare('DELETE FROM trace_task_events WHERE task_id = ?').run(taskId)
        const res = client.prepare('DELETE FROM trace_tasks WHERE task_id = ?').run(taskId)
        // Clean up orphaned events
        client
          .prepare(
            `DELETE FROM trace_events
             WHERE event_key NOT IN (SELECT event_key FROM trace_task_events)
               AND event_key NOT IN (SELECT event_key FROM trace_event_targets)`
          )
          .run()
        client.exec('COMMIT')
        return Number(res.changes ?? 0)
      } catch (error) {
        client.exec('ROLLBACK')
        throw error
      }
    }

    // Run cleanup across all tasks
    return cleanup()
  }

  async function removeForGame(gameId: string, taskId?: string): Promise<number> {
    const tasks = client.prepare('SELECT task_id FROM trace_tasks WHERE game_id = ?').all(gameId) as Array<{ task_id: string }>
    let count = 0
    for (const t of tasks) {
      if (!taskId || t.task_id === taskId) {
        count += await remove(t.task_id)
      }
    }
    return count
  }

  async function removeForRuntime(runtimeInstanceId: string, taskId?: string, gameId?: string): Promise<number> {
    const rows = client
      .prepare('SELECT task_id FROM trace_tasks WHERE runtime_id = ? AND (? IS NULL OR game_id = ?)')
      .all(runtimeInstanceId, gameId ?? null, gameId ?? null) as Array<{ task_id: string }>
    let count = 0
    for (const r of rows) {
      if (!taskId || r.task_id === taskId) {
        count += await remove(r.task_id)
      }
    }
    return count
  }

  async function cleanup(): Promise<number> {
    const summaries = await list()
    const toRemove = traceCleanupIds(summaries)
    for (const id of toRemove) {
      await remove(id)
    }
    return toRemove.length
  }

  async function exportTrace(taskId: string): Promise<AgentTraceExport | null> {
    const task = await read(taskId)
    if (!task) return null
    return traceExport(task)
  }

  // Optional legacy file migration
  if (legacyDir && fs.existsSync(legacyDir)) {
    try {
      const names = fs.readdirSync(legacyDir)
      for (const name of names) {
        if (name.endsWith('.summary.json')) {
          const taskId = name.replace(/\.summary\.json$/, '')
          const summaryPath = path.join(legacyDir, name)
          const eventsPath = path.join(legacyDir, `${taskId}.events.jsonl`)
          const sourceId = `legacy:${taskId}`

          const existingImport = client.prepare('SELECT status FROM trace_imports WHERE source_id = ?').get(sourceId)
          if (existingImport) continue

          try {
            const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as AgentTraceSummary
            const eventLines = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean) : []

            client.exec('BEGIN IMMEDIATE')
            try {
              let totalBytes = 0
              for (const line of eventLines) {
                try {
                  const ev = JSON.parse(line) as AgentTaskEvent
                  const key = traceEventKey(taskId, ev)
                  const fp = hash(line)
                  const b = Buffer.byteLength(line, 'utf8')
                  totalBytes += b
                  client
                    .prepare(
                      `INSERT OR IGNORE INTO trace_events(event_key, archive_seq, event_id, epoch, producer_seq, occurred_at, payload, fingerprint, bytes, created_at)
                       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    )
                    .run(key, nextArchiveSeq(), ev.eventId ?? null, 1, ev.seq ?? 0, ev.at || Date.now(), line, fp, b, Date.now())
                  client
                    .prepare(
                      `INSERT OR IGNORE INTO trace_task_events(task_id, event_key, task_seq, link_seq, fingerprint)
                       VALUES(?, ?, ?, ?, ?)`
                    )
                    .run(taskId, key, ev.taskSeq ?? ev.seq ?? 0, nextLinkSeq(), fp)
                } catch {}
              }

              client
                .prepare(
                  `INSERT OR IGNORE INTO trace_tasks(task_id, game_id, runtime_id, summary_json, state, updated_at, bytes, revision)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                  taskId,
                  summary.gameId,
                  summary.runtimeInstanceId ?? null,
                  JSON.stringify({ ...summary, sizeBytes: totalBytes }),
                  summary.state,
                  summary.updatedAt,
                  totalBytes,
                  1
                )

              client
                .prepare('INSERT INTO trace_imports(source_id, fingerprint, imported_offset, status) VALUES(?, ?, ?, ?)')
                .run(sourceId, hash(`${summaryPath}:${eventLines.length}`), eventLines.length, 'verified')

              client.exec('COMMIT')
            } catch (err) {
              client.exec('ROLLBACK')
              client
                .prepare('INSERT OR REPLACE INTO trace_imports(source_id, fingerprint, imported_offset, status, error) VALUES(?, ?, ?, ?, ?)')
                .run(sourceId, 'error', 0, 'failed', String(err))
            }
          } catch {}
        }
      }
    } catch {}
  }

  return {
    dbPath,
    append,
    appendSource,
    list,
    listPage,
    read,
    readPage,
    remove,
    removeForGame,
    removeForRuntime,
    cleanup,
    export: exportTrace,
    close() {
      client.close()
    },
  }
}
