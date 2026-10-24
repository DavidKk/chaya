/**
 * Bounded companion memory kernel (T2).
 * MemoryPort-compatible API + ready/flush + write-queue barrier semantics.
 */

import { gameRevisionKey } from './memory-durable'
import { type ActionRingItem, isActionDomainEvent, reduceMemoryInput, toActionRingItem } from './memory-ingest'
import {
  estimateRecordBytes,
  MEMORY_ACTION_BUFFER_MAX,
  MEMORY_ACTION_BUFFER_MAX_BYTES,
  MEMORY_GAME_BUDGET_BYTES,
  MEMORY_GLOBAL_BUDGET_BYTES,
  MEMORY_PREFERENCE_MAX,
  MEMORY_PREFERENCE_MAX_BYTES,
  MEMORY_WRITE_RETRY_BASE_MS,
  MEMORY_WRITE_RETRY_MAX,
} from './memory-limits'
import { buildWriteBatch, enqueuePending, invalidatePendingQueue, type MemoryPendingItem, preferenceStorageKey, usedMemoryBytes } from './memory-queue'
import { episodeStableKey, mergeEpisodeIdempotent, resolveLinkedLoadEpisodes, toLegacyEpisodes, trimQueryText } from './memory-reduce'
import { MemoryConflictError, MemoryPersistenceError, MemorySchemaError, validateEpisode, validatePreference, validateSaveLink } from './memory-schema'
import {
  type MemoryBackend,
  type MemoryEpisodeRecord,
  type MemoryPersistenceState,
  type MemoryPreferenceRecord,
  type MemoryQueryOptions,
  type MemorySaveLink,
  type MemoryStatus,
  type MemoryStoreSnapshot,
  sameMemoryScope,
} from './memory-types'
import type {
  MemoryEpisode,
  MemoryIngestResult,
  MemoryInput,
  MemoryPort,
  MemoryQueryFilter,
  MemoryQueryResult as PortMemoryQueryResult,
  RuntimeScope,
  SourceCursor,
  UserPreference,
} from './types'

export { MemoryConflictError, MemoryPersistenceError } from './memory-schema'
export type { MemoryBackend, MemoryEpisodeRecord, MemoryPreferenceRecord, MemoryStatus } from './memory-types'
export type { MemoryPort }

type CursorMark = { producerId: string; epoch: number; sourceSeq: number; fingerprint: string }

function cursorKey(cursor: SourceCursor): string {
  return `${cursor.producerId}:${cursor.epoch}:${cursor.sourceSeq}`
}

function fingerprintInput(input: MemoryInput): string {
  return JSON.stringify({ eventId: input.source.eventId, type: input.source.type, domain: input.domainEvent, covered: input.coveredSourceCursor })
}

function episodeConflictFingerprint(record: Pick<MemoryEpisodeRecord, 'summary' | 'evidence' | 'kind' | 'outcome' | 'details'>) {
  return JSON.stringify({ summary: record.summary, evidence: record.evidence, kind: record.kind, outcome: record.outcome, details: record.details })
}

export class GameplayMemoryStore {
  private episodes: MemoryEpisodeRecord[] = []
  private saveLinks: MemorySaveLink[] = []
  private preferences = new Map<string, MemoryPreferenceRecord>()
  private pending: MemoryPendingItem[] = []
  private pendingBytes = 0
  private seenKeys = new Map<string, string>()
  private coveredCursors = new Map<string, CursorMark>()
  private actionRing: ActionRingItem[] = []
  private actionRingBytes = 0
  private memoryEpoch = 1
  private recordingRevision = 1
  private recordingEnabled = true
  private generation = 1
  private persistence: MemoryPersistenceState = 'loading'
  private persistenceError?: string
  private readyPromise: Promise<void>
  private resolveReady!: () => void
  private writeChain: Promise<void> = Promise.resolve()
  private closed = false
  private readonly maxEpisodes: number
  private readonly backend: MemoryBackend | null
  /** False until a successful backend load; prevents empty overwrite after bootstrap failure. */
  private backendWritable = false

  constructor(options?: { maxEpisodes?: number; backend?: MemoryBackend | null }) {
    this.maxEpisodes = options?.maxEpisodes ?? 4096
    this.backend = options?.backend ?? null
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve
    })
    if (!this.backend) {
      this.backendWritable = true
      this.persistence = 'ready'
      this.resolveReady()
    } else {
      void this.bootstrap()
    }
  }

  ready(): Promise<void> {
    return this.readyPromise
  }

  getEpoch(): number {
    return this.memoryEpoch
  }

  getRecording(): { enabled: boolean; revision: number } {
    return { enabled: this.recordingEnabled, revision: this.recordingRevision }
  }

  getRecordingRevision(): number {
    return this.recordingRevision
  }

  isRecordingEnabled(): boolean {
    return this.recordingEnabled
  }

  getStatus(): MemoryStatus {
    return {
      memoryEpoch: this.memoryEpoch,
      recordingRevision: this.recordingRevision,
      recordingEnabled: this.recordingEnabled,
      episodeCount: this.episodes.length,
      pendingCount: this.pending.length,
      usedBytes: this.usedBytes(),
      persistence: this.persistence,
      error: this.persistenceError,
    }
  }

  async getPreferences(userScope: string): Promise<UserPreference[]> {
    await this.ready()
    return [...this.preferences.values()]
      .filter((item) => !item.scope || item.scope === userScope || item.scope === 'user_default')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ key, value, revision, updatedAt, sourceUserMessageId, scope }) => ({ key, value, revision, updatedAt, sourceUserMessageId, scope }))
  }

  /** Compatible sync ingest used by current MV history hooks. */
  saveEpisode(episode: MemoryEpisode): void {
    try {
      const record = validateEpisode({ ...episode, persistence: 'pending', memoryEpoch: episode.memoryEpoch || this.memoryEpoch })
      const key = episodeStableKey(record)
      const previous = this.seenKeys.get(key)
      const fingerprint = episodeConflictFingerprint(record)
      if (previous && previous !== fingerprint) throw new MemoryConflictError('Episode stable key conflict')
      void this.acceptEpisode(record)
    } catch (error) {
      if (error instanceof MemorySchemaError) return
      throw error
    }
  }

  async ingest(input: MemoryInput): Promise<MemoryIngestResult> {
    await this.ready()
    if (this.closed) return { accepted: false, pendingEpisodeIds: [] }
    if (input.memoryEpoch !== this.memoryEpoch) return { accepted: false, pendingEpisodeIds: [] }
    if (input.recordingRevision !== this.recordingRevision) return { accepted: false, pendingEpisodeIds: [] }

    const coveredKey = cursorKey(input.coveredSourceCursor)
    const fingerprint = fingerprintInput(input)
    const existingCursor = this.coveredCursors.get(coveredKey)
    if (existingCursor) {
      if (existingCursor.fingerprint === fingerprint) return { accepted: false, pendingEpisodeIds: [] }
      return { accepted: false, pendingEpisodeIds: [], code: 'REQUEST_CONFLICT' } as MemoryIngestResult & { code: 'REQUEST_CONFLICT' }
    }
    this.coveredCursors.set(coveredKey, {
      producerId: input.coveredSourceCursor.producerId,
      epoch: input.coveredSourceCursor.epoch,
      sourceSeq: input.coveredSourceCursor.sourceSeq,
      fingerprint,
    })
    this.trimCoveredCursors()

    if (!this.recordingEnabled && input.domainEvent?.kind !== 'admin') return { accepted: false, pendingEpisodeIds: [] }

    if (isActionDomainEvent(input.domainEvent)) {
      this.pushAction(toActionRingItem(input, input.domainEvent))
      return { accepted: true, pendingEpisodeIds: [] }
    }

    if (input.domainEvent?.kind === 'load' && input.domainEvent.phase === 'begin') {
      this.actionRing = []
      this.actionRingBytes = 0
    }

    try {
      const effects = reduceMemoryInput(input, this.actionRing)
      const pendingEpisodeIds: string[] = []
      for (const effect of effects) {
        if (effect.type === 'episode') {
          const accepted = await this.acceptEpisode(effect.episode)
          if (accepted.accepted) pendingEpisodeIds.push(effect.episode.episodeId)
        } else if (effect.type === 'saveLink') {
          await this.rememberSaveLink(effect.link)
        }
      }
      return { accepted: pendingEpisodeIds.length > 0 || effects.some((item) => item.type === 'saveLink'), pendingEpisodeIds }
    } catch (error) {
      if (error instanceof MemoryConflictError) {
        return { accepted: false, pendingEpisodeIds: [], code: 'REQUEST_CONFLICT' } as MemoryIngestResult & { code: 'REQUEST_CONFLICT' }
      }
      throw error
    }
  }

  /** Sync query kept for CompanionPanel / history callers. */
  query(scope: RuntimeScope, filter: MemoryQueryFilter & MemoryQueryOptions = {}): MemoryEpisode[] {
    const resolved = resolveLinkedLoadEpisodes(this.episodes, this.saveLinks, scope, filter)
    return toLegacyEpisodes(trimQueryText(resolved.episodes).episodes)
  }

  async queryAsync(scope: RuntimeScope, filter: MemoryQueryFilter & MemoryQueryOptions = {}): Promise<PortMemoryQueryResult> {
    await this.ready()
    const resolved = resolveLinkedLoadEpisodes(this.episodes, this.saveLinks, scope, filter)
    const trimmed = trimQueryText(resolved.episodes)
    return {
      episodes: toLegacyEpisodes(trimmed.episodes),
      completeness: trimmed.completeness,
      memoryEpoch: this.memoryEpoch,
      origin: resolved.origin === 'linked_load_context' ? 'linked_load_context' : resolved.origin === 'current' ? 'current_playthrough' : 'unknown',
    }
  }

  queryDetailed(scope: RuntimeScope, filter: MemoryQueryFilter & MemoryQueryOptions = {}) {
    const resolved = resolveLinkedLoadEpisodes(this.episodes, this.saveLinks, scope, filter)
    const trimmed = trimQueryText(resolved.episodes)
    return {
      scope,
      memoryEpoch: this.memoryEpoch,
      episodes: trimmed.episodes,
      completeness: trimmed.completeness,
      origin: resolved.origin || 'current',
      linkedFrom: resolved.linkedFrom || filter.linkedFrom,
    }
  }

  setPreference(pref: UserPreference | MemoryPreferenceRecord): void {
    void this.applyPreference(pref.scope || 'user_default', pref)
  }

  async applyPreference(userScope: string, pref: UserPreference): Promise<{ applied: boolean; revision: number }> {
    await this.ready()
    try {
      const source = (pref as MemoryPreferenceRecord).source
      if (source && source !== 'user_settings' && source !== 'user_instruction') {
        return { applied: false, revision: pref.revision }
      }
      const record = validatePreference({
        ...pref,
        scope: pref.scope || userScope,
        source: source === 'user_instruction' ? 'user_instruction' : 'user_settings',
      })
      const key = preferenceStorageKey(record)
      const current = this.preferences.get(key)
      if (current && current.revision > record.revision) return { applied: false, revision: current.revision }
      if (current && current.revision === record.revision && JSON.stringify(current.value) === JSON.stringify(record.value)) {
        return { applied: false, revision: current.revision }
      }
      this.preferences.set(key, record)
      this.enforcePreferenceBudget()
      this.enqueue({ kind: 'preference', memoryEpoch: this.memoryEpoch, recordingRevision: this.recordingRevision, bytes: estimateRecordBytes(record), payload: record })
      this.scheduleFlush()
      return { applied: true, revision: record.revision }
    } catch (error) {
      if (error instanceof MemorySchemaError) return { applied: false, revision: pref.revision }
      throw error
    }
  }

  getPreference(key: string, libraryGameId?: string, scope?: string): UserPreference | undefined {
    const exact = this.preferences.get(preferenceStorageKey({ key, libraryGameId, scope }))
    if (exact) return exact
    if (libraryGameId) {
      const game = this.preferences.get(preferenceStorageKey({ key, libraryGameId }))
      if (game) return game
    }
    return this.preferences.get(preferenceStorageKey({ key }))
  }

  listPreferences(libraryGameId?: string): MemoryPreferenceRecord[] {
    return [...this.preferences.values()].filter((item) => !libraryGameId || !item.libraryGameId || item.libraryGameId === libraryGameId)
  }

  async rememberSaveLink(input: MemorySaveLink): Promise<{ accepted: boolean; reason?: string }> {
    await this.ready()
    const link = validateSaveLink({ ...input, memoryEpoch: input.memoryEpoch || this.memoryEpoch })
    if (link.memoryEpoch !== this.memoryEpoch) return { accepted: false, reason: 'stale_epoch' }
    if (this.saveLinks.some((item) => item.id === link.id)) return { accepted: false, reason: 'duplicate' }
    this.saveLinks.push(link)
    this.enqueue({ kind: 'saveLink', memoryEpoch: this.memoryEpoch, recordingRevision: this.recordingRevision, bytes: estimateRecordBytes(link), payload: link })
    this.scheduleFlush()
    return { accepted: true }
  }

  async setRecording(enabled: boolean): Promise<MemoryStatus>
  async setRecording(scope: RuntimeScope, enabled: boolean, requestId: string): Promise<{ recordingRevision: number }>
  async setRecording(scopeOrEnabled: RuntimeScope | boolean, enabled?: boolean, _requestId?: string): Promise<MemoryStatus | { recordingRevision: number }> {
    await this.ready()
    const nextEnabled = typeof scopeOrEnabled === 'boolean' ? scopeOrEnabled : Boolean(enabled)
    this.recordingRevision += 1
    this.recordingEnabled = nextEnabled
    this.actionRing = []
    this.actionRingBytes = 0
    this.dropStalePending()
    this.enqueue({ kind: 'recording', memoryEpoch: this.memoryEpoch, recordingRevision: this.recordingRevision, bytes: 8, payload: { enabled: nextEnabled } })
    await this.flush()
    if (typeof scopeOrEnabled === 'boolean') return this.getStatus()
    return { recordingRevision: this.recordingRevision }
  }

  /** Sync clear for old callers. */
  clear(): void
  /** MemoryPort clear behind a new memoryEpoch barrier. */
  clear(scope: RuntimeScope, requestId: string): Promise<{ newMemoryEpoch: number }>
  clear(scope?: RuntimeScope, requestId?: string): void | Promise<{ newMemoryEpoch: number }> {
    if (scope && typeof requestId === 'string') {
      return this.clearMemory({ libraryGameId: scope.libraryGameId, preferences: false }).then((status) => ({ newMemoryEpoch: status.memoryEpoch }))
    }
    void this.clearMemory()
  }

  async clearMemory(options?: { libraryGameId?: string; preferences?: boolean }): Promise<MemoryStatus> {
    await this.ready()
    this.memoryEpoch += 1
    this.generation += 1
    this.actionRing = []
    this.actionRingBytes = 0
    this.dropStalePending()
    if (options?.libraryGameId) {
      this.episodes = this.episodes.filter((item) => item.scope.libraryGameId !== options.libraryGameId)
      this.saveLinks = this.saveLinks.filter((item) => item.scope.libraryGameId !== options.libraryGameId)
      for (const key of [...this.seenKeys.keys()]) if (key.includes(options.libraryGameId)) this.seenKeys.delete(key)
    } else {
      this.episodes = []
      this.saveLinks = []
      this.seenKeys.clear()
      this.coveredCursors.clear()
    }
    if (options?.preferences) {
      if (options.libraryGameId) {
        for (const [key, pref] of [...this.preferences.entries()]) if (pref.libraryGameId === options.libraryGameId) this.preferences.delete(key)
      } else this.preferences.clear()
    }
    const clearPayload = { libraryGameId: options?.libraryGameId, preferences: options?.preferences === true, episodes: true as const }
    this.enqueue({
      kind: 'clear',
      memoryEpoch: this.memoryEpoch,
      recordingRevision: this.recordingRevision,
      bytes: 16,
      payload: clearPayload,
    })
    // Persist epoch fence + delete atomically before refresh can reload old rows.
    if (this.backend && this.backendWritable) await this.backend.clearQueueBarrier(this.memoryEpoch, this.recordingRevision, clearPayload)
    await this.flush()
    return this.getStatus()
  }

  getEpisodes(): MemoryEpisode[] {
    return toLegacyEpisodes(this.episodes)
  }

  getEpisodeRecords(): MemoryEpisodeRecord[] {
    return [...this.episodes]
  }

  loadFromEpisodes(episodes: MemoryEpisode[]): void {
    const next: MemoryEpisodeRecord[] = []
    for (const item of episodes.slice(-this.maxEpisodes)) {
      try {
        next.push(validateEpisode({ ...item, persistence: 'committed', memoryEpoch: item.memoryEpoch || this.memoryEpoch }))
      } catch {
        /* skip corrupt legacy rows */
      }
    }
    this.episodes = next
    this.seenKeys.clear()
    for (const episode of next) this.seenKeys.set(episodeStableKey(episode), episodeConflictFingerprint(episode))
  }

  async flush(): Promise<void> {
    await this.ready()
    await this.writeChain
    if (this.pending.length && this.backend && !this.backendWritable) await this.recoverBackend()
    while (this.pending.length) {
      const before = this.pending.length
      await this.flushOnce()
      if (this.pending.length >= before) throw this.degradedError()
    }
    if (this.backend) await this.backend.flush()
  }

  async close(): Promise<void> {
    this.closed = true
    try {
      await this.flush()
    } catch {
      /* best-effort on shutdown */
    }
  }

  private async acceptEpisode(input: MemoryEpisodeRecord): Promise<{ accepted: boolean; reason?: string }> {
    if (!this.recordingEnabled) return { accepted: false, reason: 'recording_paused' }
    if (input.memoryEpoch !== this.memoryEpoch) return { accepted: false, reason: 'stale_epoch' }
    const record: MemoryEpisodeRecord = { ...input, persistence: 'pending', bytes: input.bytes ?? estimateRecordBytes(input) }
    const key = episodeStableKey(record)
    const previous = this.seenKeys.get(key)
    const fingerprint = episodeConflictFingerprint(record)
    if (previous) {
      if (previous === fingerprint) return { accepted: false, reason: 'duplicate' }
      throw new MemoryConflictError('Episode stable key conflict')
    }
    const merged = mergeEpisodeIdempotent(this.episodes, record)
    if (merged.conflict) throw new MemoryConflictError('Episode stable key conflict')
    if (!merged.changed) return { accepted: false, reason: 'duplicate' }
    this.episodes = merged.episodes
    this.seenKeys.set(key, episodeConflictFingerprint(record))
    this.enforceEpisodeBudget()
    this.enqueue({ kind: 'episode', memoryEpoch: this.memoryEpoch, recordingRevision: this.recordingRevision, bytes: record.bytes || 0, payload: record })
    this.scheduleFlush()
    return { accepted: true }
  }

  private pushAction(item: ActionRingItem): void {
    this.actionRing.push(item)
    this.actionRingBytes += item.bytes
    while (this.actionRing.length > MEMORY_ACTION_BUFFER_MAX || this.actionRingBytes > MEMORY_ACTION_BUFFER_MAX_BYTES) {
      const dropped = this.actionRing.shift()
      if (!dropped) break
      this.actionRingBytes = Math.max(0, this.actionRingBytes - dropped.bytes)
    }
  }

  private trimCoveredCursors(): void {
    if (this.coveredCursors.size <= 4096) return
    for (const key of [...this.coveredCursors.keys()].slice(0, this.coveredCursors.size - 2048)) this.coveredCursors.delete(key)
  }

  private async bootstrap(): Promise<void> {
    if (!this.backend) return
    try {
      await this.backend.ready()
      const snapshot = await this.backend.loadSnapshot()
      if (snapshot) this.applySnapshot(snapshot)
      this.backendWritable = true
      this.persistence = 'ready'
      this.persistenceError = undefined
    } catch (error) {
      // Keep bounded in-memory events only; never mark writable or flush an empty overlay over the old store.
      this.backendWritable = false
      this.persistence = 'degraded'
      this.persistenceError = error instanceof Error ? error.message : 'memory persistence unavailable'
    } finally {
      this.resolveReady()
    }
  }

  private applySnapshot(snapshot: MemoryStoreSnapshot): void {
    this.memoryEpoch = Math.max(1, snapshot.memoryEpoch || 1)
    this.recordingRevision = Math.max(1, snapshot.recordingRevision || 1)
    this.recordingEnabled = snapshot.recordingEnabled !== false
    this.generation = Math.max(1, snapshot.generation || 1)
    this.episodes = (snapshot.episodes || []).map((item) => ({ ...item, persistence: 'committed' as const }))
    this.saveLinks = snapshot.saveLinks || []
    this.preferences.clear()
    for (const pref of snapshot.preferences || []) this.preferences.set(preferenceStorageKey(pref), pref)
    this.seenKeys.clear()
    for (const episode of this.episodes) this.seenKeys.set(episodeStableKey(episode), episodeConflictFingerprint(episode))
  }

  private mergeSnapshot(snapshot: MemoryStoreSnapshot): void {
    const overlayEpisodes = this.episodes.filter((item) => item.persistence === 'pending')
    const overlayLinks = this.saveLinks.slice()
    const overlayPrefs = [...this.preferences.values()]
    this.applySnapshot(snapshot)
    this.dropStalePending()
    for (const episode of overlayEpisodes) {
      if (episode.memoryEpoch !== this.memoryEpoch) continue
      const merged = mergeEpisodeIdempotent(this.episodes, episode)
      if (merged.conflict) continue
      this.episodes = merged.episodes
      this.seenKeys.set(episodeStableKey(episode), episodeConflictFingerprint(episode))
    }
    for (const link of overlayLinks) {
      if (link.memoryEpoch !== this.memoryEpoch) continue
      if (!this.saveLinks.some((item) => item.id === link.id)) this.saveLinks.push(link)
    }
    for (const pref of overlayPrefs) {
      const key = preferenceStorageKey(pref)
      const current = this.preferences.get(key)
      if (!current || current.revision <= pref.revision) this.preferences.set(key, pref)
    }
  }

  private async recoverBackend(): Promise<void> {
    if (!this.backend) return
    try {
      await this.backend.ready()
      const snapshot = await this.backend.loadSnapshot()
      if (snapshot) this.mergeSnapshot(snapshot)
      this.backendWritable = true
      this.persistence = 'ready'
      this.persistenceError = undefined
    } catch (error) {
      this.backendWritable = false
      this.persistence = 'degraded'
      this.persistenceError = error instanceof Error ? error.message : 'memory persistence unavailable'
      throw this.degradedError()
    }
  }

  private degradedError(): MemoryPersistenceError {
    return new MemoryPersistenceError(this.persistenceError || 'memory persistence unavailable')
  }

  private enqueue(item: MemoryPendingItem): void {
    const result = enqueuePending(this.pending, this.pendingBytes, item, (episode) => {
      const index = this.episodes.findIndex((row) => row.episodeId === episode.episodeId && row.persistence === 'pending')
      if (index >= 0) {
        const current = this.episodes[index]!
        this.episodes[index] = { ...current, evidence: current.evidence.slice(0, 1), completeness: 'partial' }
      }
    })
    this.pending = result.pending
    this.pendingBytes = result.pendingBytes
    if (result.degraded) {
      this.persistence = this.persistence === 'ready' ? 'degraded' : this.persistence
      this.persistenceError = this.persistenceError || result.degraded
    }
  }

  private dropStalePending(): void {
    const result = invalidatePendingQueue(this.pending, this.memoryEpoch, this.recordingRevision)
    this.pending = result.pending
    this.pendingBytes = result.pendingBytes
    this.episodes = this.episodes.filter((item) => item.persistence === 'committed' || item.memoryEpoch === this.memoryEpoch)
  }

  private scheduleFlush(): void {
    if (!this.backend || this.closed) return
    this.writeChain = this.writeChain
      .then(async () => {
        if (!this.pending.length) return
        await this.flushOnce()
      })
      .catch(() => undefined)
  }

  private async flushOnce(): Promise<void> {
    if (!this.backend || !this.pending.length) return
    if (!this.backendWritable) {
      this.persistence = 'degraded'
      this.persistenceError = this.persistenceError || 'memory persistence unavailable'
      throw this.degradedError()
    }
    const batchItems = this.pending.slice()
    const batch = buildWriteBatch(batchItems, this.memoryEpoch, this.recordingRevision)
    let attempt = 0
    while (true) {
      try {
        await this.backend.commitBatch(batch)
        this.pending = this.pending.slice(batchItems.length)
        this.pendingBytes = this.pending.reduce((sum, item) => sum + item.bytes, 0)
        if (batch.episodes?.length) {
          const ids = new Set(batch.episodes.map((item) => item.episodeId))
          this.episodes = this.episodes.map((item) => (ids.has(item.episodeId) ? { ...item, persistence: 'committed' } : item))
        }
        this.persistence = 'ready'
        this.persistenceError = undefined
        return
      } catch (error) {
        attempt += 1
        if (attempt > MEMORY_WRITE_RETRY_MAX) {
          this.persistence = 'degraded'
          this.persistenceError = error instanceof Error ? error.message : 'memory flush failed'
          throw this.degradedError()
        }
        await new Promise((resolve) => setTimeout(resolve, MEMORY_WRITE_RETRY_BASE_MS * attempt))
      }
    }
  }

  private enforceEpisodeBudget(): void {
    while (this.episodes.length > this.maxEpisodes) this.episodes.shift()
    let used = this.usedBytes()
    while (used > MEMORY_GLOBAL_BUDGET_BYTES && this.episodes.length > 1) {
      const removed = this.episodes.shift()
      used -= removed?.bytes || 0
    }
    const byGame = new Map<string, number>()
    for (const episode of this.episodes) {
      const key = gameRevisionKey(episode.scope)
      byGame.set(key, (byGame.get(key) || 0) + (episode.bytes || estimateRecordBytes(episode)))
    }
    for (const [key, bytes] of byGame) {
      if (bytes <= MEMORY_GAME_BUDGET_BYTES) continue
      let remaining = bytes
      this.episodes = this.episodes.filter((episode) => {
        if (gameRevisionKey(episode.scope) !== key) return true
        if (remaining <= MEMORY_GAME_BUDGET_BYTES) return true
        if ((episode.kind === 'knockout' || episode.kind === 'battle_result') && episode.evidence.length > 1) {
          remaining -= estimateRecordBytes(episode.evidence.slice(1))
          episode.evidence = episode.evidence.slice(0, 1)
          episode.completeness = 'partial'
          episode.bytes = estimateRecordBytes(episode)
          return true
        }
        remaining -= episode.bytes || 0
        return false
      })
    }
  }

  private enforcePreferenceBudget(): void {
    const values = [...this.preferences.values()].sort((a, b) => a.updatedAt - b.updatedAt)
    while (values.length > MEMORY_PREFERENCE_MAX) {
      const removed = values.shift()
      if (!removed) break
      this.preferences.delete(preferenceStorageKey(removed))
    }
    let bytes = values.reduce((sum, item) => sum + estimateRecordBytes(item), 0)
    while (bytes > MEMORY_PREFERENCE_MAX_BYTES && values.length) {
      const removed = values.shift()
      if (!removed) break
      this.preferences.delete(preferenceStorageKey(removed))
      bytes -= estimateRecordBytes(removed)
    }
  }

  private usedBytes(): number {
    return usedMemoryBytes(this.episodes, this.preferences.values(), this.saveLinks, this.pendingBytes, this.actionRingBytes)
  }
}

export const defaultMemoryStore = new GameplayMemoryStore()

export function createGameplayMemoryStore(options?: { maxEpisodes?: number; backend?: MemoryBackend | null }) {
  return new GameplayMemoryStore(options)
}

export function scopesEqual(a: RuntimeScope, b: RuntimeScope): boolean {
  return sameMemoryScope(a, b) && a.runtimeInstanceId === b.runtimeInstanceId && a.segmentId === b.segmentId
}
