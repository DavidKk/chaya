/** IndexedDB persistence adapter for companion memory (Cloud / browser). */

import { applyWriteBatch, batchFingerprint, emptyMemorySnapshot, filterSnapshotToGame, snapshotLogicalBytes } from '@/lib/game-agent/companion/memory-durable'
import { MemoryConflictError, MemoryStaleError, validateWriteBatch } from '@/lib/game-agent/companion/memory-schema'
import {
  MEMORY_SCHEMA_VERSION,
  type MemoryBackend,
  type MemoryEpisodeRecord,
  type MemoryEvidenceRecord,
  type MemoryPreferenceRecord,
  type MemorySaveLink,
  type MemoryStoreSnapshot,
  type MemoryWriteBatch,
} from '@/lib/game-agent/companion/memory-types'

type MetaRecord = {
  id: string
  schemaVersion: number
  memoryEpoch: number
  recordingRevision: number
  recordingEnabled: boolean
  generation: number
  usedBytes?: number
}

type EpisodeRow = MemoryEpisodeRecord & { id: string; gameKey: string; libraryGameId: string }
type EvidenceRow = { id: string; episodeId: string; gameKey: string; libraryGameId: string; record: MemoryEvidenceRecord }
type ProjectionRow = { id: string; gameKey: string; libraryGameId: string; record: MemoryStoreSnapshot['projections'][number] }
type SaveLinkRow = MemorySaveLink & { id: string; gameKey: string; libraryGameId: string; linkId?: string }
type PreferenceRow = MemoryPreferenceRecord & { id: string; libraryGameId: string }
type BatchRow = { id: string; libraryGameId: string; fingerprint: string; at: number }

type GameRows = {
  episodes: EpisodeRow[]
  saveLinks: SaveLinkRow[]
  preferences: PreferenceRow[]
  evidence: EvidenceRow[]
  projections: ProjectionRow[]
}

const DB_NAME = 'chaya-companion-memory'
const DB_VERSION = 3
const META = 'metadata'
const EPISODES = 'episodes'
const EVIDENCE = 'evidence'
const PROJECTIONS = 'projections'
const SAVE_LINKS = 'saveLinks'
const PREFERENCES = 'preferences'
const BATCHES = 'batches'
const BATCHES_PER_GAME_MAX = 128
const BATCHES_GLOBAL_MAX = 256

let opens = Promise.resolve<IDBDatabase | null>(null)

function gameKey(scope: { libraryGameId: string; dataRevision: string; playthroughId: string }) {
  return `${scope.libraryGameId}\0${scope.dataRevision}\0${scope.playthroughId}`
}

function preferenceId(pref: Pick<MemoryPreferenceRecord, 'libraryGameId' | 'scope' | 'key'>) {
  return `${pref.libraryGameId || ''}::${pref.scope || ''}::${pref.key}`
}

function metaId(gameId: string) {
  return `meta:${gameId}`
}

function gameIdFromMeta(id: string) {
  return id.startsWith('meta:') ? id.slice(5) : id
}

function batchRowId(gameId: string, batchId: string) {
  return `${gameId}::${batchId}`
}

function episodeRowId(gameId: string, episodeId: string) {
  return `${gameId}::${episodeId}`
}

function saveLinkRowId(gameId: string, id: string) {
  return `${gameId}::${id}`
}

function projectionRowId(gameId: string, key: unknown) {
  return `${gameId}::${JSON.stringify(key)}`
}

function stripGamePrefix(id: string, gameId: string) {
  const prefix = `${gameId}::`
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

function defaultMeta(gameId: string): MetaRecord {
  return {
    id: metaId(gameId),
    schemaVersion: MEMORY_SCHEMA_VERSION,
    memoryEpoch: 1,
    recordingRevision: 1,
    recordingEnabled: true,
    generation: 1,
  }
}

function inferLibraryGameId(value: {
  libraryGameId?: string
  scope?: { libraryGameId?: string }
  gameKey?: string
  record?: { scope?: { libraryGameId?: string }; key?: { libraryGameId?: string } }
  key?: { libraryGameId?: string }
}): string {
  return (
    value.libraryGameId ||
    value.scope?.libraryGameId ||
    value.record?.scope?.libraryGameId ||
    value.record?.key?.libraryGameId ||
    value.key?.libraryGameId ||
    (value.gameKey ? value.gameKey.split('\0')[0] || value.gameKey.split('::')[0] : '') ||
    ''
  )
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false })
}

function migrateKeyedStore(
  store: IDBObjectStore,
  nextId: (value: Record<string, unknown>, gameId: string) => string | null,
  extra?: (value: Record<string, unknown>, gameId: string) => Record<string, unknown>
) {
  const req = store.openCursor()
  req.onsuccess = () => {
    const cursor = req.result
    if (!cursor) return
    const value = cursor.value as Record<string, unknown>
    const gameId = inferLibraryGameId(value as never)
    const id = gameId ? nextId(value, gameId) : null
    if (!id || !gameId) {
      cursor.continue()
      return
    }
    const next = { ...value, ...(extra?.(value, gameId) || {}), id, libraryGameId: gameId }
    if (cursor.key !== id) {
      store.put(next)
      cursor.delete()
    } else if (value.libraryGameId !== gameId) {
      cursor.update(next)
    }
    cursor.continue()
  }
}

function seedMissingGameMetas(tx: IDBTransaction) {
  const seen = new Set<string>()
  const metaStore = tx.objectStore(META)
  const walk = (storeName: string) => {
    const req = tx.objectStore(storeName).openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const gameId = inferLibraryGameId(cursor.value as never)
      if (gameId && !seen.has(gameId)) {
        seen.add(gameId)
        const get = metaStore.get(metaId(gameId))
        get.onsuccess = () => {
          if (!get.result) metaStore.put(defaultMeta(gameId))
        }
      }
      cursor.continue()
    }
  }
  walk(EPISODES)
  walk(EVIDENCE)
  walk(SAVE_LINKS)
  walk(PROJECTIONS)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(EPISODES)) db.createObjectStore(EPISODES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(EVIDENCE)) db.createObjectStore(EVIDENCE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(PROJECTIONS)) db.createObjectStore(PROJECTIONS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SAVE_LINKS)) db.createObjectStore(SAVE_LINKS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(PREFERENCES)) db.createObjectStore(PREFERENCES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BATCHES)) db.createObjectStore(BATCHES, { keyPath: 'id' })
      const tx = open.transaction
      if (!tx) return
      ensureIndex(tx.objectStore(EPISODES), 'byLibraryGame', 'libraryGameId')
      ensureIndex(tx.objectStore(EVIDENCE), 'byLibraryGame', 'libraryGameId')
      ensureIndex(tx.objectStore(PROJECTIONS), 'byLibraryGame', 'libraryGameId')
      ensureIndex(tx.objectStore(SAVE_LINKS), 'byLibraryGame', 'libraryGameId')
      ensureIndex(tx.objectStore(PREFERENCES), 'byLibraryGame', 'libraryGameId')
      ensureIndex(tx.objectStore(BATCHES), 'byLibraryGame', 'libraryGameId')
      migrateKeyedStore(tx.objectStore(EPISODES), (value, gameId) => {
        const episodeId = typeof value.episodeId === 'string' ? value.episodeId : stripGamePrefix(String(value.id || ''), gameId)
        return episodeId ? episodeRowId(gameId, episodeId) : null
      })
      migrateKeyedStore(tx.objectStore(EVIDENCE), (value, gameId) => {
        const episodeId = typeof value.episodeId === 'string' ? value.episodeId : stripGamePrefix(String(value.id || ''), gameId)
        return episodeId ? episodeRowId(gameId, episodeId) : null
      })
      migrateKeyedStore(
        tx.objectStore(SAVE_LINKS),
        (value, gameId) => {
          const linkId = typeof value.linkId === 'string' ? value.linkId : stripGamePrefix(String(value.id || ''), gameId)
          return linkId ? saveLinkRowId(gameId, linkId) : null
        },
        (value, gameId) => ({
          linkId: typeof value.linkId === 'string' ? value.linkId : stripGamePrefix(String(value.id || ''), gameId),
        })
      )
      migrateKeyedStore(tx.objectStore(PROJECTIONS), (value, gameId) => {
        const record = value.record as { key?: unknown } | undefined
        const key = record?.key ?? value.key
        return key == null ? null : projectionRowId(gameId, key)
      })
      migrateKeyedStore(tx.objectStore(PREFERENCES), (value, gameId) => {
        const pref = value as MemoryPreferenceRecord & { id?: string }
        return preferenceId({ ...pref, libraryGameId: pref.libraryGameId || gameId })
      })
      seedMissingGameMetas(tx)
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error || new Error('Failed to open companion memory database'))
  })
}

function withTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction, fail: (error: Error) => void) => void,
  result: () => T
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode)
    let failure: Error | undefined
    const fail = (error: Error) => {
      failure = error
      try {
        transaction.abort()
      } catch {
        /* already aborting */
      }
    }
    try {
      run(transaction, fail)
    } catch (error) {
      reject(error)
      return
    }
    transaction.oncomplete = () => (failure ? reject(failure) : resolve(result()))
    transaction.onerror = () => reject(failure || transaction.error || new Error('Companion memory transaction failed'))
    transaction.onabort = () => reject(failure || transaction.error || new Error('Companion memory transaction aborted'))
  })
}

function collectByGame<T>(store: IDBObjectStore, gameId: string, done: (rows: T[]) => void) {
  const rows: T[] = []
  const req = store.index('byLibraryGame').openCursor(IDBKeyRange.only(gameId))
  req.onsuccess = () => {
    const cursor = req.result
    if (!cursor) {
      done(rows)
      return
    }
    rows.push(cursor.value as T)
    cursor.continue()
  }
}

function collectGameRows(transaction: IDBTransaction, gameId: string, done: (rows: GameRows) => void) {
  collectByGame<EpisodeRow>(transaction.objectStore(EPISODES), gameId, (episodes) => {
    collectByGame<SaveLinkRow>(transaction.objectStore(SAVE_LINKS), gameId, (saveLinks) => {
      collectByGame<EvidenceRow>(transaction.objectStore(EVIDENCE), gameId, (evidence) => {
        collectByGame<ProjectionRow>(transaction.objectStore(PROJECTIONS), gameId, (projections) => {
          collectByGame<PreferenceRow>(transaction.objectStore(PREFERENCES), gameId, (boundPrefs) => {
            collectByGame<PreferenceRow>(transaction.objectStore(PREFERENCES), '', (unboundPrefs) => {
              done({ episodes, saveLinks, evidence, projections, preferences: [...boundPrefs, ...unboundPrefs] })
            })
          })
        })
      })
    })
  })
}

function preferComposite<T extends { id: string }>(rows: T[], gameId: string): T[] {
  const prefix = `${gameId}::`
  const selected = new Map<string, T>()
  for (const row of rows) {
    const logical = row.id.startsWith(prefix) ? row.id.slice(prefix.length) : row.id
    const current = selected.get(logical)
    if (!current || (row.id.startsWith(prefix) && !current.id.startsWith(prefix))) selected.set(logical, row)
  }
  return [...selected.values()]
}

function snapshotFromRows(meta: MetaRecord, rows: GameRows): MemoryStoreSnapshot {
  const gameId = gameIdFromMeta(meta.id)
  return emptyMemorySnapshot({
    memoryEpoch: meta.memoryEpoch,
    recordingRevision: meta.recordingRevision,
    recordingEnabled: meta.recordingEnabled,
    generation: meta.generation,
    episodes: preferComposite(rows.episodes, gameId).map(({ id: _id, gameKey: _gameKey, libraryGameId: _libraryGameId, ...episode }) => episode),
    saveLinks: preferComposite(rows.saveLinks, gameId).map(({ id: rowId, gameKey: _gameKey, libraryGameId: _libraryGameId, linkId, ...link }) => ({
      ...link,
      id: linkId || stripGamePrefix(rowId, gameId),
    })),
    preferences: rows.preferences.map(({ id: _id, ...pref }) => pref),
    evidence: preferComposite(rows.evidence, gameId).map((row) => row.record),
    projections: preferComposite(rows.projections, gameId).map((row) => row.record),
  })
}

function evidenceFromEpisode(episode: MemoryEpisodeRecord): MemoryEvidenceRecord {
  return {
    episodeId: episode.episodeId,
    scope: episode.scope,
    encounterId: episode.encounterId,
    sourceRefs: episode.sourceEventIds || [],
    completeness: episode.completeness,
    persistence: 'committed',
    summary: episode.summary,
    evidence: episode.evidence,
    memoryEpoch: episode.memoryEpoch,
    bytes: episode.bytes,
  }
}

function logicalEvidence(next: MemoryStoreSnapshot): MemoryEvidenceRecord[] {
  if (next.evidence.length) return next.evidence
  return next.episodes.map(evidenceFromEpisode)
}

function deleteRowAndLegacy(store: IDBObjectStore, _gameId: string, logicalId: string, compositeId: string) {
  store.delete(compositeId)
  if (logicalId && logicalId !== compositeId) store.delete(logicalId)
}

function pruneGameBatches(store: IDBObjectStore, gameId: string) {
  collectByGame<BatchRow>(store, gameId, (rows) => {
    const stale = rows.sort((a, b) => b.at - a.at).slice(BATCHES_PER_GAME_MAX)
    for (const row of stale) store.delete(row.id)
    const allReq = store.openCursor()
    const kept: BatchRow[] = []
    allReq.onsuccess = () => {
      const cursor = allReq.result
      if (cursor) {
        kept.push(cursor.value as BatchRow)
        cursor.continue()
        return
      }
      kept
        .sort((a, b) => b.at - a.at)
        .slice(BATCHES_GLOBAL_MAX)
        .forEach((row) => store.delete(row.id))
    }
  })
}

function persistSnapshot(transaction: IDBTransaction, gameId: string, previous: MemoryStoreSnapshot, next: MemoryStoreSnapshot, batch: MemoryWriteBatch, fingerprint: string) {
  const episodeStore = transaction.objectStore(EPISODES)
  const evidenceStore = transaction.objectStore(EVIDENCE)
  const projectionStore = transaction.objectStore(PROJECTIONS)
  const saveStore = transaction.objectStore(SAVE_LINKS)
  const preferenceStore = transaction.objectStore(PREFERENCES)
  const metaStore = transaction.objectStore(META)
  const batchStore = transaction.objectStore(BATCHES)
  const evidenceRecords = logicalEvidence(next)

  metaStore.put({
    id: metaId(gameId),
    schemaVersion: MEMORY_SCHEMA_VERSION,
    memoryEpoch: next.memoryEpoch,
    recordingRevision: next.recordingRevision,
    recordingEnabled: next.recordingEnabled,
    generation: next.generation,
    usedBytes: snapshotLogicalBytes(next),
  } satisfies MetaRecord)
  batchStore.put({
    id: batchRowId(gameId, batch.batchId),
    libraryGameId: gameId,
    fingerprint,
    at: batch.at,
  } satisfies BatchRow)
  pruneGameBatches(batchStore, gameId)

  const nextEpisodeIds = new Set(next.episodes.map((item) => item.episodeId))
  const nextLinkIds = new Set(next.saveLinks.map((item) => item.id))
  const nextPrefIds = new Set(next.preferences.map((item) => preferenceId({ ...item, libraryGameId: item.libraryGameId || gameId })))
  const nextProjectionIds = new Set(next.projections.map((item) => JSON.stringify(item.key)))
  const nextEvidenceIds = new Set(evidenceRecords.map((item) => item.episodeId))

  for (const episode of next.episodes) {
    const id = episodeRowId(gameId, episode.episodeId)
    episodeStore.put({
      ...episode,
      id,
      gameKey: gameKey(episode.scope),
      libraryGameId: episode.scope.libraryGameId,
      persistence: 'committed',
    } satisfies EpisodeRow)
    if (episode.episodeId !== id) episodeStore.delete(episode.episodeId)
  }
  for (const record of evidenceRecords) {
    const id = episodeRowId(gameId, record.episodeId)
    evidenceStore.put({
      id,
      episodeId: record.episodeId,
      gameKey: gameKey(record.scope),
      libraryGameId: record.scope.libraryGameId,
      record: { ...record, persistence: 'committed' },
    } satisfies EvidenceRow)
    if (record.episodeId !== id) evidenceStore.delete(record.episodeId)
  }
  for (const link of next.saveLinks) {
    const id = saveLinkRowId(gameId, link.id)
    saveStore.put({ ...link, id, linkId: link.id, gameKey: gameKey(link.scope), libraryGameId: link.scope.libraryGameId } satisfies SaveLinkRow)
    if (link.id !== id) saveStore.delete(link.id)
  }
  for (const pref of next.preferences) {
    const bound = { ...pref, libraryGameId: pref.libraryGameId || gameId }
    const id = preferenceId(bound)
    preferenceStore.put({ ...bound, id } satisfies PreferenceRow)
    const unboundId = preferenceId(pref)
    if (unboundId !== id) preferenceStore.delete(unboundId)
  }
  for (const projection of next.projections) {
    const id = projectionRowId(gameId, projection.key)
    const legacyId = JSON.stringify(projection.key)
    projectionStore.put({
      id,
      gameKey: gameKey(projection.key),
      libraryGameId: projection.key.libraryGameId,
      record: projection,
    } satisfies ProjectionRow)
    if (legacyId !== id) projectionStore.delete(legacyId)
  }

  for (const episode of previous.episodes) {
    if (!nextEpisodeIds.has(episode.episodeId)) {
      deleteRowAndLegacy(episodeStore, gameId, episode.episodeId, episodeRowId(gameId, episode.episodeId))
      deleteRowAndLegacy(evidenceStore, gameId, episode.episodeId, episodeRowId(gameId, episode.episodeId))
    }
  }
  for (const evidence of previous.evidence) {
    if (!nextEvidenceIds.has(evidence.episodeId) && !nextEpisodeIds.has(evidence.episodeId)) {
      deleteRowAndLegacy(evidenceStore, gameId, evidence.episodeId, episodeRowId(gameId, evidence.episodeId))
    }
  }
  for (const link of previous.saveLinks) {
    if (!nextLinkIds.has(link.id)) deleteRowAndLegacy(saveStore, gameId, link.id, saveLinkRowId(gameId, link.id))
  }
  for (const pref of previous.preferences) {
    const boundId = preferenceId({ ...pref, libraryGameId: pref.libraryGameId || gameId })
    if (!nextPrefIds.has(boundId)) {
      preferenceStore.delete(boundId)
      preferenceStore.delete(preferenceId(pref))
    }
  }
  for (const projection of previous.projections) {
    if (!nextProjectionIds.has(JSON.stringify(projection.key))) {
      deleteRowAndLegacy(projectionStore, gameId, JSON.stringify(projection.key), projectionRowId(gameId, projection.key))
    }
  }
}

async function sha256Hex(payload: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto SHA-256 is required for companion memory fingerprints')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fingerprintsMatch(stored: string, raw: string, hashed: string) {
  return stored === hashed || stored === raw
}

function sumOtherUsedBytes(transaction: IDBTransaction, metas: MetaRecord[], currentGameId: string, done: (bytes: number) => void, fail: (error: Error) => void) {
  let total = 0
  const missing: MetaRecord[] = []
  for (const meta of metas) {
    if (meta.id === metaId(currentGameId)) continue
    if (typeof meta.usedBytes === 'number' && Number.isFinite(meta.usedBytes) && meta.usedBytes >= 0) {
      total += meta.usedBytes
      continue
    }
    missing.push(meta)
  }
  const fill = (index: number) => {
    if (index >= missing.length) {
      done(total)
      return
    }
    const meta = missing[index]!
    const gameId = gameIdFromMeta(meta.id)
    collectGameRows(transaction, gameId, (rows) => {
      try {
        const snapshot = snapshotFromRows(meta, rows)
        snapshot.preferences = snapshot.preferences.filter((item) => item.libraryGameId === gameId)
        const bytes = snapshotLogicalBytes(snapshot)
        transaction.objectStore(META).put({ ...meta, usedBytes: bytes } satisfies MetaRecord)
        total += bytes
        fill(index + 1)
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Companion memory budget backfill failed'))
      }
    })
  }
  fill(0)
}

async function readGameSnapshot(db: IDBDatabase, gameId: string): Promise<MemoryStoreSnapshot | null> {
  let snapshot: MemoryStoreSnapshot | null = null
  await withTransaction(
    db,
    [META, EPISODES, EVIDENCE, PROJECTIONS, SAVE_LINKS, PREFERENCES],
    'readonly',
    (transaction) => {
      const metaReq = transaction.objectStore(META).get(metaId(gameId))
      metaReq.onsuccess = () => {
        const meta = metaReq.result as MetaRecord | undefined
        if (!meta) return
        collectGameRows(transaction, gameId, (rows) => {
          snapshot = filterSnapshotToGame(snapshotFromRows(meta, rows), gameId)
        })
      }
    },
    () => snapshot
  )
  return snapshot
}

export function createBrowserCompanionMemoryBackend(libraryGameId: string): MemoryBackend {
  if (!libraryGameId.trim()) throw new Error('Companion memory IndexedDB backend requires libraryGameId')
  let dbPromise: Promise<IDBDatabase> | null = null
  const db = () => {
    if (!dbPromise) dbPromise = openDatabase()
    return dbPromise
  }

  return {
    async ready() {
      await db()
    },
    async flush() {
      /* IndexedDB commits are awaited per transaction.complete */
    },
    async loadSnapshot() {
      if (typeof indexedDB === 'undefined') return null
      return readGameSnapshot(await db(), libraryGameId)
    },
    async commitBatch(rawBatch) {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable')
      const batch = validateWriteBatch(rawBatch)
      const rawFingerprint = batchFingerprint(batch)
      const fingerprint = await sha256Hex(rawFingerprint)
      const database = await db()
      await withTransaction(
        database,
        [META, EPISODES, EVIDENCE, PROJECTIONS, SAVE_LINKS, PREFERENCES, BATCHES],
        'readwrite',
        (transaction, fail) => {
          const metaStore = transaction.objectStore(META)
          const batchStore = transaction.objectStore(BATCHES)
          const getMeta = metaStore.get(metaId(libraryGameId))
          getMeta.onsuccess = () => {
            const current = (getMeta.result as MetaRecord | undefined) || defaultMeta(libraryGameId)
            if (batch.memoryEpoch < current.memoryEpoch) return fail(new MemoryStaleError('stale memory epoch'))
            if (batch.recordingRevision < current.recordingRevision) return fail(new MemoryStaleError('stale recording revision'))
            const getBatch = batchStore.get(batchRowId(libraryGameId, batch.batchId))
            getBatch.onsuccess = () => {
              const existing = getBatch.result as BatchRow | undefined
              if (existing && !fingerprintsMatch(existing.fingerprint, rawFingerprint, fingerprint)) {
                return fail(new MemoryConflictError('Memory batch id conflict'))
              }
              if (existing) return
              collectGameRows(transaction, libraryGameId, (rows) => {
                const metasReq = metaStore.getAll()
                metasReq.onsuccess = () => {
                  sumOtherUsedBytes(
                    transaction,
                    (metasReq.result as MetaRecord[]) || [],
                    libraryGameId,
                    (otherGamesBytes) => {
                      try {
                        const previous = snapshotFromRows(current, rows)
                        const next = applyWriteBatch(previous, batch, {
                          boundGameId: libraryGameId,
                          onConflict: 'throw',
                          otherGamesBytes,
                        })
                        persistSnapshot(transaction, libraryGameId, previous, next, batch, fingerprint)
                      } catch (error) {
                        fail(error instanceof Error ? error : new Error('Companion memory apply failed'))
                      }
                    },
                    fail
                  )
                }
              })
            }
          }
        },
        () => undefined
      )
    },
    async clearQueueBarrier(memoryEpoch, recordingRevision, clear) {
      await this.commitBatch({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        batchId: `barrier-${memoryEpoch}-${recordingRevision}`,
        memoryEpoch,
        recordingRevision,
        at: Date.now(),
        clear: {
          libraryGameId: clear?.libraryGameId || libraryGameId,
          preferences: clear?.preferences === true,
          episodes: clear?.episodes !== false,
        },
      })
    },
  }
}

export function companionMemoryDatabaseReady(): Promise<void> {
  opens = opens.then(async () => {
    if (typeof indexedDB === 'undefined') return null
    return openDatabase()
  })
  return opens.then(() => undefined)
}
