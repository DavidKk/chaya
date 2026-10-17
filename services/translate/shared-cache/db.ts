import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-sqlite'

import { TRANSLATE_CACHE_DB_PATH, TRANSLATE_CACHE_DIR } from '@/constants/paths'
import { DEFAULT_CACHE_TGT_LANG, detectCacheLang } from '@/lib/translate/cache-lang'
import { isNsfwCacheRow } from '@/services/translate/sensitive-text'

import { ensureMatchIndex } from './match-index'
import { cacheMeta, translations } from './schema'

export type SharedCacheDb = ReturnType<typeof drizzle> & { $client: DatabaseSync }

export function defaultSharedDir() {
  return TRANSLATE_CACHE_DIR
}

export function defaultSharedDbPath() {
  return TRANSLATE_CACHE_DB_PATH
}

type TableCol = { name: string }

function tableColumns(client: DatabaseSync): TableCol[] {
  return client.prepare('PRAGMA table_info(translations)').all() as TableCol[]
}

function rowPair(src: string, srcLang: string, tgtLang: string) {
  return and(eq(translations.src, src), eq(translations.srcLang, srcLang), eq(translations.tgtLang, tgtLang))
}

/** Rebuild translations with composite PK (src, src_lang, tgt_lang). Existing rows become language-pair catalog entries. */
function migrateLangPairTable(db: SharedCacheDb, client: DatabaseSync) {
  const cols = tableColumns(client)
  if (!cols.length) return
  if (cols.some((c) => c.name === 'src_lang') && cols.some((c) => c.name === 'tgt_lang')) return
  if (!cols.some((c) => c.name === 'nsfw')) {
    db.run(sql`ALTER TABLE translations ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0`)
  }

  db.run(sql`
    CREATE TABLE translations_lang_pair (
      src TEXT NOT NULL,
      zh TEXT NOT NULL,
      src_lang TEXT NOT NULL DEFAULT 'ja',
      tgt_lang TEXT NOT NULL DEFAULT 'zh',
      engine TEXT,
      updated_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      nsfw INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (src, src_lang, tgt_lang)
    )
  `)

  const legacy = client.prepare('SELECT src, zh, engine, updated_at, hit_count, nsfw FROM translations').all() as Array<{
    src: string
    zh: string
    engine: string | null
    updated_at: number
    hit_count: number
    nsfw: number
  }>

  const insert = client.prepare(
    `INSERT OR REPLACE INTO translations_lang_pair
      (src, zh, src_lang, tgt_lang, engine, updated_at, hit_count, nsfw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  client.exec('BEGIN')
  try {
    for (const row of legacy) {
      const src = String(row.src)
      const zh = String(row.zh)
      // Legacy shared cache was Chinese-target only; keep to=zh and classify the source side.
      insert.run(src, zh, detectCacheLang(src), DEFAULT_CACHE_TGT_LANG, row.engine, Number(row.updated_at) || 0, Number(row.hit_count) || 0, Number(row.nsfw) || 0)
    }
    client.exec('COMMIT')
  } catch (error) {
    client.exec('ROLLBACK')
    throw error
  }

  db.run(sql`DROP TABLE translations`)
  db.run(sql`ALTER TABLE translations_lang_pair RENAME TO translations`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_updated ON translations(updated_at)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_nsfw ON translations(nsfw)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_langs ON translations(src_lang, tgt_lang)`)
}

/** One-time repair: early lang-pair migration guessed target from text and marked identical English rows as en→en. */
function repairLegacyTargetLang(db: SharedCacheDb, client: DatabaseSync) {
  const meta = db.select().from(cacheMeta).where(eq(cacheMeta.key, 'lang_pair_tgt_zh')).get()
  if (meta?.value === '1') return
  // Drop rows that would collide with an existing Chinese-target pair, then flip the rest.
  client.exec(`
    DELETE FROM translations
    WHERE tgt_lang = src_lang
      AND tgt_lang != 'zh'
      AND EXISTS (
        SELECT 1 FROM translations AS other
        WHERE other.src = translations.src
          AND other.src_lang = translations.src_lang
          AND other.tgt_lang = 'zh'
      );
    UPDATE translations
    SET tgt_lang = 'zh'
    WHERE tgt_lang = src_lang AND tgt_lang != 'zh';
  `)
  db.insert(cacheMeta)
    .values({ key: 'lang_pair_tgt_zh', value: '1' })
    .onConflictDoUpdate({ target: cacheMeta.key, set: { value: '1' } })
    .run()
}

/** Create tables, add columns and backfill NSFW flags once at startup. Use SQL templates for DDL and ORM operations for business queries. */
function ensureSchema(db: SharedCacheDb, client: DatabaseSync) {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS translations (
      src TEXT NOT NULL,
      zh TEXT NOT NULL,
      src_lang TEXT NOT NULL DEFAULT 'ja',
      tgt_lang TEXT NOT NULL DEFAULT 'zh',
      engine TEXT,
      updated_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      nsfw INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (src, src_lang, tgt_lang)
    )
  `)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )
  `)

  migrateLangPairTable(db, client)
  repairLegacyTargetLang(db, client)

  const cols = tableColumns(client)
  if (!cols.some((c) => c.name === 'nsfw')) {
    db.run(sql`ALTER TABLE translations ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0`)
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_updated ON translations(updated_at)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_nsfw ON translations(nsfw)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_langs ON translations(src_lang, tgt_lang)`)

  const meta = db.select().from(cacheMeta).where(eq(cacheMeta.key, 'nsfw_backfill')).get()
  if (meta?.value === '1') return

  const rows = db.select({ src: translations.src, srcLang: translations.srcLang, tgtLang: translations.tgtLang, engine: translations.engine }).from(translations).all()
  if (rows.length) {
    db.transaction((tx) => {
      for (const r of rows) {
        tx.update(translations)
          .set({ nsfw: isNsfwCacheRow(String(r.src), r.engine) ? 1 : 0 })
          .where(rowPair(String(r.src), String(r.srcLang), String(r.tgtLang)))
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
  client.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
  const db = drizzle({ client }) as SharedCacheDb
  ensureSchema(db, client)
  ensureMatchIndex(client)
  return { db, path: resolved }
}
