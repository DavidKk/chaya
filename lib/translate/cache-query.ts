/** Translation-cache query parameters without I/O, shared by web clients and Node. */

export type SharedCacheSortKey = 'updated' | 'hits'
export type SharedCacheSortDir = 'asc' | 'desc'

export function parseSharedCacheSortKey(raw: string | null | undefined, fallback: SharedCacheSortKey = 'updated'): SharedCacheSortKey {
  return raw === 'hits' || raw === 'updated' ? raw : fallback
}

export function parseSharedCacheSortDir(raw: string | null | undefined, fallback: SharedCacheSortDir = 'desc'): SharedCacheSortDir {
  return raw === 'asc' || raw === 'desc' ? raw : fallback
}
