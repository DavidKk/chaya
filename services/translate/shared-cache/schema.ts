import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** 共享翻译缓存表（Drizzle schema；列名与盘上 SQLite 一致） */
export const translations = sqliteTable('translations', {
  src: text('src').primaryKey().notNull(),
  zh: text('zh').notNull(),
  engine: text('engine'),
  updatedAt: integer('updated_at').notNull(),
  hitCount: integer('hit_count').notNull().default(0),
  nsfw: integer('nsfw').notNull().default(0),
})

export const cacheMeta = sqliteTable('cache_meta', {
  key: text('key').primaryKey().notNull(),
  value: text('value').notNull(),
})

export const sharedCacheSchema = { translations, cacheMeta }
