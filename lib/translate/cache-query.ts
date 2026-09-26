/** 翻译缓存列表查询参数（无 I/O，可供 Web 客户端与 Node 共用） */

export type SharedCacheSortKey = 'updated' | 'hits'
export type SharedCacheSortDir = 'asc' | 'desc'

export function parseSharedCacheSortKey(raw: string | null | undefined, fallback: SharedCacheSortKey = 'updated'): SharedCacheSortKey {
  return raw === 'hits' || raw === 'updated' ? raw : fallback
}

export function parseSharedCacheSortDir(raw: string | null | undefined, fallback: SharedCacheSortDir = 'desc'): SharedCacheSortDir {
  return raw === 'asc' || raw === 'desc' ? raw : fallback
}
