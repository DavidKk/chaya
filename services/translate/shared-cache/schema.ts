import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
    /** Optional extract/live text category (dialogue, item, …); imports may leave null. */
    category: text('category'),
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

/** Game-local translations table with Tombstone (is_deleted) support */
export const gameTranslations = sqliteTable(
  'game_translations',
  {
    gameId: text('game_id').notNull(),
    src: text('src').notNull(),
    srcLang: text('src_lang').notNull().default('ja'),
    tgtLang: text('tgt_lang').notNull().default('zh'),
    zh: text('zh'),
    engine: text('engine').notNull().default('manual'),
    category: text('category'),
    isDeleted: integer('is_deleted').notNull().default(0),
    recordJson: text('record_json'),
    hitCount: integer('hit_count').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.src, table.srcLang, table.tgtLang] }),
    index('idx_game_trans_lookup').on(table.gameId, table.srcLang, table.tgtLang, table.isDeleted),
    index('idx_game_trans_updated').on(table.gameId, table.updatedAt),
  ]
)

export const gameIdentities = sqliteTable('game_identities', {
  gameId: text('game_id').primaryKey().notNull(),
  engine: text('engine').notNull(),
  title: text('title').notNull(),
  signatureBaseline: text('signature_baseline').notNull(),
  signatureVersion: integer('signature_version').notNull().default(1),
  boundPath: text('bound_path').notNull(),
  firstBoundAt: integer('first_bound_at').notNull(),
  lastVerifiedAt: integer('last_verified_at').notNull(),
})

export const mutationLog = sqliteTable('mutation_log', {
  idempotencyKey: text('idempotency_key').primaryKey().notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  requestHash: text('request_hash').notNull().default(''),
  resultJson: text('result_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
})

export const sharedCacheSchema = {
  translations,
  cacheMeta,
  gameTranslations,
  gameIdentities,
  mutationLog,
}
