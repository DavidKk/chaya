import { type NewlineAnnotation, validateNewlineAnnotations } from './logic-text'
import { type AlignmentGroup, validateAlignments } from './sentence-plan'
/** One append-only event contains its value and provenance; no second metadata file. */
export type CacheOrigin = { id: string; revision: number; database: string }
export type CacheRow = {
  s: string
  t: string | null
  engine?: string
  at?: number
  origin?: CacheOrigin
  event?: string
  alignments?: AlignmentGroup[]
  /** Soft/hard line-break evidence on `s` (MVP: shared by console + plugin). */
  newlines?: NewlineAnnotation[]
}
export function parseCacheRow(value: unknown): CacheRow | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' && (typeof value[1] === 'string' || value[1] === null) ? { s: value[0], t: value[1] } : null
  if (!value || typeof value !== 'object') return null
  const r = { ...(value as Partial<CacheRow>) }
  if (typeof r.engine !== 'string') r.engine = undefined
  if (typeof r.event !== 'string') r.event = undefined
  if (typeof r.s !== 'string' || (typeof r.t !== 'string' && r.t !== null)) return null
  if (r.origin && (typeof r.origin.id !== 'string' || !Number.isInteger(r.origin.revision) || typeof r.origin.database !== 'string')) return null
  if (r.alignments && (!r.t || !validateAlignments({ src: r.s, zh: r.t, newlines: r.newlines }, r.alignments))) return { ...r, alignments: undefined } as CacheRow
  if (r.newlines && !validateNewlineAnnotations(r.s, r.newlines)) return { ...r, newlines: undefined } as CacheRow
  return r as CacheRow
}
export function applyCacheRow(rows: Map<string, CacheRow>, row: CacheRow): void {
  const previous = rows.get(row.s)
  if (row.t === null) {
    // A shared invalidation must never delete a later manual/local replacement.
    if (!row.origin || (previous?.origin?.database === row.origin.database && previous.origin.id === row.origin.id)) rows.delete(row.s)
  } else if (row.origin && previous && !previous.origin) {
    // Legacy/local entries are not implicitly promoted to replaceable shared backfills.
    return
  } else rows.set(row.s, row)
}
