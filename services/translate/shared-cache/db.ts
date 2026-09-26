import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-sqlite'

import { TRANSLATE_CACHE_DB_PATH, TRANSLATE_CACHE_DIR } from '@/constants/paths'
import { isNsfwCacheRow } from '@/services/translate/sensitive-text'

import { cacheMeta, translations } from './schema'

export type SharedCacheDb = ReturnType<typeof drizzle> & { $client: DatabaseSync }

export function defaultSharedDir() {
  return TRANSLATE_CACHE_DIR
}

export function defaultSharedDbPath() {
  return TRANSLATE_CACHE_DB_PATH
}

/** 建表 / 补列 / 一次 NSFW 回填（仅启动路径；DDL 用 sql 模板，业务查询走 ORM） */
function ensureSchema(db: SharedCacheDb, client: DatabaseSync) {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS translations (
      src TEXT PRIMARY KEY NOT NULL,
      zh TEXT NOT NULL,
      engine TEXT,
      updated_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      nsfw INTEGER NOT NULL DEFAULT 0
    )
  `)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )
  `)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_updated ON translations(updated_at)`)

  const cols = client.prepare('PRAGMA table_info(translations)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'nsfw')) {
    db.run(sql`ALTER TABLE translations ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0`)
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_nsfw ON translations(nsfw)`)

  const meta = db.select().from(cacheMeta).where(eq(cacheMeta.key, 'nsfw_backfill')).get()
  if (meta?.value === '1') return

  const rows = db.select({ src: translations.src, engine: translations.engine }).from(translations).all()
  if (rows.length) {
    db.transaction((tx) => {
      for (const r of rows) {
        tx.update(translations)
          .set({ nsfw: isNsfwCacheRow(String(r.src), r.engine) ? 1 : 0 })
          .where(eq(translations.src, String(r.src)))
          .run()
      }
    })
  }
  db.insert(cacheMeta)
    .values({ key: 'nsfw_backfill', value: '1' })
    .onConflictDoUpdate({ target: cacheMeta.key, set: { value: '1' } })
    .run()
}

export function openSharedCacheDb(dbPath = defaultSharedDbPath()): { db: SharedCacheDb; path: string } {
  const resolved = path.resolve(dbPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const client = new DatabaseSync(resolved)
  client.exec('PRAGMA journal_mode = WAL')
  const db = drizzle({ client }) as SharedCacheDb
  ensureSchema(db, client)
  return { db, path: resolved }
}
