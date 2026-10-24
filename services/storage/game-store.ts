import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { GAME_CONTENT_RELS, type GameContentKind } from '@/lib/game/content-paths'
import { type GameIdentityBaseline, verifyIdentity } from '@/lib/game/identity-signature'
import { resolveGame } from '@/lib/game/resolve'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { applyCacheRow, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'
import { computeGameSignature } from '@/services/game/identity-signature'
import type { SharedCacheDb } from '@/services/translate/shared-cache/db'

import { registerPublicGameDirectory, registerPublicGameWriter } from './game-files'
import { storageLibraryEntries } from './game-library'
import { legacyGameFile, migrateGameTranslations } from './migration/translation-migrator'

function safeRealpath(raw: string): string {
  try {
    return fs.existsSync(raw) ? fs.realpathSync(raw) : path.resolve(raw)
  } catch {
    return path.resolve(raw)
  }
}

export function createPublicGameStore(db: SharedCacheDb, dataDir: string) {
  const client = db.$client
  client.exec(`CREATE TABLE IF NOT EXISTS game_documents(game_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(game_id,kind));
    CREATE TABLE IF NOT EXISTS game_storage_revisions(game_id TEXT PRIMARY KEY NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS game_mutation_receipts(game_id TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(game_id,key));`)
  const mounted = new Map<string, { gameId: string; directory: string; signature: string }>()
  function atomic(file: string, body: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, body, { mode: 0o600 })
    fs.renameSync(tmp, file)
  }
  function document(gameId: string, kind: string): unknown {
    const row = client.prepare('SELECT body FROM game_documents WHERE game_id=? AND kind=?').get(gameId, kind) as { body: string } | undefined
    return row ? JSON.parse(row.body) : null
  }
  function rows(gameId: string): CacheRow[] {
    const records = client
      .prepare("SELECT src,zh,engine,is_deleted,updated_at,record_json FROM game_translations WHERE game_id=? AND tgt_lang='zh' ORDER BY src")
      .all(gameId) as Array<{
      src: string
      zh: string | null
      engine: string
      is_deleted: number
      updated_at: number
      record_json: string | null
    }>
    return records.map((row) => ({
      ...(row.record_json ? (JSON.parse(row.record_json) as CacheRow) : {}),
      s: row.src,
      t: row.is_deleted ? null : row.zh,
      engine: row.engine,
      at: row.updated_at,
    }))
  }
  function revision(gameId: string) {
    const row = client.prepare('SELECT revision FROM game_storage_revisions WHERE game_id=?').get(gameId) as { revision: number } | undefined
    return row?.revision ?? 0
  }
  function advanceRevision(gameId: string) {
    client.prepare('INSERT INTO game_storage_revisions VALUES(?,1) ON CONFLICT(game_id) DO UPDATE SET revision=revision+1').run(gameId)
  }
  function materialize(gameId: string, directory: string) {
    // These public files are rebuildable read views. Only this owner process writes them.
    atomic(
      path.join(directory, GAME_CONTENT_RELS.cacheNdjson),
      rows(gameId)
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n'
    )
    for (const kind of Object.keys(GAME_CONTENT_RELS) as GameContentKind[]) {
      const value = document(gameId, kind)
      if (value !== null) atomic(path.join(directory, GAME_CONTENT_RELS[kind]), JSON.stringify(value) + '\n')
    }
    atomic(path.join(directory, '.revision'), String(revision(gameId)))
  }
  function ensureViews(state: { gameId: string; directory: string }) {
    try {
      if (fs.readFileSync(path.join(state.directory, '.revision'), 'utf8') !== String(revision(state.gameId))) throw new Error('Stale view')
      if (!fs.existsSync(path.join(state.directory, GAME_CONTENT_RELS.cacheNdjson))) throw new Error('Missing view')
      for (const kind of Object.keys(GAME_CONTENT_RELS) as GameContentKind[]) {
        if (document(state.gameId, kind) !== null && !fs.existsSync(path.join(state.directory, GAME_CONTENT_RELS[kind]))) throw new Error('Missing document view')
      }
    } catch {
      materialize(state.gameId, state.directory)
    }
  }
  async function mount(rawRoot: string) {
    const root = safeRealpath(rawRoot)
    const existing = mounted.get(root)
    if (existing) {
      ensureViews(existing)
      return existing
    }
    const resolved = resolveGame(root)
    if (!resolved.ok) {
      const syntheticId = createHash('sha256').update(root).digest('hex').slice(0, 16)
      const syntheticDir = path.join(dataDir, 'translate-cache', 'games', syntheticId)
      fs.mkdirSync(syntheticDir, { recursive: true, mode: 0o700 })
      try {
        await migrateGameTranslations(db, { gameId: syntheticId, contentRoot: root })
      } catch {}
      for (const kind of ['seed', 'switches', 'translationPlay', 'translationPreview', 'gameEdit', 'inputAssistance', 'gameSaves'] as const) {
        if (document(syntheticId, kind) !== null) continue
        const source = legacyGameFile(root, kind)
        if (source) {
          try {
            const body = JSON.stringify(JSON.parse(fs.readFileSync(source, 'utf8')))
            client.prepare('INSERT OR IGNORE INTO game_documents VALUES(?,?,?)').run(syntheticId, kind, body)
          } catch {}
        }
      }
      const state = { gameId: syntheticId, directory: syntheticDir, signature: 'synthetic' }
      materialize(syntheticId, state.directory)
      mounted.set(root, state)
      registerPublicGameDirectory(root, state)
      registerPublicGameWriter(path.resolve(state.directory), (values, key) => appendMounted(state, values, key))
      return state
    }
    const signature = computeGameSignature(resolved)
    const canonicalRoot = safeRealpath(resolved.contentRoot)
    let libraryId: string | undefined
    try {
      libraryId = storageLibraryEntries().find((entry) => {
        if (entry.remote) return false
        try {
          const game = resolveGame(entry.gameRoot)
          return game.ok && safeRealpath(game.contentRoot) === canonicalRoot
        } catch {
          return false
        }
      })?.id
    } catch {
      /* A standalone plugin may register before a library entry exists. */
    }
    const byPath = client.prepare('SELECT * FROM game_identities WHERE bound_path=?').get(canonicalRoot) as Record<string, string | number> | undefined
    const byId = libraryId ? (client.prepare('SELECT * FROM game_identities WHERE game_id=?').get(libraryId) as Record<string, string | number> | undefined) : undefined
    let baseline = byId || byPath
    if (!baseline) {
      const matches = client
        .prepare('SELECT * FROM game_identities WHERE signature_baseline=? AND engine=? AND signature_version=?')
        .all(signature.signature, signature.engine, signature.signatureVersion)
      if (matches.length === 1) baseline = matches[0] as Record<string, string | number>
      else if (matches.length > 1) throw new Error('Ambiguous game identity; bind this game explicitly')
    }
    if (baseline) {
      const verification = verifyIdentity(
        {
          gameId: String(baseline.game_id),
          engine: baseline.engine,
          title: String(baseline.title),
          signatureBaseline: String(baseline.signature_baseline),
          signatureVersion: Number(baseline.signature_version),
        } as GameIdentityBaseline,
        signature
      )
      if (verification.status === 'MISMATCH') throw new Error(`Game identity MISMATCH; ${verification.details || 'confirm the changed game before reusing its data'}`)
    }
    const gameId = baseline ? String(baseline.game_id) : libraryId || randomUUID()
    client
      .prepare(
        `INSERT INTO game_identities(game_id,engine,title,signature_baseline,signature_version,bound_path,first_bound_at,last_verified_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET bound_path=excluded.bound_path,last_verified_at=excluded.last_verified_at,signature_baseline=excluded.signature_baseline,title=excluded.title`
      )
      .run(gameId, signature.engine, signature.title, signature.signature, signature.signatureVersion, canonicalRoot, Date.now(), Date.now())
    await migrateGameTranslations(db, { gameId, contentRoot: canonicalRoot })
    // Preserve source inventory, including untranslated entries, and game preferences once.
    for (const kind of ['seed', 'switches', 'translationPlay', 'translationPreview', 'gameEdit', 'inputAssistance', 'gameSaves'] as const) {
      if (document(gameId, kind) !== null) continue
      const source = legacyGameFile(canonicalRoot, kind)
      if (source) {
        const body = JSON.stringify(JSON.parse(fs.readFileSync(source, 'utf8')))
        client.prepare('INSERT OR IGNORE INTO game_documents VALUES(?,?,?)').run(gameId, kind, body)
      }
    }
    const state = { gameId, directory: path.join(dataDir, 'translate-cache', 'games', gameId), signature: signature.signature }
    materialize(gameId, state.directory)
    mounted.set(root, state)
    mounted.set(canonicalRoot, state)
    registerPublicGameDirectory(root, state)
    registerPublicGameDirectory(canonicalRoot, state)
    registerPublicGameWriter(path.resolve(state.directory), (values, key) => appendMounted(state, values, key))
    const registryFile = path.join(dataDir, 'runtime/game-directories.json')
    const registry: Record<string, typeof state> = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : {}
    registry[root] = state
    registry[canonicalRoot] = state
    atomic(registryFile, JSON.stringify(registry))
    return state
  }
  function appendMounted(state: { gameId: string; directory: string }, values: unknown[], key?: string) {
    if (!Array.isArray(values) || values.length > 500) throw new Error('Expected at most 500 cache events')
    if (key !== undefined && (typeof key !== 'string' || !key || key.length > 200)) throw new Error('Invalid mutation key')
    const requestHash = createHash('sha256').update(JSON.stringify(values)).digest('hex')
    const parsed = values.map((value) => {
      const row = parseCacheRow(value)
      if (!row) throw new Error('Invalid cache event')
      return row
    })
    const current = new Map(rows(state.gameId).map((row) => [row.s, row]))
    if (key) {
      const receipt = client.prepare('SELECT hash FROM game_mutation_receipts WHERE game_id=? AND key=?').get(state.gameId, key) as { hash: string } | undefined
      if (receipt) {
        if (receipt.hash !== requestHash) throw new Error('Mutation key reused for different content')
        ensureViews(state)
        return { ok: true, duplicated: true }
      }
    }
    client.exec('BEGIN IMMEDIATE')
    try {
      for (const row of parsed) {
        const old = current.get(row.s)
        // A shared invalidation must never erase an independent manual translation.
        if (row.t === null && row.origin) {
          applyCacheRow(current, row)
          if (current.get(row.s) === old) continue
          client.prepare('DELETE FROM game_translations WHERE game_id=? AND src=? AND src_lang=? AND tgt_lang=?').run(state.gameId, row.s, detectCacheLang(row.s), 'zh')
          continue
        }
        applyCacheRow(current, row)
        if (row.origin && current.get(row.s) === old) continue
        const body = JSON.stringify(row)
        client
          .prepare(
            `INSERT INTO game_translations(game_id,src,src_lang,tgt_lang,zh,engine,is_deleted,updated_at,record_json)
          VALUES(?,?,?,'zh',?,?,?,?,?) ON CONFLICT(game_id,src,src_lang,tgt_lang) DO UPDATE SET
          zh=excluded.zh,engine=excluded.engine,is_deleted=excluded.is_deleted,updated_at=excluded.updated_at,record_json=excluded.record_json`
          )
          .run(state.gameId, row.s, detectCacheLang(row.s), row.t, row.engine || 'manual', row.t === null ? 1 : 0, row.at || Date.now(), body)
      }
      advanceRevision(state.gameId)
      if (key) client.prepare('INSERT INTO game_mutation_receipts VALUES(?,?,?)').run(state.gameId, key, requestHash)
      client.exec('COMMIT')
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
    materialize(state.gameId, state.directory)
    return { ok: true }
  }
  async function append(root: string, values: unknown[], key?: string) {
    return appendMounted(await mount(root), values, key)
  }
  async function write(root: string, kind: string, value: unknown) {
    if ((!Object.hasOwn(GAME_CONTENT_RELS, kind) && !['agentHistory', 'companionTranscript'].includes(kind)) || kind === 'cacheNdjson') throw new Error('Unsupported game document')
    const state = await mount(root)
    client.exec('BEGIN IMMEDIATE')
    try {
      client.prepare('INSERT INTO game_documents VALUES(?,?,?) ON CONFLICT(game_id,kind) DO UPDATE SET body=excluded.body').run(state.gameId, kind, JSON.stringify(value))
      advanceRevision(state.gameId)
      client.exec('COMMIT')
    } catch (error) {
      client.exec('ROLLBACK')
      throw error
    }
    materialize(state.gameId, state.directory)
    return { ok: true }
  }
  return {
    mount,
    append,
    write,
    refresh(gameId: string) {
      advanceRevision(gameId)
      const state = [...mounted.values()].find((item) => item.gameId === gameId)
      if (state) materialize(gameId, state.directory)
    },
    async read(root: string, kind: string) {
      return document((await mount(root)).gameId, kind)
    },
  }
}
