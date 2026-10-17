/** Coarse source groups for the shared cache. Raw tags such as import files and live:agent stay in storage. */
export const CACHE_ENGINE_KINDS = ['import', 'agent', 'google', 'bing'] as const
export type CacheEngineKind = (typeof CACHE_ENGINE_KINDS)[number]

export function cacheEngineKind(engine: string | null | undefined): CacheEngineKind | null {
  const value = String(engine || '').trim()
  if (!value) return null
  if ((CACHE_ENGINE_KINDS as readonly string[]).includes(value)) return value as CacheEngineKind
  if (/google/i.test(value)) return 'google'
  if (/bing/i.test(value)) return 'bing'
  if (/^import\b/i.test(value)) return 'import'
  if (/agent|ollama/i.test(value)) return 'agent'
  return null
}

/** Realtime writes are stored as live:<source>. Import rows stay unmarked. */
export function isLiveCacheEngine(engine: string | null | undefined): boolean {
  return /^live:/i.test(String(engine || '').trim())
}

/** NSFW polarity for the cache list. Empty shows every row. `1` / `true` keep the older only-NSFW query. */
export const CACHE_NSFW_FLAGS = ['nsfw', 'safe'] as const
export type CacheNsfwFlag = (typeof CACHE_NSFW_FLAGS)[number]

export function parseCacheNsfwFlag(raw: string | null | undefined): CacheNsfwFlag | '' {
  const value = String(raw || '').trim()
  if (value === '1' || value === 'true') return 'nsfw'
  return (CACHE_NSFW_FLAGS as readonly string[]).includes(value) ? (value as CacheNsfwFlag) : ''
}

/** Whether a cache row was written by realtime translation. Empty shows every row. */
export const CACHE_LIVE_FLAGS = ['live', 'stored'] as const
export type CacheLiveFlag = (typeof CACHE_LIVE_FLAGS)[number]

export function parseCacheLiveFlag(raw: string | null | undefined): CacheLiveFlag | '' {
  const value = String(raw || '').trim()
  return (CACHE_LIVE_FLAGS as readonly string[]).includes(value) ? (value as CacheLiveFlag) : ''
}
