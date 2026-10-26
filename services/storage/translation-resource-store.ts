import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import { createResourceMatcher } from '@/lib/translate/resource-matcher'
import type { ActiveResourcePack, ResourceLanguage, ResourceSnapshot } from '@/lib/translate/resource-types'
import { defaultResourcePack } from '@/services/translate/resources/defaults'
import { parseResourcePack, serializeResourcePack } from '@/services/translate/resources/validate'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
type VersionRow = { pack_id: string; version: string; hash: string; content: string }

export function readResourceRevision(db: DatabaseSync): number {
  return Number((db.prepare('SELECT revision FROM translation_resource_state WHERE id=1').get() as { revision: number }).revision)
}

/** Read on an existing SQLite snapshot; never writes or initializes schema. */
export function readResourceSnapshot(db: DatabaseSync): ResourceSnapshot {
  const revision = readResourceRevision(db)
  const languages = db.prepare('SELECT tag, name FROM translation_languages ORDER BY tag').all() as ResourceLanguage[]
  const rows = db
    .prepare(
      `SELECT v.* FROM translation_resource_versions v
    JOIN translation_resource_activations a ON a.pack_id=v.pack_id AND a.version=v.version
    WHERE a.enabled=1 ORDER BY v.pack_id`
    )
    .all() as VersionRow[]
  const packs: ActiveResourcePack[] = rows.map((row) => ({ ...parseResourcePack(row.content), hash: row.hash, revision }))
  return { revision, languages, packs }
}

/** All mutations run on the storage daemon's serialized writer. */
export function createTranslationResourceStore(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_resource_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS translation_languages(tag TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS translation_resource_versions(
      pack_id TEXT NOT NULL, version TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL,
      PRIMARY KEY(pack_id, version));
    CREATE TABLE IF NOT EXISTS translation_resource_activations(
      pack_id TEXT PRIMARY KEY, version TEXT NOT NULL, enabled INTEGER NOT NULL);
  `)
  function transaction<T>(run: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const value = run()
      db.exec('COMMIT')
      return value
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  if (!db.prepare('SELECT 1 FROM translation_resource_state WHERE id=1').get()) {
    transaction(() => {
      const content = serializeResourcePack(defaultResourcePack)
      db.prepare('INSERT INTO translation_resource_versions VALUES(?, ?, ?, ?)').run('chaya.defaults', '1', digest(content), content)
      db.prepare('INSERT INTO translation_resource_activations VALUES(?, ?, 1)').run('chaya.defaults', '1')
      for (const { tag, name } of defaultResourcePack.manifest.languages) db.prepare('INSERT INTO translation_languages VALUES(?, ?)').run(tag, name)
      db.exec('INSERT INTO translation_resource_state VALUES(1, 1)')
    })
  }
  const advance = () => db.exec('UPDATE translation_resource_state SET revision=revision+1 WHERE id=1')
  function preview(input: string) {
    const pack = parseResourcePack(input)
    const content = serializeResourcePack(pack)
    const hash = digest(content)
    const revision = readResourceRevision(db)
    const existing = db.prepare('SELECT hash FROM translation_resource_versions WHERE pack_id=? AND version=?').get(pack.manifest.packId, pack.manifest.version) as
      { hash: string } | undefined
    if (existing && existing.hash !== hash) throw new Error('A resource version is immutable; choose a new version')
    const registered = new Set((db.prepare('SELECT tag FROM translation_languages').all() as { tag: string }[]).map((row) => row.tag))
    for (const language of pack.manifest.languages) registered.add(language.tag)
    for (const record of pack.records) {
      if (!registered.has(record.sourceLanguage) || !registered.has(record.targetLanguage)) throw new Error('Resource pair uses an unregistered language')
    }
    const snapshot = readResourceSnapshot(db)
    const candidate = { ...pack, hash, revision }
    const proposed = { ...snapshot, packs: [...snapshot.packs.filter((item) => item.manifest.packId !== pack.manifest.packId), candidate] }
    if (proposed.packs.reduce((sum, item) => sum + item.records.length, 0) > 10000) throw new Error('Active resource record limit exceeded')
    if (proposed.packs.length > 32 || Buffer.byteLength(JSON.stringify(proposed)) > 6_000_000) throw new Error('Active resource snapshot size limit exceeded')
    const matcher = createResourceMatcher(proposed)
    const conflicts = pack.records
      .filter(
        (record) =>
          record.type === 'entry' &&
          record.reviewStatus === 'reviewed' &&
          [record.sourceText, ...(record.aliases || [])].some(
            (source) =>
              !matcher.match(source, {
                sourceLanguage: record.sourceLanguage,
                targetLanguage: record.targetLanguage,
                ...(record.scope.kind === 'game' ? { gameId: record.scope.gameId } : {}),
                ...record.conditions,
              })
          )
      )
      .map((record) => record.entryId)
    return {
      packId: pack.manifest.packId,
      version: pack.manifest.version,
      hash,
      revision,
      records: pack.records.length,
      conflicts,
      token: digest(JSON.stringify([revision, hash])),
    }
  }
  return {
    preview,
    apply(input: string, token: string, activate = true) {
      return transaction(() => {
        const result = preview(input)
        if (result.token !== token) throw new Error('Resource preview is stale; preview again')
        if (db.prepare('SELECT 1 FROM translation_resource_versions WHERE pack_id=? AND version=?').get(result.packId, result.version)) {
          return result
        }
        const pack = parseResourcePack(input)
        db.prepare('INSERT OR IGNORE INTO translation_resource_versions VALUES(?, ?, ?, ?)').run(result.packId, result.version, result.hash, serializeResourcePack(pack))
        for (const { tag, name } of pack.manifest.languages) db.prepare('INSERT OR IGNORE INTO translation_languages VALUES(?, ?)').run(tag, name)
        if (!activate) {
          advance()
          return { ...result, revision: readResourceRevision(db) }
        }
        const current = db.prepare('SELECT version, enabled FROM translation_resource_activations WHERE pack_id=?').get(result.packId) as
          { version: string; enabled: number } | undefined
        if (current?.version !== result.version || !current.enabled) {
          db.prepare('INSERT INTO translation_resource_activations VALUES(?, ?, 1) ON CONFLICT(pack_id) DO UPDATE SET version=excluded.version, enabled=1').run(
            result.packId,
            result.version
          )
          advance()
        }
        return { ...result, revision: readResourceRevision(db) }
      })
    },
    activate(packId: string, version: string) {
      return transaction(() => {
        const row = db.prepare('SELECT content FROM translation_resource_versions WHERE pack_id=? AND version=?').get(packId, version) as { content: string } | undefined
        if (!row) throw new Error('Unknown resource version')
        const result = preview(row.content)
        db.prepare('INSERT INTO translation_resource_activations VALUES(?, ?, 1) ON CONFLICT(pack_id) DO UPDATE SET version=excluded.version, enabled=1').run(packId, version)
        advance()
        return { ...result, revision: readResourceRevision(db) }
      })
    },
    disable(packId: string) {
      return transaction(() => {
        if (db.prepare('UPDATE translation_resource_activations SET enabled=0 WHERE pack_id=? AND enabled=1').run(packId).changes) advance()
        return { revision: readResourceRevision(db) }
      })
    },
    list() {
      return db
        .prepare(
          `SELECT v.pack_id AS packId, v.version, v.hash,
        CASE WHEN a.version=v.version AND a.enabled=1 THEN 1 ELSE 0 END AS active
        FROM translation_resource_versions v LEFT JOIN translation_resource_activations a ON a.pack_id=v.pack_id ORDER BY v.pack_id, v.version`
        )
        .all()
    },
    export(packId: string, version: string) {
      const row = db.prepare('SELECT content FROM translation_resource_versions WHERE pack_id=? AND version=?').get(packId, version) as { content: string } | undefined
      if (!row) throw new Error('Unknown resource version')
      return row.content
    },
    snapshot: () => readResourceSnapshot(db),
  }
}
