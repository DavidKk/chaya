import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Shared translation-cache schema; column names match the SQLite database on disk. */
export const translations = sqliteTable(
  'translations',
  {
    src: text('src').notNull(),
    zh: text('zh').notNull(),
    /** Source language of `src` (ja / en / zh / ko). */
    srcLang: text('src_lang').notNull().default('ja'),
    /** Target language of `zh` (ja / en / zh / ko). */
    tgtLang: text('tgt_lang').notNull().default('zh'),
    engine: text('engine'),
    updatedAt: integer('updated_at').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    nsfw: integer('nsfw').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.src, table.srcLang, table.tgtLang] })]
)

export const cacheMeta = sqliteTable('cache_meta', {
  key: text('key').primaryKey().notNull(),
  value: text('value').notNull(),
})

export const sharedCacheSchema = { translations, cacheMeta }
