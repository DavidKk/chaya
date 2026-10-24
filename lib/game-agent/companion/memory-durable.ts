/** Shared durable apply / budget / isolation helpers for companion memory backends. */

import { estimateRecordBytes, MEMORY_GAME_BUDGET_BYTES, MEMORY_GLOBAL_BUDGET_BYTES, MEMORY_PREFERENCE_MAX, MEMORY_PREFERENCE_MAX_BYTES } from './memory-limits'
import { usedMemoryBytes } from './memory-queue'
import { episodeStableKey, mergeEpisodeIdempotent } from './memory-reduce'
import { MemoryConflictError, MemoryStaleError } from './memory-schema'
import { MEMORY_SCHEMA_VERSION, type MemoryEpisodeRecord, type MemoryStoreSnapshot, type MemoryWriteBatch } from './memory-types'

const METADATA_RESERVE_BYTES = 64 * 1024

export type DurableApplyOptions = {
  boundGameId?: string
  onConflict?: 'throw' | 'skip'
  appliedBatches?: Map<string, string>
  /** Other games' logical bytes already counted toward the 200 MiB global budget. */
  otherGamesBytes?: number
}

export function gameRevisionKey(scope: { libraryGameId: string; dataRevision: string }): string {
  return `${scope.libraryGameId}\0${scope.dataRevision}`
}

export function episodeFingerprint(episode: MemoryEpisodeRecord): string {
  return JSON.stringify({
    episodeId: episode.episodeId,
    stableKey: episode.stableKey || episode.episodeId,
    kind: episode.kind,
    summary: episode.summary,
    encounterId: episode.encounterId,
    completeness: episode.completeness,
    evidence: episode.evidence,
    scope: episode.scope,
    memoryEpoch: episode.memoryEpoch,
    sourceEventIds: episode.sourceEventIds,
    linkedFrom: episode.linkedFrom,
    at: episode.at,
    outcome: episode.outcome,
    details: episode.details,
  })
}

export function batchFingerprint(batch: MemoryWriteBatch): string {
  return JSON.stringify({
    batchId: batch.batchId,
    memoryEpoch: batch.memoryEpoch,
    recordingRevision: batch.recordingRevision,
    clear: batch.clear,
    setRecording: batch.setRecording,
    episodes: (batch.episodes || []).map(episodeFingerprint),
    saveLinks: batch.saveLinks || [],
    preferences: batch.preferences || [],
    evidence: batch.evidence || [],
    projections: batch.projections || [],
  })
}

export function snapshotLogicalBytes(snapshot: Pick<MemoryStoreSnapshot, 'episodes' | 'evidence' | 'saveLinks' | 'preferences' | 'projections'>): number {
  return (
    usedMemoryBytes(snapshot.episodes, snapshot.preferences, snapshot.saveLinks, 0, 0) +
    snapshot.evidence.reduce((sum, item) => sum + (item.bytes || estimateRecordBytes(item)), 0) +
    snapshot.projections.reduce((sum, item) => sum + estimateRecordBytes(item), 0) +
    METADATA_RESERVE_BYTES
  )
}

function cloneSnapshot(snapshot: MemoryStoreSnapshot): MemoryStoreSnapshot {
  return {
    ...snapshot,
    episodes: snapshot.episodes.map((item) => ({ ...item, evidence: item.evidence.slice() })),
    evidence: snapshot.evidence.slice(),
    saveLinks: snapshot.saveLinks.slice(),
    preferences: snapshot.preferences.slice(),
    projections: snapshot.projections.slice(),
  }
}

export function bindWriteBatchToGame(batch: MemoryWriteBatch, gameId: string): MemoryWriteBatch {
  for (const episode of batch.episodes || []) {
    if (episode.scope.libraryGameId !== gameId) throw new MemoryConflictError('Write batch episode is not bound to the request game')
  }
  for (const evidence of batch.evidence || []) {
    if (evidence.scope.libraryGameId !== gameId) throw new MemoryConflictError('Write batch evidence is not bound to the request game')
  }
  for (const link of batch.saveLinks || []) {
    if (link.scope.libraryGameId !== gameId) throw new MemoryConflictError('Write batch save link is not bound to the request game')
  }
  for (const projection of batch.projections || []) {
    if (projection.key.libraryGameId !== gameId) throw new MemoryConflictError('Write batch projection is not bound to the request game')
  }
  for (const pref of batch.preferences || []) {
    if (pref.libraryGameId && pref.libraryGameId !== gameId) throw new MemoryConflictError('Write batch preference is not bound to the request game')
  }
  if (batch.clear?.libraryGameId && batch.clear.libraryGameId !== gameId) {
    throw new MemoryConflictError('Clear scope is not bound to the request game')
  }
  return batch.clear ? { ...batch, clear: { ...batch.clear, libraryGameId: gameId } } : batch
}

function rememberBatch(applied: Map<string, string>, batch: MemoryWriteBatch, onConflict: 'throw' | 'skip'): 'apply' | 'ignore' {
  const fingerprint = batchFingerprint(batch)
  const previous = applied.get(batch.batchId)
  if (!previous) {
    applied.set(batch.batchId, fingerprint)
    return 'apply'
  }
  if (previous === fingerprint) return 'ignore'
  if (onConflict === 'throw') throw new MemoryConflictError('Memory batch id conflict')
  return 'ignore'
}

function assertBarrier(snapshot: MemoryStoreSnapshot, batch: MemoryWriteBatch, onConflict: 'throw' | 'skip'): boolean {
  if (batch.memoryEpoch < snapshot.memoryEpoch || batch.recordingRevision < snapshot.recordingRevision) {
    if (onConflict === 'throw') throw new MemoryStaleError(batch.memoryEpoch < snapshot.memoryEpoch ? 'stale memory epoch' : 'stale recording revision')
    return false
  }
  return true
}

export function applyWriteBatch(snapshot: MemoryStoreSnapshot, batch: MemoryWriteBatch, options: DurableApplyOptions = {}): MemoryStoreSnapshot {
  const onConflict = options.onConflict || 'throw'
  const appliedBatches = options.appliedBatches || new Map<string, string>()
  const next = cloneSnapshot(snapshot)
  if (!assertBarrier(next, batch, onConflict)) return snapshot
  const bound = options.boundGameId ? bindWriteBatchToGame(batch, options.boundGameId) : batch
  if (rememberBatch(appliedBatches, bound, onConflict) === 'ignore') return snapshot

  if (bound.clear) {
    const gameId = bound.clear.libraryGameId || options.boundGameId
    if (!gameId) throw new MemoryConflictError('Clear requires a bound game')
    if (bound.clear.episodes !== false) {
      next.episodes = next.episodes.filter((item) => item.scope.libraryGameId !== gameId)
      next.saveLinks = next.saveLinks.filter((item) => item.scope.libraryGameId !== gameId)
      next.evidence = next.evidence.filter((item) => item.scope.libraryGameId !== gameId)
      next.projections = next.projections.filter((item) => item.key.libraryGameId !== gameId)
    }
    if (bound.clear.preferences) next.preferences = next.preferences.filter((item) => item.libraryGameId !== gameId)
    next.generation += 1
  }
  if (typeof bound.setRecording === 'boolean') next.recordingEnabled = bound.setRecording
  next.memoryEpoch = Math.max(next.memoryEpoch, bound.memoryEpoch)
  next.recordingRevision = Math.max(next.recordingRevision, bound.recordingRevision)

  if (next.recordingEnabled) {
    for (const episode of bound.episodes || []) {
      if (episode.memoryEpoch !== next.memoryEpoch) {
        if (onConflict === 'throw') throw new MemoryStaleError('stale memory epoch')
        continue
      }
      if (next.episodes.some((item) => item.episodeId === episode.episodeId && episodeStableKey(item) !== episodeStableKey(episode))) {
        if (onConflict === 'throw') throw new MemoryConflictError('Episode id conflict')
        continue
      }
      const merged = mergeEpisodeIdempotent(next.episodes, { ...episode, persistence: 'committed' })
      if (merged.conflict) {
        if (onConflict === 'throw') throw new MemoryConflictError('Episode stable key conflict')
        continue
      }
      next.episodes = merged.episodes
    }
    for (const link of bound.saveLinks || []) {
      const existing = next.saveLinks.find((item) => item.id === link.id)
      if (!existing) {
        next.saveLinks.push(link)
        continue
      }
      if (JSON.stringify(existing) === JSON.stringify(link)) continue
      if (onConflict === 'throw') throw new MemoryConflictError('Save link id conflict')
    }
  }

  for (const pref of bound.preferences || []) {
    const key = `${pref.libraryGameId || ''}::${pref.scope || ''}::${pref.key}`
    const index = next.preferences.findIndex((item) => `${item.libraryGameId || ''}::${item.scope || ''}::${item.key}` === key)
    if (index >= 0) next.preferences[index] = pref
    else next.preferences.push(pref)
  }
  for (const projection of bound.projections || []) {
    if (!next.recordingEnabled && !bound.clear) continue
    const id = JSON.stringify(projection.key)
    const index = next.projections.findIndex((item) => JSON.stringify(item.key) === id)
    if (index >= 0) next.projections[index] = projection
    else next.projections.push(projection)
  }

  return trimSnapshotToBudgets(next, { otherGamesBytes: options.otherGamesBytes })
}

function evidenceRecord(episode: MemoryEpisodeRecord): MemoryStoreSnapshot['evidence'][number] {
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
  }
}

function episodeStorageBytes(episode: MemoryEpisodeRecord): number {
  return estimateRecordBytes(episode) + estimateRecordBytes(evidenceRecord(episode))
}

/** Keep the strongest direct observation when older detail must be reduced. */
function reduceEpisodeDetail(episode: MemoryEpisodeRecord): void {
  const direct = episode.evidence.find((item) => item.attribution === 'observed_action' && item.hpBefore != null && item.hpBefore > 0 && item.hpAfter === 0)
  episode.evidence = [direct || episode.evidence[episode.evidence.length - 1]!]
  episode.completeness = 'partial'
  episode.bytes = estimateRecordBytes(episode)
}

function trimEpisodeGroup(episodes: MemoryEpisodeRecord[], budget: number): MemoryEpisodeRecord[] {
  let bytes = episodes.reduce((sum, episode) => sum + episodeStorageBytes(episode), 0)
  for (const episode of episodes) {
    if (bytes <= budget) break
    if (episode.evidence.length <= 1) continue
    const before = episodeStorageBytes(episode)
    reduceEpisodeDetail(episode)
    bytes += episodeStorageBytes(episode) - before
  }
  let start = 0
  while (start < episodes.length && bytes > budget) bytes -= episodeStorageBytes(episodes[start++]!)
  return episodes.slice(start)
}

export function trimSnapshotToBudgets(
  snapshot: MemoryStoreSnapshot,
  options?: { gameBudgetBytes?: number; globalBudgetBytes?: number; otherGamesBytes?: number }
): MemoryStoreSnapshot {
  const gameBudget = options?.gameBudgetBytes ?? MEMORY_GAME_BUDGET_BYTES
  const globalBudget = (options?.globalBudgetBytes ?? MEMORY_GLOBAL_BUDGET_BYTES) - (options?.otherGamesBytes || 0)
  if (globalBudget < METADATA_RESERVE_BYTES) {
    throw Object.assign(new Error('Companion memory global capacity reached'), { code: 'PERSISTENCE_DEGRADED', retryable: true })
  }
  const next = cloneSnapshot(snapshot)
  next.episodes.sort((a, b) => a.at - b.at)
  next.episodes = next.episodes.slice(-4096)
  next.saveLinks.sort((a, b) => a.at - b.at)
  next.saveLinks = next.saveLinks.slice(-1024)
  next.projections = next.projections.slice(-4096)
  next.preferences.sort((a, b) => a.updatedAt - b.updatedAt)
  next.preferences = next.preferences.slice(-MEMORY_PREFERENCE_MAX)
  let prefBytes = next.preferences.reduce((sum, item) => sum + estimateRecordBytes(item), 0)
  while (prefBytes > MEMORY_PREFERENCE_MAX_BYTES && next.preferences.length) {
    prefBytes -= estimateRecordBytes(next.preferences.shift()!)
  }

  const grouped = new Map<string, { episodes: MemoryEpisodeRecord[]; links: MemoryStoreSnapshot['saveLinks']; projections: MemoryStoreSnapshot['projections'] }>()
  const groupFor = (key: string) => {
    let group = grouped.get(key)
    if (!group) {
      group = { episodes: [], links: [], projections: [] }
      grouped.set(key, group)
    }
    return group
  }
  for (const episode of next.episodes) {
    groupFor(gameRevisionKey(episode.scope)).episodes.push(episode)
  }
  for (const link of next.saveLinks) groupFor(gameRevisionKey(link.scope)).links.push(link)
  for (const projection of next.projections) groupFor(gameRevisionKey(projection.key)).projections.push(projection)
  const revisionBudget = Math.max(0, gameBudget - prefBytes - METADATA_RESERVE_BYTES)
  for (const group of grouped.values()) {
    let extras = group.links.reduce((sum, item) => sum + estimateRecordBytes(item), 0) + group.projections.reduce((sum, item) => sum + estimateRecordBytes(item), 0)
    while (extras > revisionBudget && group.links.length) extras -= estimateRecordBytes(group.links.shift()!)
    while (extras > revisionBudget && group.projections.length) extras -= estimateRecordBytes(group.projections.shift()!)
    group.episodes = trimEpisodeGroup(group.episodes, Math.max(0, revisionBudget - extras))
  }
  next.episodes = [...grouped.values()].flatMap((group) => group.episodes).sort((a, b) => a.at - b.at)
  next.saveLinks = [...grouped.values()].flatMap((group) => group.links).sort((a, b) => a.at - b.at)
  next.projections = [...grouped.values()].flatMap((group) => group.projections)
  const extras =
    prefBytes +
    next.saveLinks.reduce((sum, item) => sum + estimateRecordBytes(item), 0) +
    next.projections.reduce((sum, item) => sum + estimateRecordBytes(item), 0) +
    METADATA_RESERVE_BYTES
  next.episodes = trimEpisodeGroup(next.episodes, Math.max(0, globalBudget - extras))
  next.evidence = next.episodes.map(evidenceRecord)
  while (snapshotLogicalBytes(next) > globalBudget && next.saveLinks.length) next.saveLinks.shift()
  while (snapshotLogicalBytes(next) > globalBudget && next.projections.length) next.projections.shift()
  while (snapshotLogicalBytes(next) > globalBudget && next.preferences.length) next.preferences.shift()
  return next
}

export function emptyMemorySnapshot(partial?: Partial<MemoryStoreSnapshot>): MemoryStoreSnapshot {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    memoryEpoch: partial?.memoryEpoch || 1,
    recordingRevision: partial?.recordingRevision || 1,
    recordingEnabled: partial?.recordingEnabled !== false,
    generation: partial?.generation || 1,
    episodes: partial?.episodes || [],
    evidence: partial?.evidence || [],
    saveLinks: partial?.saveLinks || [],
    preferences: partial?.preferences || [],
    projections: partial?.projections || [],
  }
}

export function filterSnapshotToGame(snapshot: MemoryStoreSnapshot, gameId: string): MemoryStoreSnapshot {
  return {
    ...snapshot,
    episodes: snapshot.episodes.filter((item) => item.scope.libraryGameId === gameId),
    evidence: snapshot.evidence.filter((item) => item.scope.libraryGameId === gameId),
    saveLinks: snapshot.saveLinks.filter((item) => item.scope.libraryGameId === gameId),
    projections: snapshot.projections.filter((item) => item.key.libraryGameId === gameId),
    preferences: snapshot.preferences.filter((item) => !item.libraryGameId || item.libraryGameId === gameId),
  }
}
