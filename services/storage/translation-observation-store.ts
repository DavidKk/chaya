import type { DatabaseSync } from 'node:sqlite'

import type { TranslationObservation } from '@/lib/translate/observation'
import { canonicalResourceLanguage } from '@/lib/translate/resource-types'

function validate(value: unknown): TranslationObservation {
  if (!value || typeof value !== 'object') throw new Error('Invalid observation')
  const event = value as TranslationObservation
  if (
    typeof event.eventId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(event.eventId) ||
    !Number.isSafeInteger(event.occurredAt) ||
    event.occurredAt < 0 ||
    typeof event.sourceText !== 'string' ||
    !event.sourceText ||
    event.sourceText.length > 64000 ||
    (event.targetText !== null && (typeof event.targetText !== 'string' || event.targetText.length > 64000)) ||
    typeof event.error !== 'string' ||
    event.error.length > 16000
  )
    throw new Error('Invalid observation fields')
  for (const tag of [event.sourceLanguage, event.targetLanguage])
    if (typeof tag !== 'string' || canonicalResourceLanguage(tag) !== tag) throw new Error('Invalid observation language')
  if (JSON.stringify(event).length > 150000) throw new Error('Observation exceeds size limit')
  return event
}

export function createTranslationObservationStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS translation_observations(
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
    occurred_at INTEGER NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL,
    game_id TEXT, content TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_translation_observation_pair ON translation_observations(src_lang,tgt_lang,sequence);`)
  return {
    append(values: unknown[]) {
      if (!Array.isArray(values) || values.length > 40) throw new Error('Observation batch limit exceeded')
      const events = values.map(validate)
      db.exec('BEGIN IMMEDIATE')
      try {
        let inserted = 0
        for (const event of events) {
          const content = JSON.stringify(event)
          const old = db.prepare('SELECT content FROM translation_observations WHERE event_id=?').get(event.eventId) as { content: string } | undefined
          if (old && old.content !== content) throw new Error('Observation event ID reused with different content')
          inserted += Number(
            db
              .prepare('INSERT OR IGNORE INTO translation_observations(event_id,occurred_at,src_lang,tgt_lang,game_id,content) VALUES(?,?,?,?,?,?)')
              .run(event.eventId, event.occurredAt, event.sourceLanguage, event.targetLanguage, event.gameId || null, content).changes
          )
        }
        db.exec('COMMIT')
        return { inserted }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    export(options: { after?: number; sourceLanguage?: string; targetLanguage?: string; gameId?: string; since?: number } = {}) {
      if (!Number.isSafeInteger(options.after ?? 0) || (options.after ?? 0) < 0 || !Number.isSafeInteger(options.since ?? 0)) throw new Error('Invalid observation cursor')
      const rows = db
        .prepare(
          `SELECT sequence,content FROM translation_observations
        WHERE sequence>? AND occurred_at>=? AND (? IS NULL OR src_lang=?) AND (? IS NULL OR tgt_lang=?)
        AND (? IS NULL OR game_id=?) ORDER BY sequence LIMIT 200`
        )
        .all(
          options.after ?? 0,
          options.since ?? 0,
          options.sourceLanguage ?? null,
          options.sourceLanguage ?? null,
          options.targetLanguage ?? null,
          options.targetLanguage ?? null,
          options.gameId ?? null,
          options.gameId ?? null
        ) as { sequence: number; content: string }[]
      return { nextCursor: rows.at(-1)?.sequence ?? options.after ?? 0, items: rows.map((row) => JSON.parse(row.content) as TranslationObservation) }
    },
  }
}
