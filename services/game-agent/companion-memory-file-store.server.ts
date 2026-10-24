/** Local atomic file backend for companion memory (App / local service). */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { COMPANION_MEMORY_DIR } from '@/constants/paths'
import { applyWriteBatch, batchFingerprint, emptyMemorySnapshot, snapshotLogicalBytes, trimSnapshotToBudgets } from '@/lib/game-agent/companion/memory-durable'
import { MEMORY_COMPACTION_WORKSPACE_BYTES, MEMORY_GAME_BUDGET_BYTES, MEMORY_GLOBAL_BUDGET_BYTES, utf8Bytes } from '@/lib/game-agent/companion/memory-limits'
import { MemoryConflictError, MemoryPersistenceError, validateWriteBatch } from '@/lib/game-agent/companion/memory-schema'
import { MEMORY_SCHEMA_VERSION, type MemoryBackend, type MemoryStoreSnapshot, type MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { holdFileLock } from '@/services/game-agent/cli/file-lock.server'

const hashId = (id: string) => createHash('sha256').update(id).digest('hex')
const persistFingerprint = (batch: MemoryWriteBatch) => createHash('sha256').update(batchFingerprint(batch)).digest('hex')
const APPLIED_BATCH_WINDOW = 256

type Manifest = {
  schemaVersion: number
  generation: number
  memoryEpoch: number
  recordingRevision: number
  recordingEnabled: boolean
  checkpoint?: string | null
  /** batchId → sha256(batchFingerprint); only batches folded into `checkpoint`. */
  appliedBatches?: Record<string, string>
  usedBytes?: number
}

function writeAtomic(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temp, file)
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function defaultManifest(): Manifest {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    generation: 1,
    memoryEpoch: 1,
    recordingRevision: 1,
    recordingEnabled: true,
    checkpoint: null,
    appliedBatches: {},
    usedBytes: 0,
  }
}

function normalizeFingerprint(value: string): string {
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : createHash('sha256').update(value).digest('hex')
}

function retainAppliedWindow(entries: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(entries.slice(-APPLIED_BATCH_WINDOW))
}

function listJournalNames(batchesDir: string): string[] {
  if (!fs.existsSync(batchesDir)) return []
  return fs
    .readdirSync(batchesDir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp') && !name.endsWith('.partial'))
    .sort()
}

function gameUsedBytes(dir: string, manifest: Manifest | null): number {
  const batchesDir = path.join(dir, 'batches')
  const trusted = typeof manifest?.usedBytes === 'number' && Number.isFinite(manifest.usedBytes)
  const checkpointedIds = new Set(trusted ? Object.keys(manifest?.appliedBatches || {}) : [])
  let journalBytes = 0
  for (const name of listJournalNames(batchesDir)) {
    const batch = readJson<MemoryWriteBatch>(path.join(batchesDir, name))
    if (!batch || checkpointedIds.has(batch.batchId)) continue
    journalBytes += utf8Bytes(batch)
  }
  if (trusted) return Math.max(0, manifest!.usedBytes!) + journalBytes
  let total = journalBytes
  if (manifest?.checkpoint) {
    const checkpoint = readJson<MemoryStoreSnapshot>(path.join(dir, manifest.checkpoint))
    if (checkpoint) total += snapshotLogicalBytes(checkpoint)
  }
  return total
}

function otherGamesBytes(root: string, currentDir: string): number {
  if (!fs.existsSync(root)) return 0
  let total = 0
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    if (dir === currentDir) continue
    total += gameUsedBytes(dir, readJson<Manifest>(path.join(dir, 'manifest.json')))
  }
  return total
}

function cloneLoadedSnapshot(source: MemoryStoreSnapshot): MemoryStoreSnapshot {
  return emptyMemorySnapshot({
    ...source,
    episodes: source.episodes?.slice() || [],
    evidence: source.evidence?.slice() || [],
    saveLinks: source.saveLinks?.slice() || [],
    preferences: source.preferences?.slice() || [],
    projections: source.projections?.slice() || [],
  })
}

function trimForFilePersist(snapshot: MemoryStoreSnapshot, otherBytes: number): MemoryStoreSnapshot {
  const remainingGlobal = MEMORY_GLOBAL_BUDGET_BYTES - otherBytes
  return trimSnapshotToBudgets(snapshot, {
    gameBudgetBytes: MEMORY_GAME_BUDGET_BYTES,
    globalBudgetBytes: Math.min(MEMORY_GAME_BUDGET_BYTES, remainingGlobal),
  })
}

function acquireLock(file: string): () => void {
  const release = holdFileLock(file)
  if (!release) throw new MemoryPersistenceError('Companion memory write lock is held by another process')
  return release
}

/** Durable path is game-scoped; runtimeInstanceId must not partition storage. */
export function createCompanionMemoryFileBackend(options?: { rootDir?: string; libraryGameId?: string }): MemoryBackend {
  const root = options?.rootDir || COMPANION_MEMORY_DIR
  const libraryGameId = options?.libraryGameId || '_global'
  const boundGameId = libraryGameId === '_global' ? undefined : libraryGameId
  const gameDir = path.join(root, hashId(libraryGameId))
  const lockFile = path.join(gameDir, 'writer.lock')
  const rootLockFile = path.join(root, 'writer.lock')
  const manifestFile = path.join(gameDir, 'manifest.json')
  const batchesDir = path.join(gameDir, 'batches')
  let queue = Promise.resolve()

  const withLocks = async <T>(run: () => Promise<T> | T): Promise<T> => {
    const releaseRoot = acquireLock(rootLockFile)
    try {
      const releaseGame = acquireLock(lockFile)
      try {
        return await run()
      } finally {
        releaseGame()
      }
    } finally {
      releaseRoot()
    }
  }

  const loadState = () => {
    const persisted = readJson<Manifest>(manifestFile)
    const manifest = persisted || defaultManifest()
    const checkpointName = manifest.checkpoint || ''
    const checkpointFile = checkpointName ? path.join(gameDir, checkpointName) : ''
    const checkpointExists = !!checkpointFile && fs.existsSync(checkpointFile)
    const names = listJournalNames(batchesDir)
    let snapshot: MemoryStoreSnapshot
    let checkpointMtime = 0
    if (checkpointExists) {
      const checkpoint = readJson<MemoryStoreSnapshot>(checkpointFile)
      if (!checkpoint) throw new Error('Companion memory checkpoint is unreadable; refusing to overwrite')
      snapshot = cloneLoadedSnapshot(checkpoint)
      checkpointMtime = fs.statSync(checkpointFile).mtimeMs
    } else {
      if (persisted && manifest.generation > 1 && !names.length) {
        throw new Error('Companion memory checkpoint missing after compaction; refusing to overwrite')
      }
      // Replay journals from empty so a newer manifest barrier cannot skip older records.
      snapshot = emptyMemorySnapshot()
    }
    const checkpointed = new Map(Object.entries(manifest.appliedBatches || {}).map(([batchId, fingerprint]) => [batchId, normalizeFingerprint(fingerprint)]))
    const replayed = new Map<string, string>()
    const appliedFiles: string[] = []
    const otherBytes = otherGamesBytes(root, gameDir)
    // usedBytes is written only with a real checkpoint; old manifests marked journals applied without folding them.
    const appliedTrusted = checkpointExists && typeof manifest.usedBytes === 'number' && Number.isFinite(manifest.usedBytes)
    for (const name of names) {
      const file = path.join(batchesDir, name)
      const batch = readJson<MemoryWriteBatch>(file)
      if (!batch || batch.schemaVersion !== MEMORY_SCHEMA_VERSION) {
        continue
      }
      const hash = persistFingerprint(batch)
      const marked = checkpointed.get(batch.batchId)
      const alreadyFolded = marked === hash && (appliedTrusted || (checkpointExists && fs.statSync(file).mtimeMs < checkpointMtime))
      if (alreadyFolded) {
        appliedFiles.push(name)
        continue
      }
      try {
        snapshot = applyWriteBatch(snapshot, batch, {
          boundGameId,
          onConflict: 'skip',
          appliedBatches: replayed,
        })
        appliedFiles.push(name)
      } catch (error) {
        if (error instanceof MemoryPersistenceError) throw error
      }
    }
    if (persisted) {
      snapshot.memoryEpoch = Math.max(snapshot.memoryEpoch, manifest.memoryEpoch)
      snapshot.recordingRevision = Math.max(snapshot.recordingRevision, manifest.recordingRevision)
      snapshot.recordingEnabled = manifest.recordingEnabled
      snapshot.generation = Math.max(snapshot.generation, manifest.generation)
    }
    return { snapshot, manifest, checkpointed, replayed, appliedFiles, otherBytes }
  }

  const persistSnapshot = (state: ReturnType<typeof loadState>, snapshot: MemoryStoreSnapshot, extraApplied: Array<[string, string]>) => {
    const compacted = trimForFilePersist(snapshot, state.otherBytes)
    compacted.generation = Math.max(compacted.generation, state.manifest.generation) + 1
    const body = JSON.stringify(compacted)
    if (utf8Bytes(body) > MEMORY_GAME_BUDGET_BYTES + MEMORY_COMPACTION_WORKSPACE_BYTES) {
      throw new MemoryPersistenceError('Companion memory checkpoint exceeds compaction workspace')
    }
    const checkpoint = `checkpoint.gen-${compacted.generation}.json`
    writeAtomic(path.join(gameDir, checkpoint), body)
    const appliedEntries: Array<[string, string]> = [
      ...state.checkpointed.entries(),
      ...[...state.replayed.entries()].map(([batchId, fingerprint]) => [batchId, normalizeFingerprint(fingerprint)] as [string, string]),
      ...extraApplied,
    ]
    const nextManifest: Manifest = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      generation: compacted.generation,
      memoryEpoch: compacted.memoryEpoch,
      recordingRevision: compacted.recordingRevision,
      recordingEnabled: compacted.recordingEnabled,
      checkpoint,
      appliedBatches: retainAppliedWindow(appliedEntries),
      usedBytes: snapshotLogicalBytes(compacted),
    }
    writeAtomic(manifestFile, JSON.stringify(nextManifest))
    const foldedIds = new Set<string>([...state.checkpointed.keys(), ...state.replayed.keys(), ...extraApplied.map(([batchId]) => batchId)])
    for (const name of [...state.appliedFiles, ...listJournalNames(batchesDir)]) {
      const file = path.join(batchesDir, name)
      const batch = readJson<MemoryWriteBatch>(file)
      if (batch && foldedIds.has(batch.batchId)) fs.rmSync(file, { force: true })
    }
    for (const name of fs.readdirSync(gameDir)) {
      if (name.startsWith('checkpoint.') && name.endsWith('.json') && name !== checkpoint) {
        fs.rmSync(path.join(gameDir, name), { force: true })
      }
    }
  }

  return {
    async ready() {
      fs.mkdirSync(batchesDir, { recursive: true, mode: 0o700 })
    },
    async flush() {
      await queue
    },
    async loadSnapshot() {
      return withLocks(async () => loadState().snapshot)
    },
    async commitBatch(rawBatch) {
      const batch = validateWriteBatch(rawBatch)
      const operation = queue.then(() =>
        withLocks(async () => {
          fs.mkdirSync(batchesDir, { recursive: true, mode: 0o700 })
          const state = loadState()
          const hash = persistFingerprint(batch)
          const checkpointedHash = state.checkpointed.get(batch.batchId)
          if (checkpointedHash) {
            if (checkpointedHash !== hash) throw new MemoryConflictError('Memory batch id conflict')
            if (!state.replayed.has(batch.batchId)) return
          }
          const nextSnapshot = applyWriteBatch(state.snapshot, batch, {
            boundGameId,
            onConflict: 'throw',
            appliedBatches: new Map(state.replayed),
            otherGamesBytes: state.otherBytes,
          })
          const file = path.join(batchesDir, `${String(batch.at).padStart(16, '0')}-${hashId(batch.batchId)}.json`)
          if (fs.existsSync(file)) {
            const existing = readJson<MemoryWriteBatch>(file)
            if (existing && persistFingerprint(existing) !== hash) throw new MemoryConflictError('Memory batch id conflict')
          }
          writeAtomic(file, JSON.stringify(batch))
          persistSnapshot(state, nextSnapshot, [[batch.batchId, hash]])
        })
      )
      queue = operation.catch(() => undefined)
      await operation
    },
    async clearQueueBarrier(memoryEpoch, recordingRevision, clear) {
      await this.commitBatch({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        batchId: `barrier-${memoryEpoch}-${recordingRevision}`,
        memoryEpoch,
        recordingRevision,
        at: Date.now(),
        clear: {
          libraryGameId: clear?.libraryGameId || boundGameId,
          preferences: clear?.preferences === true,
          episodes: clear?.episodes !== false,
        },
      })
    },
  }
}

export const companionMemoryFileStore = createCompanionMemoryFileBackend()
