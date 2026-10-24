/** Default capacity budgets for companion memory (docs/technical/companion-memory.md §2). */

export const MEMORY_ACTION_BUFFER_MAX = 256
export const MEMORY_ACTION_BUFFER_MAX_BYTES = 256 * 1024

export const MEMORY_EVIDENCE_FRAGMENT_MAX = 64
export const MEMORY_EVIDENCE_FRAGMENT_MAX_BYTES = 64 * 1024

export const MEMORY_PENDING_QUEUE_MAX = 256
export const MEMORY_PENDING_QUEUE_MAX_BYTES = 1024 * 1024

export const MEMORY_GAME_BUDGET_BYTES = 20 * 1024 * 1024
export const MEMORY_GLOBAL_BUDGET_BYTES = 200 * 1024 * 1024
export const MEMORY_COMPACTION_WORKSPACE_BYTES = 20 * 1024 * 1024

export const MEMORY_PREFERENCE_MAX = 256
export const MEMORY_PREFERENCE_MAX_BYTES = 128 * 1024

export const MEMORY_QUERY_DEFAULT_LIMIT = 3
export const MEMORY_QUERY_MAX_LIMIT = 20
export const MEMORY_QUERY_TEXT_BUDGET = 2000

export const MEMORY_EPISODE_SUMMARY_MAX = 500
export const MEMORY_STRING_FIELD_MAX = 200
export const MEMORY_ID_FIELD_MAX = 160
export const MEMORY_EVIDENCE_ARRAY_MAX = 64
export const MEMORY_STATE_IDS_MAX = 32

export const MEMORY_MILESTONE_DETAILS_MAX_BYTES = 4 * 1024

export const MEMORY_WRITE_RETRY_MAX = 2
export const MEMORY_WRITE_RETRY_BASE_MS = 120

export function utf8Bytes(value: unknown): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
}

export function clampText(value: string, max = MEMORY_STRING_FIELD_MAX): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
}

export function estimateRecordBytes(value: unknown): number {
  try {
    return utf8Bytes(value)
  } catch {
    return 0
  }
}
