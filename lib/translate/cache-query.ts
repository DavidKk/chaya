/** Translation-cache query parameters without I/O, shared by web clients and Node. */

export type SharedCacheSortKey = 'updated' | 'hits'
export type SharedCacheSortDir = 'asc' | 'desc'

export function parseSharedCacheSortKey(raw: string | null | undefined, fallback: SharedCacheSortKey = 'updated'): SharedCacheSortKey {
  return raw === 'hits' || raw === 'updated' ? raw : fallback
}

export function parseSharedCacheSortDir(raw: string | null | undefined, fallback: SharedCacheSortDir = 'desc'): SharedCacheSortDir {
  return raw === 'asc' || raw === 'desc' ? raw : fallback
}

/**
 * 规范化翻译调试/缓存查询文本：
 * 1. 前后 trim 消除首尾空白（含首尾换行与空格）；
 * 2. 连续 2 个以上的水平空白（空格、全角空格 \u3000、\t、\b、\f、\v 等）或单个全角空格统一收敛为单个半角空格；
 * 3. 换行前后的水平空格移除；
 * 4. 连续 2 个以上的换行统一收敛为单个换行；
 * 5. 再次 trim，确保文本无论包含多少多余空格或换行，规范化后均保持一致。
 */
export function normalizeTranslateQuery(raw: string | null | undefined): string {
  if (!raw) return ''
  return String(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/(?:[^\S\n]|[\b])+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
