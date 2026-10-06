import { isStorableTranslation, shouldTranslate } from '@/services/translate/text-classify'

type Result = { src: string; zh: string | null }

/** Background fill for text that is actually drawn. Rendering never waits for the model. */
export function createRenderTranslation(options: {
  cached: (text: string) => string
  enabled: () => boolean
  request: (texts: string[], signal: AbortSignal) => Promise<Result[]>
  apply: (src: string, zh: string) => void
  refresh: () => void
}) {
  const pending = new Set<string>()
  const inFlight = new Set<string>()
  const retryAt = new Map<string, number>()
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let active: AbortController | null = null
  let disposed = false

  function observe(value: unknown) {
    if (disposed || !options.enabled() || typeof value !== 'string') {
      if (!disposed && !options.enabled()) pending.clear()
      return
    }
    const text = value.trim()
    if (text.length < 2 || text.length > 160 || !shouldTranslate(text) || options.cached(text) !== text || inFlight.has(text) || (retryAt.get(text) || 0) > Date.now()) return
    pending.add(text)
    if (pending.size > 64) pending.delete(pending.values().next().value!)
    if (!timer && !active) timer = setTimeout(flush, 200)
  }

  async function flush() {
    timer = null
    if (disposed || active || !options.enabled()) {
      pending.clear()
      return
    }
    const batch = [...pending].slice(0, 8)
    for (const text of batch) pending.delete(text)
    if (!batch.length) return
    for (const text of batch) inFlight.add(text)
    const controller = new AbortController()
    active = controller
    try {
      const items = await options.request(batch, controller.signal)
      if (disposed || controller.signal.aborted || !options.enabled()) return
      let changed = false
      const translated = new Set<string>()
      for (const item of items) {
        if (!batch.includes(item.src)) continue
        if (item.zh && isStorableTranslation(item.src, item.zh)) {
          options.apply(item.src, item.zh)
          translated.add(item.src)
          changed = true
        }
      }
      for (const text of batch) if (!translated.has(text)) retryAt.set(text, Date.now() + 30_000)
      while (retryAt.size > 256) retryAt.delete(retryAt.keys().next().value!)
      if (changed) {
        options.refresh()
        for (const listener of listeners) listener()
      }
    } catch {
      if (!controller.signal.aborted) for (const text of batch) retryAt.set(text, Date.now() + 30_000)
    } finally {
      for (const text of batch) inFlight.delete(text)
      if (active === controller) active = null
      if (!disposed && pending.size && options.enabled()) timer = setTimeout(flush, 200)
    }
  }

  return {
    observe,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      disposed = true
      if (timer) clearTimeout(timer)
      active?.abort()
      pending.clear()
      inFlight.clear()
      retryAt.clear()
      listeners.clear()
    },
  }
}
