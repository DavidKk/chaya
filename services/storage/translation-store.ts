import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import { and, asc, eq, gt, inArray } from 'drizzle-orm'

import type { SharedCacheDb } from '@/services/translate/shared-cache/db'
import { gameTranslations, mutationLog, translations } from '@/services/translate/shared-cache/schema'

export type TranslationCommitEntry = {
  src: string
  zh?: string | null
  srcLang?: string
  tgtLang?: string
  engine?: string
  category?: string | null
  isDeleted?: boolean | number
}

export type TranslationCommitInput = {
  gameId: string
  actor: string
  action?: string
  idempotencyKey?: string
  entries: TranslationCommitEntry[]
}

export type TranslationCommitResult = {
  ok: boolean
  duplicated?: boolean
  appliedCount: number
}

export type TranslationLookupResult = {
  src: string
  zh: string | null
  engine: string | null
  scope: 'game' | 'shared' | 'none'
  isDeleted: boolean
}

/**
 * High-performance query adhering strictly to Tombstone semantics:
 * 1. Checks game_translations for gameId:
 *    - If hit and is_deleted = 0: return game-level translation.
 *    - If hit and is_deleted = 1: return tombstone (BLOCKED from falling back to shared_translations).
 * 2. If not hit in game_translations:
 *    - Checks shared translations table.
 *    - If hit: return shared translation.
 * 3. Otherwise returns none.
 */
export function lookupTranslation(db: SharedCacheDb, gameId: string, src: string, srcLang = 'ja', tgtLang = 'zh'): TranslationLookupResult {
  const gameRow = db
    .select({
      zh: gameTranslations.zh,
      engine: gameTranslations.engine,
      isDeleted: gameTranslations.isDeleted,
    })
    .from(gameTranslations)
    .where(and(eq(gameTranslations.gameId, gameId), eq(gameTranslations.src, src), eq(gameTranslations.srcLang, srcLang), eq(gameTranslations.tgtLang, tgtLang)))
    .get()

  if (gameRow) {
    if (gameRow.isDeleted === 1) {
      return {
        src,
        zh: null,
        engine: gameRow.engine,
        scope: 'game',
        isDeleted: true,
      }
    }
    return {
      src,
      zh: gameRow.zh ?? null,
      engine: gameRow.engine,
      scope: 'game',
      isDeleted: false,
    }
  }

  const sharedRow = db
    .select({
      zh: translations.zh,
      engine: translations.engine,
    })
    .from(translations)
    .where(and(eq(translations.src, src), eq(translations.srcLang, srcLang), eq(translations.tgtLang, tgtLang)))
    .get()

  if (sharedRow && sharedRow.zh) {
    return {
      src,
      zh: sharedRow.zh,
      engine: sharedRow.engine,
      scope: 'shared',
      isDeleted: false,
    }
  }

  return {
    src,
    zh: null,
    engine: null,
    scope: 'none',
    isDeleted: false,
  }
}

/**
 * Commit a batch of translation mutations with idempotency checking and tombstone management.
 */
export function commitTranslations(db: SharedCacheDb, input: TranslationCommitInput): TranslationCommitResult {
  if (!input || typeof input !== 'object' || typeof input.gameId !== 'string' || !input.gameId.trim() || input.gameId.length > 200) throw new TypeError('gameId is required')
  if (typeof input.actor !== 'string' || !input.actor.trim() || input.actor.length > 200) throw new TypeError('actor is required')
  if (input.action !== undefined && (typeof input.action !== 'string' || input.action.length > 200)) throw new TypeError('Invalid action')
  if (!Array.isArray(input.entries) || input.entries.length === 0 || input.entries.length > 500) throw new TypeError('Commit requires 1 to 500 entries')
  if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey || input.idempotencyKey.length > 200))
    throw new TypeError('Invalid idempotency key')
  for (const entry of input.entries) {
    if (!entry || typeof entry.src !== 'string' || !entry.src.trim() || entry.src.length > 16000) throw new TypeError('Invalid source text')
    if (entry.isDeleted !== undefined && ![true, false, 0, 1].includes(entry.isDeleted)) throw new TypeError('Invalid deletion flag')
    if (!entry.isDeleted && (typeof entry.zh !== 'string' || !entry.zh.trim())) throw new TypeError('Translation text is required')
    if (entry.zh != null && (typeof entry.zh !== 'string' || entry.zh.length > 16000)) throw new TypeError('Invalid translation text')
    for (const value of [entry.srcLang, entry.tgtLang, entry.engine, entry.category]) {
      if (value != null && (typeof value !== 'string' || !value.trim() || value.length > 100)) throw new TypeError('Invalid translation metadata')
    }
  }
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        gameId: input.gameId,
        actor: input.actor,
        action: input.action || 'commit',
        entries: input.entries.map((entry) => [
          entry.src,
          entry.zh ?? null,
          entry.srcLang || 'ja',
          entry.tgtLang || 'zh',
          entry.engine || 'manual',
          entry.category ?? null,
          Boolean(entry.isDeleted),
        ]),
      })
    )
    .digest('hex')
  const now = Date.now()
  const client: DatabaseSync = db.$client

  const insertGameTrans = client.prepare(`
    INSERT INTO game_translations (
      game_id, src, src_lang, tgt_lang, zh, engine, category, is_deleted, hit_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(game_id, src, src_lang, tgt_lang) DO UPDATE SET
      zh = excluded.zh,
      engine = excluded.engine,
      category = COALESCE(excluded.category, game_translations.category),
      is_deleted = excluded.is_deleted,
      updated_at = excluded.updated_at,
      record_json = NULL
  `)

  const insertMutation = client.prepare(`
    INSERT INTO mutation_log (idempotency_key, actor, action, created_at, request_hash, result_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  let appliedCount = 0

  client.exec('BEGIN IMMEDIATE')
  try {
    if (input.idempotencyKey) {
      const previous = db.select().from(mutationLog).where(eq(mutationLog.idempotencyKey, input.idempotencyKey)).get()
      if (previous) {
        if (previous.requestHash !== requestHash) throw new TypeError('Idempotency key was already used for a different request')
        client.exec('COMMIT')
        return { ok: true, duplicated: true, appliedCount: 0 }
      }
    }
    for (const entry of input.entries) {
      const src = entry.src
      const srcLang = entry.srcLang || 'ja'
      const tgtLang = entry.tgtLang || 'zh'
      const isDel = entry.isDeleted ? 1 : 0
      const zh = isDel ? (entry.zh ?? null) : (entry.zh ?? '')
      const engine = entry.engine || 'manual'
      const category = entry.category || null

      insertGameTrans.run(input.gameId, src, srcLang, tgtLang, zh, engine, category, isDel, now)
      appliedCount++
    }

    if (input.idempotencyKey) {
      insertMutation.run(input.idempotencyKey, input.actor, input.action || 'commit', now, requestHash, JSON.stringify({ appliedCount }))
    }

    client.exec('COMMIT')
  } catch (error) {
    client.exec('ROLLBACK')
    throw error
  }

  return { ok: true, duplicated: false, appliedCount }
}

/**
 * Fetch bounded snapshot for game client:
 * 1. A keyset page of game-scoped translations, including tombstones.
 * 2. Shared common/system translations only.
 */
export function getBoundedSnapshot(
  db: SharedCacheDb,
  gameId: string,
  srcLang = 'ja',
  tgtLang = 'zh',
  options: { gameAfter?: string; sharedAfter?: string; pageSize?: number } = {}
) {
  const pageSize = Math.min(200, Math.max(1, Math.floor(options.pageSize || 100)))
  const gameRows = db
    .select({
      src: gameTranslations.src,
      zh: gameTranslations.zh,
      engine: gameTranslations.engine,
      category: gameTranslations.category,
      isDeleted: gameTranslations.isDeleted,
      updatedAt: gameTranslations.updatedAt,
    })
    .from(gameTranslations)
    .where(
      and(
        eq(gameTranslations.gameId, gameId),
        eq(gameTranslations.srcLang, srcLang),
        eq(gameTranslations.tgtLang, tgtLang),
        options.gameAfter ? gt(gameTranslations.src, options.gameAfter) : undefined
      )
    )
    .orderBy(asc(gameTranslations.src))
    .limit(pageSize + 1)
    .all()

  const sharedRows = db
    .select({
      src: translations.src,
      zh: translations.zh,
      engine: translations.engine,
      category: translations.category,
      updatedAt: translations.updatedAt,
    })
    .from(translations)
    .where(
      and(
        eq(translations.srcLang, srcLang),
        eq(translations.tgtLang, tgtLang),
        inArray(translations.category, ['system', 'menu', 'common']),
        options.sharedAfter ? gt(translations.src, options.sharedAfter) : undefined
      )
    )
    .orderBy(asc(translations.src))
    .limit(pageSize + 1)
    .all()

  return {
    gameId,
    srcLang,
    tgtLang,
    gameTranslations: gameRows.slice(0, pageSize),
    sharedTranslations: sharedRows.slice(0, pageSize),
    nextGameAfter: gameRows.length > pageSize ? gameRows[pageSize - 1].src : null,
    nextSharedAfter: sharedRows.length > pageSize ? sharedRows[pageSize - 1].src : null,
    generatedAt: Date.now(),
  }
}
