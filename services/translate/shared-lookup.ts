import { lookupCachedTranslation, translationLookupKeys } from './cache-lookup'
import { openSharedCache } from './shared-cache'

/** 可选远程共享库：只查询，不依赖服务端的当前绑定游戏，不进行机翻。 */
export function lookupSharedTranslations(texts: string[]) {
  const cache = openSharedCache()
  try {
    const rows = cache.getMany(texts.flatMap(translationLookupKeys))
    return texts.map((src) => ({ src, zh: lookupCachedTranslation((key) => rows.get(key), src) }))
  } finally {
    cache.close()
  }
}
