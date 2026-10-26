import { isCacheExecution } from '@/lib/translate/result-sources'

import type { LiveTranslateItem } from '../live-translate'
import { charCount } from '../text-classify'

export type Completed = { item: LiveTranslateItem; cacheMs: number }

/** Engine completions flush promptly; cache-only windows can grow independently. */
export function createResultWindow(limit: number, onItem?: (item: LiveTranslateItem) => void) {
  const selected: Completed[] = []
  let chars = 0
  let cacheCount = 0
  let hitCharCap = false
  const cacheOnly = () => cacheCount === selected.length
  const full = () => selected.length >= (cacheOnly() ? 40 : limit) || (cacheOnly() && (chars >= 10_000 || hitCharCap))
  return {
    selected,
    cacheOnly,
    full,
    chars: () => chars,
    take(completed: Completed[]) {
      while (completed.length && !full()) {
        const entry = completed.shift()!
        const size = charCount(entry.item.src)
        const cached = isCacheExecution(entry.item)
        if (selected.length && cached && cacheOnly() && chars + size > 10_000) {
          completed.unshift(entry)
          hitCharCap = true
          break
        }
        selected.push(entry)
        chars += size
        if (cached) cacheCount++
        onItem?.(entry.item)
      }
    },
  }
}
