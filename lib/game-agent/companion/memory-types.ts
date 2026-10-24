/**
 * Companion memory storage types owned by T2.
 * Keep these separate from T0 `types.ts` so schema can evolve without colliding.
 */

import type { ActionEvidence, MemoryEpisode, RuntimeScope, UserPreference } from './types'

export const MEMORY_SCHEMA_VERSION = 1 as const

export type MemoryPersistenceState = 'ready' | 'loading' | 'degraded' | 'unavailable'

export type MemoryCompleteness = MemoryEpisode['completeness']

export type MemoryEpisodeKind = MemoryEpisode['kind'] | 'milestone' | 'load' | 'save'

export type MemoryBattleOutcome = 'win' | 'lose' | 'escape' | 'abort'

export type MemoryEpisodeRecord = Omit<MemoryEpisode, 'kind'> & {
  kind: MemoryEpisodeKind
  persistence: 'pending' | 'committed'
  sourceEventIds?: string[]
  /** Stable idempotency key; defaults to episodeId. */
  stableKey?: string
  /** Explicit linked-load context; never merges playthrough stats. */
  linkedFrom?: {
    segmentId?: string
    encounterId?: string
    episodeId?: string
    saveLinkId?: string
  }
  coveredSourceCursor?: number
  bytes?: number
  /** Structured battle result only; never inferred from summary text. */
  outcome?: MemoryBattleOutcome
  /** Bounded milestone facts (level_up / battle_reward). Never model-generated. */
  details?: Record<string, unknown>
}

export type MemoryEvidenceRecord = {
  episodeId: string
  scope: RuntimeScope
  encounterId?: string
  sourceRefs: string[]
  completeness: MemoryCompleteness
  persistence: 'pending' | 'committed'
  summary: string
  evidence: ActionEvidence[]
  memoryEpoch: number
  bytes?: number
}

export type MemorySaveLink = {
  id: string
  scope: Pick<RuntimeScope, 'libraryGameId' | 'dataRevision' | 'playthroughId'>
  origin: 'native' | 'quick' | 'auto' | 'chaya' | 'unknown'
  slot?: number | string
  revision?: string
  fromSegmentId?: string
  toSegmentId?: string
  fromEncounterId?: string
  fromEpisodeId?: string
  /** Real source playthrough/revision labels from load.from; query-only, never merged. */
  fromScope?: Pick<RuntimeScope, 'libraryGameId' | 'dataRevision' | 'playthroughId'>
  at: number
  memoryEpoch: number
}

export type MemoryPreferenceRecord = UserPreference & {
  libraryGameId?: string
  sourceUserMessageId?: string
  source: 'user_settings' | 'user_instruction'
}

export type MemoryProjectionKey = {
  libraryGameId: string
  dataRevision: string
  playthroughId: string
  enemyId?: number
  skillId?: number
}

export type MemoryProjectionStats = {
  key: MemoryProjectionKey
  encounters: number
  defeats: number
  knockouts: number
  victories: number
  memoryEpoch: number
  updatedAt: number
}

export type MemoryScopeKey = {
  libraryGameId: string
  dataRevision: string
  playthroughId: string
}

export type MemoryWriteBatch = {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION
  batchId: string
  memoryEpoch: number
  recordingRevision: number
  at: number
  episodes?: MemoryEpisodeRecord[]
  evidence?: MemoryEvidenceRecord[]
  saveLinks?: MemorySaveLink[]
  preferences?: MemoryPreferenceRecord[]
  projections?: MemoryProjectionStats[]
  clear?: {
    libraryGameId?: string
    preferences?: boolean
    episodes?: boolean
  }
  setRecording?: boolean
}

export type MemoryStoreSnapshot = {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION
  memoryEpoch: number
  recordingRevision: number
  recordingEnabled: boolean
  episodes: MemoryEpisodeRecord[]
  evidence: MemoryEvidenceRecord[]
  saveLinks: MemorySaveLink[]
  preferences: MemoryPreferenceRecord[]
  projections: MemoryProjectionStats[]
  generation: number
}

export type MemoryStatus = {
  memoryEpoch: number
  recordingRevision: number
  recordingEnabled: boolean
  episodeCount: number
  pendingCount: number
  usedBytes: number
  persistence: MemoryPersistenceState
  error?: string
}

export type MemoryQueryIntent = 'current_encounter' | 'recent_death' | 'rematch' | 'explicit_history'

export type MemoryQueryOptions = {
  enemyIds?: number[]
  skillIds?: number[]
  encounterId?: string
  segmentId?: string
  limit?: number
  intent?: MemoryQueryIntent
  /** Include pending overlay records for the current runtime. */
  includePending?: boolean
  /** Explicit linked-load from edge; does not merge playthrough stats. */
  linkedFrom?: {
    segmentId?: string
    encounterId?: string
    episodeId?: string
  }
}

export type MemoryQueryResult = {
  scope: RuntimeScope
  memoryEpoch: number
  episodes: MemoryEpisodeRecord[]
  completeness: MemoryCompleteness
  origin?: 'current' | 'linked_load_context'
  nextCursor?: string
}

export type MemoryBackend = {
  ready(): Promise<void>
  flush(): Promise<void>
  loadSnapshot(): Promise<MemoryStoreSnapshot | null>
  commitBatch(batch: MemoryWriteBatch): Promise<void>
  clearQueueBarrier(memoryEpoch: number, recordingRevision: number, clear?: { libraryGameId?: string; preferences?: boolean; episodes?: boolean }): Promise<void>
}

export function memoryScopeKey(scope: MemoryScopeKey): string {
  return `${scope.libraryGameId}\0${scope.dataRevision}\0${scope.playthroughId}`
}

export function sameMemoryScope(a: MemoryScopeKey, b: MemoryScopeKey): boolean {
  return a.libraryGameId === b.libraryGameId && a.dataRevision === b.dataRevision && a.playthroughId === b.playthroughId
}
