/**
 * Heavy shared-cache migrations (scrub + sentence v10) run single-flight off the open path.
 * @see docs/translation-mainthread-offload.md §3.4
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { normalizeTranslateKey } from '@/lib/translate/lookup'
import { singleFlight, yieldEventLoop } from '@/services/jobs'
import { isIdenticalTranslation } from '@/services/translate/text-classify'

import { ensureMatchIndex, needsSentenceIndexV10, rebuildSentenceIndexV10, rebuildSentenceIndexV10Async } from './match-index'

const flights = new Map<string, Promise<void>>()
const migrating = new Set<string>()

function isSharedIdenticalPair(src: string, tgt: string) {
  if (isIdenticalTranslation(src, tgt)) return true
  const a = normalizeTranslateKey(src)
  const b = normalizeTranslateKey(tgt)
  return Boolean(a) && isIdenticalTranslation(a, b)
}

export function isSharedCacheMigrating(dbPath: string) {
  return migrating.has(path.resolve(dbPath))
}

export function waitSharedCacheHeavyMigrate(dbPath: string) {
  return flights.get(`shared-migrate:${path.resolve(dbPath)}`) || Promise.resolve()
}

/** Test helper: drop in-flight / migrating flags (does not touch the DB file). */
export function resetSharedCacheMigrateForTests() {
  flights.clear()
  migrating.clear()
}

/** Sync migrate for Jest (open path stays sync in tests). Production uses scheduleSharedCacheHeavyMigrate. */
export function runSharedCacheHeavyMigrateSync(dbPath: string) {
  const resolved = path.resolve(dbPath)
  if (!fs.existsSync(resolved)) return
  const client = new DatabaseSync(resolved)
  try {
    client.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
    ensureMatchIndex(client)
    if (needsSentenceIndexV10(client)) rebuildSentenceIndexV10(client)
    const flagged = client.prepare("SELECT value FROM cache_meta WHERE key='scrub_identical_v1'").get()
    if (!flagged) {
      scrubIdenticalSync(client)
      client.prepare("INSERT OR REPLACE INTO cache_meta(key,value) VALUES('scrub_identical_v1','1')").run()
    }
  } finally {
    client.close()
  }
}

/** Kick heavy work once per DB path; safe to call on every open. */
export function scheduleSharedCacheHeavyMigrate(dbPath: string) {
  const resolved = path.resolve(dbPath)
  if (!fs.existsSync(resolved)) return
  // Keep unit tests deterministic: migrate before open returns.
  if (process.env.JEST_WORKER_ID) {
    runSharedCacheHeavyMigrateSync(resolved)
    return
  }
  void singleFlight(flights, `shared-migrate:${resolved}`, async () => {
    migrating.add(resolved)
    try {
      await yieldEventLoop()
      const client = new DatabaseSync(resolved)
      try {
        client.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
        ensureMatchIndex(client)
        if (needsSentenceIndexV10(client)) {
          await rebuildSentenceIndexV10Async(client)
          await yieldEventLoop()
        }
        const flagged = client.prepare("SELECT value FROM cache_meta WHERE key='scrub_identical_v1'").get()
        if (!flagged) {
          await scrubIdenticalChunked(client)
          client.prepare("INSERT OR REPLACE INTO cache_meta(key,value) VALUES('scrub_identical_v1','1')").run()
        }
      } finally {
        client.close()
      }
    } finally {
      migrating.delete(resolved)
    }
  }).catch(() => {
    // The daemon awaits the same flight before publishing readiness.
  })
}

function scrubIdenticalSync(client: DatabaseSync) {
  const rows = client.prepare('SELECT id, src, zh, src_lang, tgt_lang, engine FROM translations').all() as Array<{
    id: number
    src: string
    zh: string
    src_lang: string
    tgt_lang: string
    engine: string | null
  }>
  const del = client.prepare('DELETE FROM translations WHERE id=?')
  client.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows) {
      const engine = row.engine == null ? null : String(row.engine)
      if (engine === 'skip:control' || engine === 'skip:sensitive' || isSharedIdenticalPair(String(row.src), String(row.zh))) {
        del.run(row.id)
      }
    }
    client.exec('COMMIT')
  } catch (e) {
    try {
      client.exec('ROLLBACK')
    } catch {
      /* */
    }
    throw e
  }
}

async function scrubIdenticalChunked(client: DatabaseSync) {
  const rows = client.prepare('SELECT id, src, zh, src_lang, tgt_lang, engine FROM translations').all() as Array<{
    id: number
    src: string
    zh: string
    src_lang: string
    tgt_lang: string
    engine: string | null
  }>
  const del = client.prepare('DELETE FROM translations WHERE id=?')
  client.exec('BEGIN IMMEDIATE')
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      const engine = row.engine == null ? null : String(row.engine)
      if (engine === 'skip:control' || engine === 'skip:sensitive' || isSharedIdenticalPair(String(row.src), String(row.zh))) {
        del.run(row.id)
      }
      if (i % 200 === 199) {
        client.exec('COMMIT')
        await yieldEventLoop()
        client.exec('BEGIN IMMEDIATE')
      }
    }
    client.exec('COMMIT')
  } catch (e) {
    try {
      client.exec('ROLLBACK')
    } catch {
      /* */
    }
    throw e
  }
}
