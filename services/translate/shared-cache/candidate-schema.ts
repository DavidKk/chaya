import type { DatabaseSync } from 'node:sqlite'

/** Preserve public row ids and sentence origins while replacing the source-unique catalog. */
export function ensureCandidateSchema(client: DatabaseSync) {
  const columns = client.prepare('PRAGMA table_info(translations)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'id')) {
    client.exec('BEGIN IMMEDIATE')
    try {
      client.exec(`
        DROP TRIGGER IF EXISTS translation_match_insert;
        DROP TRIGGER IF EXISTS translation_match_update;
        DROP TRIGGER IF EXISTS translation_match_delete;
        DROP TRIGGER IF EXISTS match_record_insert;
        DROP TRIGGER IF EXISTS match_record_update;
        DROP TRIGGER IF EXISTS match_record_delete;
        CREATE TABLE translation_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          src TEXT NOT NULL, zh TEXT NOT NULL,
          src_lang TEXT NOT NULL DEFAULT 'ja', tgt_lang TEXT NOT NULL DEFAULT 'zh',
          engine TEXT, category TEXT, updated_at INTEGER NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0, nsfw INTEGER NOT NULL DEFAULT 0,
          engine_rank INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO translation_candidates
          SELECT rowid,src,zh,src_lang,tgt_lang,engine,category,updated_at,hit_count,nsfw,
            CASE
              WHEN engine='manual' THEN 4
              WHEN engine='import' OR engine LIKE 'import:%' THEN 3
              WHEN engine='live:optimize' OR engine LIKE 'live:optimize:%' OR engine LIKE 'live:agent%' THEN 2
              WHEN engine='manual:optimize' THEN 0
              ELSE 1
            END
          FROM translations;
      `)
      const records = client.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='translation_records'").get()
      if (records) {
        const sequence = client.prepare("SELECT seq FROM sqlite_sequence WHERE name='translation_records'").get() as { seq: number } | undefined
        client.exec(`
          CREATE TABLE candidate_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT NOT NULL,
            src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
            translation_id INTEGER NOT NULL UNIQUE
          );
          INSERT INTO candidate_records
            SELECT r.id,r.src,r.src_lang,r.tgt_lang,r.revision,t.id
            FROM translation_records r JOIN translation_candidates t
              ON t.src=r.src AND t.src_lang=r.src_lang AND t.tgt_lang=r.tgt_lang;
          DROP TABLE translation_records;
          ALTER TABLE candidate_records RENAME TO translation_records;
        `)
        if (sequence) client.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='translation_records'").run(sequence.seq)
      }
      client.exec(`
        DROP TABLE translations;
        ALTER TABLE translation_candidates RENAME TO translations;
        INSERT OR REPLACE INTO cache_meta(key,value) VALUES('translation_candidates_v1','1');
      `)
      client.exec('COMMIT')
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
  }
  client.exec(`
    CREATE INDEX IF NOT EXISTS idx_translation_selection
      ON translations(src,src_lang,tgt_lang,engine_rank DESC,updated_at DESC,id DESC);
    CREATE VIEW IF NOT EXISTS selected_translations AS
      SELECT t.* FROM translations t
      WHERE t.id=(
        SELECT candidate.id FROM translations candidate
        WHERE candidate.src=t.src AND candidate.src_lang=t.src_lang AND candidate.tgt_lang=t.tgt_lang
        ORDER BY candidate.engine_rank DESC,candidate.updated_at DESC,candidate.id DESC LIMIT 1
      );
  `)
}
