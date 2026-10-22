/** Subscribers share transport work; cancelling one caller must not cancel another caller's request. */
type Entry = { controller: AbortController; promise: Promise<string>; subscribers: number; settled: boolean }
const globalRequests = globalThis as typeof globalThis & { __chayaTranslationRequests?: Map<string, Entry> }
const requests = (globalRequests.__chayaTranslationRequests ??= new Map<string, Entry>())

export function joinTranslationRequest(key: string, work: (signal: AbortSignal) => Promise<string>, signal?: AbortSignal, onJoin?: () => void): Promise<string> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  let entry = requests.get(key)
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController()
    let resolveWork!: (value: string) => void
    let rejectWork!: (error: unknown) => void
    const promise = new Promise<string>((resolve, reject) => {
      resolveWork = resolve
      rejectWork = reject
    })
    entry = { controller, promise, subscribers: 0, settled: false }
    const own = entry
    requests.set(key, own)
    const settled = () => {
      own.settled = true
      if (requests.get(key) === own) requests.delete(key)
    }
    void own.promise.then(settled, settled)
    try {
      void Promise.resolve(work(controller.signal)).then(resolveWork, rejectWork)
    } catch (error) {
      rejectWork(error)
    }
  } else onJoin?.()
  const own = entry
  own.subscribers++
  return new Promise<string>((resolve, reject) => {
    let finished = false
    const release = () => {
      if (finished) return false
      finished = true
      signal?.removeEventListener('abort', abort)
      own.subscribers--
      if (!own.subscribers && !own.settled) own.controller.abort(new Error('All translation subscribers cancelled'))
      return true
    }
    const abort = () => {
      if (release()) reject(signal?.reason || new Error('Translation subscription cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    void own.promise.then(
      (value) => {
        if (release()) resolve(value)
      },
      (error) => {
        if (release()) reject(error)
      }
    )
    if (signal?.aborted) abort()
  })
}
