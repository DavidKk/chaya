/** Pending write-queue helpers for companion memory. */

import { estimateRecordBytes, MEMORY_PENDING_QUEUE_MAX, MEMORY_PENDING_QUEUE_MAX_BYTES } from './memory-limits'
import { MEMORY_SCHEMA_VERSION, type MemoryEpisodeRecord, type MemoryPreferenceRecord, type MemorySaveLink, type MemoryWriteBatch } from './memory-types'

export type MemoryPendingKind = 'episode' | 'preference' | 'saveLink' | 'clear' | 'recording'

export type MemoryPendingItem = {
  kind: MemoryPendingKind
  memoryEpoch: number
  recordingRevision: number
  bytes: number
  payload: MemoryEpisodeRecord | MemoryPreferenceRecord | MemorySaveLink | { libraryGameId?: string; preferences?: boolean; episodes?: boolean } | { enabled: boolean }
}

export function enqueuePending(
  pending: MemoryPendingItem[],
  pendingBytes: number,
  item: MemoryPendingItem,
  onDropEpisode?: (episode: MemoryEpisodeRecord) => void
): { pending: MemoryPendingItem[]; pendingBytes: number; degraded?: string } {
  const next = pending.slice()
  let bytes = pendingBytes
  let degraded: string | undefined
  while (next.length >= MEMORY_PENDING_QUEUE_MAX || bytes + item.bytes > MEMORY_PENDING_QUEUE_MAX_BYTES) {
    const dropped = next.shift()
    if (!dropped) break
    bytes = Math.max(0, bytes - dropped.bytes)
    if (dropped.kind === 'episode') {
      onDropEpisode?.(dropped.payload as MemoryEpisodeRecord)
      degraded = 'pending memory queue capped; details dropped'
    }
  }
  next.push(item)
  bytes += item.bytes
  return { pending: next, pendingBytes: bytes, degraded }
}

export function invalidatePendingQueue(pending: MemoryPendingItem[], memoryEpoch: number, recordingRevision: number): { pending: MemoryPendingItem[]; pendingBytes: number } {
  const kept: MemoryPendingItem[] = []
  let bytes = 0
  for (const item of pending) {
    if (item.memoryEpoch === memoryEpoch && item.recordingRevision === recordingRevision && (item.kind === 'clear' || item.kind === 'recording' || item.kind === 'preference')) {
      kept.push(item)
      bytes += item.bytes
    }
  }
  return { pending: kept, pendingBytes: bytes }
}

export function buildWriteBatch(items: MemoryPendingItem[], memoryEpoch: number, recordingRevision: number): MemoryWriteBatch {
  const episodes: MemoryEpisodeRecord[] = []
  const preferences: MemoryPreferenceRecord[] = []
  const saveLinks: MemorySaveLink[] = []
  let clear: MemoryWriteBatch['clear']
  let setRecording: boolean | undefined
  for (const item of items) {
    if (item.memoryEpoch !== memoryEpoch && item.kind !== 'clear' && item.kind !== 'recording') continue
    if (item.recordingRevision !== recordingRevision && item.kind === 'episode') continue
    if (item.kind === 'episode') episodes.push(item.payload as MemoryEpisodeRecord)
    if (item.kind === 'preference') preferences.push(item.payload as MemoryPreferenceRecord)
    if (item.kind === 'saveLink') saveLinks.push(item.payload as MemorySaveLink)
    if (item.kind === 'clear') clear = item.payload as MemoryWriteBatch['clear']
    if (item.kind === 'recording') setRecording = (item.payload as { enabled: boolean }).enabled
  }
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    batchId: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    memoryEpoch,
    recordingRevision,
    at: Date.now(),
    episodes: episodes.length ? episodes : undefined,
    preferences: preferences.length ? preferences : undefined,
    saveLinks: saveLinks.length ? saveLinks : undefined,
    clear,
    setRecording,
  }
}

export function preferenceStorageKey(pref: Pick<MemoryPreferenceRecord, 'key' | 'libraryGameId' | 'scope'>): string {
  return `${pref.libraryGameId || ''}\0${pref.scope || ''}\0${pref.key}`
}

export function usedMemoryBytes(
  episodes: Array<{ bytes?: number }>,
  preferences: Iterable<unknown>,
  saveLinks: Iterable<unknown>,
  pendingBytes: number,
  actionRingBytes: number
): number {
  const episodeBytes = episodes.reduce((sum: number, item) => sum + (item.bytes || estimateRecordBytes(item)), 0)
  const prefBytes = [...preferences].reduce((sum: number, item) => sum + estimateRecordBytes(item), 0)
  const linkBytes = [...saveLinks].reduce((sum: number, item) => sum + estimateRecordBytes(item), 0)
  return episodeBytes + prefBytes + linkBytes + pendingBytes + actionRingBytes
}
