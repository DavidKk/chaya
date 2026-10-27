import { isCacheExecution } from '@/lib/translate/result-sources'
import type { TranslationWindowReason } from '@/lib/translate/runtime-api'

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

/** Collect across worker shards until capacity, engine completion, or a real drain. */
export async function collectResultWindow(
  completed: Completed[],
  options: {
    limit: number
    onItem?: (item: LiveTranslateItem) => void
    wake: () => void
    pump: () => void
    cacheWorkExhausted: () => boolean
    terminal: () => boolean
    flush: () => boolean
    notify: () => void
    wait: () => Promise<void>
  }
) {
  const window = createResultWindow(options.limit, options.onItem)
  const { selected } = window
  const elapsed = performance.now()
  let drainingSince: number | undefined
  let drainTimer: ReturnType<typeof setTimeout> | undefined
  const safetyTimer = setTimeout(options.notify, 5000)
  const resetDrainTimer = () => {
    if (drainTimer) clearTimeout(drainTimer)
    drainTimer = setTimeout(options.notify, 250)
  }
  try {
    while (true) {
      const prevCount = selected.length
      window.take(completed)
      options.wake()
      options.pump()
      window.take(completed)
      if (selected.length > prevCount && drainingSince != null) {
        drainingSince = performance.now()
        resetDrainTimer()
      }
      const queuedEngineResult = completed.some((entry) => !isCacheExecution(entry.item))
      const exhausted = options.cacheWorkExhausted()
      if (exhausted && window.cacheOnly() && selected.length > 0) {
        if (drainingSince == null) {
          drainingSince = performance.now()
          resetDrainTimer()
        }
      } else if (!exhausted && drainingSince != null) {
        drainingSince = undefined
        if (drainTimer) clearTimeout(drainTimer)
        drainTimer = undefined
      }
      const drainingExpired = selected.length > 0 && window.cacheOnly() && exhausted && drainingSince != null && performance.now() - drainingSince >= 250
      const reason: TranslationWindowReason | undefined = window.full()
        ? 'capacity'
        : !window.cacheOnly() || (selected.length >= options.limit && queuedEngineResult)
          ? 'engine-result'
          : options.terminal()
            ? 'finished'
            : selected.length > 0 && options.flush()
              ? 'interrupted'
              : drainingExpired
                ? 'cache-drained'
                : selected.length > 0 && performance.now() - elapsed >= 5000
                  ? 'timeout'
                  : undefined
      if (reason) return { ...window, reason }
      await options.wait()
    }
  } finally {
    if (drainTimer) clearTimeout(drainTimer)
    clearTimeout(safetyTimer)
  }
}
