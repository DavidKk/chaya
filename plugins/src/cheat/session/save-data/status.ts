/** Change signal for the shared status (generation, undo stack, locks, pins); coalesced to one notify per tick */
const listeners = new Set<() => void>()
let queued = false

export function onStatusChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function markStatusChanged() {
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    for (const cb of [...listeners]) {
      try {
        cb()
      } catch {
        /* a listener must not block the others */
      }
    }
  })
}
