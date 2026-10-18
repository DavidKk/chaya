/** Persistent, rebuildable short-sentence index. Triggers keep every managed write in the same transaction. */
import type { DatabaseSync } from 'node:sqlite'

import { cacheEngineRank } from '@/lib/translate/cache-engine-rank'
import type { CacheLangPair } from '@/lib/translate/cache-lang'
import { buildLogicText, type NewlineAnnotation, validateNewlineAnnotations } from '@/lib/translate/logic-text'
import { sentenceAliases } from '@/lib/translate/sentence-aliases'
import type { PlanSentenceOptions } from '@/lib/translate/sentence-plan'
import { type AlignmentGroup, planSentenceTranslation, type SentenceRecord, validateAlignments } from '@/lib/translate/sentence-plan'
import { sentenceQueryKeys, sentenceQueryUnits } from '@/lib/translate/sentence-query'
import { SENTENCE_RULE_VERSION, sentenceUnits, wholeSentenceKey } from '@/lib/translate/sentence-units'
import { type RecordStructure, validRecordStructure } from '@/lib/translate/structured-segments'
import { isReusableTranslation } from '@/services/translate/text-classify'

export type IndexedRecord = SentenceRecord & { from: string; to: string }
type RecordRow = { id: number; revision: number; src: string; zh: string; engine: string | null; src_lang: string; tgt_lang: string }
const toRecord = (r: RecordRow): IndexedRecord => ({ id: String(r.id), revision: r.revision, src: r.src, zh: r.zh, engine: r.engine, from: r.src_lang, to: r.tgt_lang })

/** Older DBs created match_keys without `kind`; CREATE TABLE IF NOT EXISTS will not add it. */
function migrateMatchKeysKindColumn(client: DatabaseSync) {
  const cols = client.prepare('PRAGMA table_info(match_keys)').all() as Array<{ name: string }>
  if (!cols.length || cols.some((c) => c.name === 'kind')) return
  client.exec('BEGIN IMMEDIATE')
  try {
    // Drop triggers that touch match_keys first — DROP TABLE otherwise fails with
    // "error in trigger match_record_delete: no such table: main.match_keys".
    client.exec(`
      DROP TRIGGER IF EXISTS match_record_insert;
      DROP TRIGGER IF EXISTS match_record_update;
      DROP TRIGGER IF EXISTS match_record_delete;
      CREATE TABLE match_keys_kind (
        record_id INTEGER NOT NULL, match_key TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'canonical', PRIMARY KEY(record_id,match_key,kind)
      );
      INSERT OR IGNORE INTO match_keys_kind(record_id,match_key,src_lang,tgt_lang,kind)
        SELECT record_id, match_key, src_lang, tgt_lang, 'canonical' FROM match_keys;
      DROP TABLE match_keys;
      ALTER TABLE match_keys_kind RENAME TO match_keys;
      CREATE INDEX IF NOT EXISTS idx_match_key ON match_keys(src_lang,tgt_lang,match_key);
      DELETE FROM cache_meta WHERE key='sentence_index_v9_open_parenthetical_alias';
    `)
    client.exec('COMMIT')
  } catch (e) {
    client.exec('ROLLBACK')
    throw e
  }
}

export function ensureMatchIndex(client: DatabaseSync) {
  client.function('chaya_alias_keys', (src, zh) => JSON.stringify(sentenceAliases(String(src), String(zh)).map((p) => wholeSentenceKey(p.src))))
  client.function('chaya_sentence_key', (src) => wholeSentenceKey(String(src)))
  client.function('chaya_logic_key', (src) => wholeSentenceKey(buildLogicText(String(src)).logic))
  client.function('chaya_sentence_units', (src) => JSON.stringify(sentenceUnits(String(src))))
  // Create bare tables first so the kind-column migration can see an existing legacy match_keys.
  client.exec(`
    CREATE TABLE IF NOT EXISTS translation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT NOT NULL,
      src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      UNIQUE(src, src_lang, tgt_lang)
    );
    CREATE TABLE IF NOT EXISTS match_keys (
      record_id INTEGER NOT NULL, match_key TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'canonical', PRIMARY KEY(record_id,match_key,kind)
    );
    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `)
  migrateMatchKeysKindColumn(client)
  // UUID-like ids are not needed: AUTOINCREMENT ids survive VACUUM and are never reused after deletion.
  client.exec(`
    CREATE TABLE IF NOT EXISTS translation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT NOT NULL,
      src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      UNIQUE(src, src_lang, tgt_lang)
    );
    CREATE TABLE IF NOT EXISTS match_keys (
      record_id INTEGER NOT NULL, match_key TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'canonical', PRIMARY KEY(record_id,match_key,kind)
    );
    CREATE INDEX IF NOT EXISTS idx_match_key ON match_keys(src_lang,tgt_lang,match_key);
    CREATE TABLE IF NOT EXISTS sentence_positions (
      record_id INTEGER NOT NULL, position INTEGER NOT NULL, body_key TEXT NOT NULL, tone TEXT NOT NULL,
      src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, PRIMARY KEY(record_id,position)
    );
    CREATE INDEX IF NOT EXISTS idx_sentence_key ON sentence_positions(src_lang,tgt_lang,body_key,tone);
    CREATE TABLE IF NOT EXISTS alignment_groups (
      record_id INTEGER NOT NULL, revision INTEGER NOT NULL, groups_json TEXT NOT NULL, PRIMARY KEY(record_id)
    );
    CREATE TABLE IF NOT EXISTS structure_annotations (
      record_id INTEGER NOT NULL, revision INTEGER NOT NULL, annotations_json TEXT NOT NULL, PRIMARY KEY(record_id)
    );
    CREATE TABLE IF NOT EXISTS newline_annotations (
      record_id INTEGER NOT NULL, revision INTEGER NOT NULL, annotations_json TEXT NOT NULL, PRIMARY KEY(record_id)
    );
    CREATE TABLE IF NOT EXISTS translation_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL
    );
    INSERT OR IGNORE INTO cache_meta(key,value) VALUES ('sentence_version','0');
    DROP TRIGGER IF EXISTS match_record_insert;
    DROP TRIGGER IF EXISTS match_record_update;
    CREATE TRIGGER match_record_insert AFTER INSERT ON translation_records BEGIN
      INSERT INTO match_keys VALUES (NEW.id,chaya_sentence_key(NEW.src),NEW.src_lang,NEW.tgt_lang,'canonical');
      INSERT OR IGNORE INTO match_keys VALUES (NEW.id,chaya_logic_key(NEW.src),NEW.src_lang,NEW.tgt_lang,'logic');
      INSERT OR IGNORE INTO match_keys SELECT NEW.id,j.value,NEW.src_lang,NEW.tgt_lang,'alias' FROM json_each(chaya_alias_keys(NEW.src,(SELECT zh FROM translations WHERE src=NEW.src AND src_lang=NEW.src_lang AND tgt_lang=NEW.tgt_lang))) j;
      INSERT INTO sentence_positions SELECT NEW.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.key'),json_extract(j.value,'$.tone'),NEW.src_lang,NEW.tgt_lang FROM json_each(chaya_sentence_units(NEW.src)) AS j;
      UPDATE cache_meta SET value=CAST(value AS INTEGER)+1 WHERE key='sentence_version';
    END;
    CREATE TRIGGER match_record_update AFTER UPDATE ON translation_records BEGIN
      DELETE FROM alignment_groups WHERE record_id=NEW.id;
      DELETE FROM newline_annotations WHERE record_id=NEW.id;
      DELETE FROM structure_annotations WHERE record_id=NEW.id;
      DELETE FROM match_keys WHERE record_id=NEW.id AND kind IN ('alias','logic');
      DELETE FROM sentence_positions WHERE record_id=NEW.id;
      INSERT OR IGNORE INTO match_keys VALUES (NEW.id,chaya_logic_key(NEW.src),NEW.src_lang,NEW.tgt_lang,'logic');
      INSERT OR IGNORE INTO match_keys SELECT NEW.id,j.value,NEW.src_lang,NEW.tgt_lang,'alias' FROM json_each(chaya_alias_keys(NEW.src,(SELECT zh FROM translations WHERE src=NEW.src AND src_lang=NEW.src_lang AND tgt_lang=NEW.tgt_lang))) j;
      INSERT INTO sentence_positions SELECT NEW.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.key'),json_extract(j.value,'$.tone'),NEW.src_lang,NEW.tgt_lang FROM json_each(chaya_sentence_units(NEW.src)) AS j;
      INSERT INTO translation_outbox(record_id,revision,kind) VALUES (NEW.id,NEW.revision,'update');
      UPDATE cache_meta SET value=CAST(value AS INTEGER)+1 WHERE key='sentence_version';
    END;
    DROP TRIGGER IF EXISTS match_record_delete;
    CREATE TRIGGER match_record_delete AFTER DELETE ON translation_records BEGIN
      DELETE FROM match_keys WHERE record_id=OLD.id;
      DELETE FROM sentence_positions WHERE record_id=OLD.id;
      DELETE FROM alignment_groups WHERE record_id=OLD.id;
      DELETE FROM newline_annotations WHERE record_id=OLD.id;
      DELETE FROM structure_annotations WHERE record_id=OLD.id;
      INSERT INTO translation_outbox(record_id,revision,kind) VALUES (OLD.id,OLD.revision+1,'delete');
      UPDATE cache_meta SET value=CAST(value AS INTEGER)+1 WHERE key='sentence_version';
    END;
    CREATE TRIGGER IF NOT EXISTS translation_match_insert AFTER INSERT ON translations BEGIN
      INSERT INTO translation_records(src,src_lang,tgt_lang) VALUES(NEW.src,NEW.src_lang,NEW.tgt_lang);
    END;
    CREATE TRIGGER IF NOT EXISTS translation_match_update AFTER UPDATE OF zh,engine ON translations
      WHEN OLD.zh IS NOT NEW.zh OR OLD.engine IS NOT NEW.engine BEGIN
      UPDATE translation_records SET revision=revision+1 WHERE src=NEW.src AND src_lang=NEW.src_lang AND tgt_lang=NEW.tgt_lang;
    END;
    CREATE TRIGGER IF NOT EXISTS translation_match_delete AFTER DELETE ON translations BEGIN
      DELETE FROM translation_records WHERE src=OLD.src AND src_lang=OLD.src_lang AND tgt_lang=OLD.tgt_lang;
    END;
  `)
  // Backfill only once; original translations and their raw keys are never rewritten.
  if (!client.prepare("SELECT value FROM cache_meta WHERE key='sentence_index_v1'").get()) {
    client.exec('BEGIN IMMEDIATE')
    try {
      client.exec(`INSERT OR IGNORE INTO translation_records(src,src_lang,tgt_lang) SELECT src,src_lang,tgt_lang FROM translations;
        INSERT OR REPLACE INTO cache_meta(key,value) VALUES('sentence_index_v1','1');`)
      client.exec('COMMIT')
    } catch (e) {
      client.exec('ROLLBACK')
      throw e
    }
  }
  // Rebuild keys and positions for paired open-parenthetical aliases (rule v9); raw records remain unchanged.
  if (!client.prepare("SELECT value FROM cache_meta WHERE key='sentence_index_v9_open_parenthetical_alias'").get()) {
    client.exec('BEGIN IMMEDIATE')
    try {
      const rows = client.prepare('SELECT id, src, src_lang, tgt_lang, revision FROM translation_records').all() as Array<{
        id: number
        src: string
        src_lang: string
        tgt_lang: string
        revision: number
      }>
      const delPos = client.prepare('DELETE FROM sentence_positions WHERE record_id=?')
      const delKeys = client.prepare('DELETE FROM match_keys WHERE record_id=?')
      const insKey = client.prepare('INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)')
      const insPos = client.prepare('INSERT INTO sentence_positions VALUES (?,?,?,?,?,?)')
      const zhOf = client.prepare('SELECT zh FROM translations WHERE src=? AND src_lang=? AND tgt_lang=?')
      const structureOf = client.prepare('SELECT annotations_json FROM structure_annotations WHERE record_id=? AND revision=?')
      const nlOf = client.prepare('SELECT annotations_json FROM newline_annotations WHERE record_id=? AND revision=?')
      for (const row of rows) {
        const nlRow = nlOf.get(row.id, row.revision) as { annotations_json: string } | undefined
        const newlines = nlRow ? (JSON.parse(nlRow.annotations_json) as NewlineAnnotation[]) : undefined
        const st = structureOf.get(row.id, row.revision) as { annotations_json: string } | undefined
        const structure = st ? (JSON.parse(st.annotations_json) as RecordStructure) : undefined
        const unitOpts = { newlines, structure: structure?.source, srcLang: row.src_lang as 'ja' | 'en' | 'zh' | 'ko' }
        delPos.run(row.id)
        delKeys.run(row.id)
        const logicKey = wholeSentenceKey(buildLogicText(row.src, unitOpts).logic)
        const canon = wholeSentenceKey(row.src)
        insKey.run(row.id, canon, row.src_lang, row.tgt_lang, 'canonical')
        if (logicKey !== canon) insKey.run(row.id, logicKey, row.src_lang, row.tgt_lang, 'logic')
        const zh = (zhOf.get(row.src, row.src_lang, row.tgt_lang) as { zh: string } | undefined)?.zh ?? ''
        for (const alias of sentenceAliases(row.src, zh)) {
          insKey.run(row.id, wholeSentenceKey(alias.src), row.src_lang, row.tgt_lang, 'alias')
        }
        sentenceUnits(row.src, unitOpts).forEach((unit, position) => insPos.run(row.id, position, unit.key, unit.tone, row.src_lang, row.tgt_lang))
      }
      client.prepare("INSERT OR REPLACE INTO cache_meta(key,value) VALUES('sentence_index_v9_open_parenthetical_alias','1')").run()
      client.exec('COMMIT')
    } catch (e) {
      client.exec('ROLLBACK')
      throw e
    }
  }
}

export function createMatchIndex(client: DatabaseSync) {
  const joined = 'SELECT r.*,t.zh,t.engine FROM translation_records r JOIN translations t ON t.src=r.src AND t.src_lang=r.src_lang AND t.tgt_lang=r.tgt_lang'

  function reindexWithNewlines(row: RecordRow, newlines: NewlineAnnotation[] | undefined, structure?: RecordStructure) {
    const unitOpts = { newlines, structure: structure?.source, srcLang: row.src_lang as 'ja' | 'en' | 'zh' | 'ko' }
    client.prepare('DELETE FROM sentence_positions WHERE record_id=?').run(row.id)
    client.prepare("DELETE FROM match_keys WHERE record_id=? AND kind IN ('alias','logic')").run(row.id)
    const logicKey = wholeSentenceKey(buildLogicText(row.src, unitOpts).logic)
    const canon = wholeSentenceKey(row.src)
    if (logicKey !== canon) {
      client.prepare('INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)').run(row.id, logicKey, row.src_lang, row.tgt_lang, 'logic')
    }
    for (const alias of sentenceAliases(row.src, row.zh)) {
      client.prepare('INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)').run(row.id, wholeSentenceKey(alias.src), row.src_lang, row.tgt_lang, 'alias')
    }
    const units = sentenceUnits(row.src, unitOpts)
    const insertPos = client.prepare('INSERT INTO sentence_positions VALUES (?,?,?,?,?,?)')
    units.forEach((unit, position) => insertPos.run(row.id, position, unit.key, unit.tone, row.src_lang, row.tgt_lang))
  }

  function attach(row: RecordRow): IndexedRecord {
    const record = toRecord(row)
    const alignment = client.prepare('SELECT groups_json FROM alignment_groups WHERE record_id=? AND revision=?').get(row.id, row.revision) as { groups_json: string } | undefined
    if (alignment) record.alignments = JSON.parse(alignment.groups_json)
    const newlines = client.prepare('SELECT annotations_json FROM newline_annotations WHERE record_id=? AND revision=?').get(row.id, row.revision) as
      { annotations_json: string } | undefined
    if (newlines) record.newlines = JSON.parse(newlines.annotations_json) as NewlineAnnotation[]
    const structure = client.prepare('SELECT annotations_json FROM structure_annotations WHERE record_id=? AND revision=?').get(row.id, row.revision) as
      { annotations_json: string } | undefined
    if (structure) record.structure = JSON.parse(structure.annotations_json) as RecordStructure
    return record
  }
  function record(src: string, pair: CacheLangPair): IndexedRecord | null {
    const r = client.prepare(joined + ' WHERE r.src=? AND r.src_lang=? AND r.tgt_lang=?').get(src, pair.from, pair.to) as RecordRow | undefined
    return r ? attach(r) : null
  }
  function equivalent(src: string, pair: CacheLangPair): IndexedRecord[] {
    return (
      client
        .prepare(joined + " JOIN match_keys k ON k.record_id=r.id WHERE k.match_key=? AND k.src_lang=? AND k.tgt_lang=? AND k.kind='canonical' LIMIT 501")
        .all(wholeSentenceKey(src), pair.from, pair.to) as RecordRow[]
    ).map(attach)
  }
  function candidates(src: string, pair: CacheLangPair, opts?: PlanSentenceOptions): { records: IndexedRecord[]; limited: boolean } {
    const found = new Map<string, IndexedRecord>()
    const keyQuery = client.prepare(joined + ' JOIN match_keys k ON k.record_id=r.id WHERE k.match_key=? AND k.src_lang=? AND k.tgt_lang=? LIMIT 501')
    const lookupKeys = sentenceQueryKeys(src, opts)
    for (const key of lookupKeys) {
      for (const r of (keyQuery.all(key, pair.from, pair.to) as RecordRow[]).map(attach)) found.set(r.id, r)
    }
    const whole = [...found.values()]
    for (const unit of sentenceQueryUnits(src, opts)) {
      if (unit.boundary === 'structure') {
        const exactItems = keyQuery.all(wholeSentenceKey(src.slice(unit.start, unit.end)), pair.from, pair.to) as RecordRow[]
        if (exactItems.length > 500) return { records: whole.length > 500 ? [] : whole, limited: true }
        for (const r of exactItems.map(attach)) found.set(r.id, r)
      }
      const rows = client
        .prepare(joined + ' JOIN sentence_positions p ON p.record_id=r.id WHERE p.body_key=? AND p.tone=? AND p.src_lang=? AND p.tgt_lang=? LIMIT 501')
        .all(unit.key, unit.tone, pair.from, pair.to) as RecordRow[]
      if (rows.length > 500 || found.size > 500) return { records: whole.length > 500 ? [] : whole, limited: true }
      for (const row of rows) {
        const r = attach(row)
        found.set(r.id, r)
      }
    }
    return { records: [...found.values()], limited: false }
  }
  return {
    record,
    equivalent,
    candidates,
    version: () => String((client.prepare("SELECT value FROM cache_meta WHERE key='sentence_version'").get() as { value: string }).value),
    current(records: SentenceRecord[]) {
      return records.every(
        (r) => Number((client.prepare('SELECT revision FROM translation_records WHERE id=?').get(r.id) as { revision: number } | undefined)?.revision) === r.revision
      )
    },
    plan(src: string, pair: CacheLangPair, local: SentenceRecord[] = [], opts?: PlanSentenceOptions) {
      client.exec('BEGIN')
      try {
        const selected = candidates(src, pair, opts)
        const resolved = planSentenceTranslation(
          src,
          selected.limited ? [] : [...local, ...selected.records].filter((r) => pair.to !== 'zh' || isReusableTranslation(r.src, r.zh)),
          opts
        )
        const plan = {
          ...resolved,
          limited: selected.limited || resolved.limited,
          ruleVersion: SENTENCE_RULE_VERSION,
          corpusVersion: String((client.prepare("SELECT value FROM cache_meta WHERE key='sentence_version'").get() as { value: string }).value),
        }
        client.exec('COMMIT')
        return plan
      } catch (e) {
        client.exec('ROLLBACK')
        throw e
      }
    },

    setAlignment(src: string, pair: CacheLangPair, groups: AlignmentGroup[], expectedRevision?: number, opts?: { newlines?: NewlineAnnotation[]; structure?: RecordStructure }) {
      const r = record(src, pair)
      if (!r || (expectedRevision !== undefined && r.revision !== expectedRevision) || groups.length > 1000) return false
      // Trigger clears newline_annotations on revision bump — re-apply caller opts or prior annotations.
      const structure = opts?.structure ?? r.structure
      if (structure && !validRecordStructure(structure)) return false
      const nextNewlines = opts?.newlines !== undefined ? opts.newlines : r.newlines
      if (nextNewlines && !validateNewlineAnnotations(src, nextNewlines)) return false
      const draft = { ...r, newlines: nextNewlines, structure }
      if (!validateAlignments(draft, groups)) return false
      // Revision change invalidates outstanding plans as well as previous extraction mappings.
      client.exec('BEGIN IMMEDIATE')
      try {
        if (!client.prepare('UPDATE translation_records SET revision=revision+1 WHERE id=? AND revision=?').run(r.id, r.revision).changes) {
          client.exec('ROLLBACK')
          return false
        }
        const nextRevision = r.revision + 1
        client.prepare('INSERT OR REPLACE INTO alignment_groups VALUES(?,?,?)').run(r.id, nextRevision, JSON.stringify(groups))
        if (nextNewlines?.length) {
          client.prepare('INSERT OR REPLACE INTO newline_annotations VALUES(?,?,?)').run(r.id, nextRevision, JSON.stringify(nextNewlines))
        }
        const row = client.prepare(joined + ' WHERE r.id=?').get(r.id) as RecordRow
        if (structure) client.prepare('INSERT OR REPLACE INTO structure_annotations VALUES(?,?,?)').run(r.id, nextRevision, JSON.stringify(structure))
        reindexWithNewlines(row, nextNewlines, structure)
        client.exec('COMMIT')
        return true
      } catch (e) {
        client.exec('ROLLBACK')
        throw e
      }
    },
    authority(src: string, pair: CacheLangPair): IndexedRecord | null {
      const records = equivalent(src, pair)
      if (!records.length || records.length > 500) return null
      const rank = Math.max(...records.map((r) => cacheEngineRank(r.engine)))
      const top = records.filter((r) => cacheEngineRank(r.engine) === rank)
      if (new Set(top.map((r) => r.zh)).size !== 1) return top.find((r) => r.src === src) || null
      return top[0]
    },
  }
}
export type MatchIndex = ReturnType<typeof createMatchIndex>
