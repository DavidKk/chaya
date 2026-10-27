import { engineAcceptsSensitive, type TranslateRunEngine } from '@/lib/translate/engines'

export const UNKNOWN = 0,
  MISS = 1,
  RUNNING = 2,
  DONE = 3,
  FAILED = 4,
  WAIT_CACHE = 5,
  RECHECK = 6

export function takeSeedEngineTask(
  engine: TranslateRunEngine,
  queue: {
    states: Uint8Array
    misses: number[]
    retries: Map<number, { order: TranslateRunEngine[]; next: number }>
    deferred: Map<TranslateRunEngine, Set<number>>
    cursors: Map<TranslateRunEngine, number>
    maxPending: number
    excluded: (id: number) => boolean
    exclude: (id: number) => void
    canFit: (id: number) => boolean
    sensitive: (id: number) => boolean
    inCacheWindow: (id: number) => boolean
    canClaimUnknown: () => boolean
  }
): number | undefined {
  const { states, misses, retries, deferred, cursors, canFit, sensitive, inCacheWindow } = queue
  for (let i = 0; retries.size < queue.maxPending && i < misses.length;) {
    const id = misses[i]
    if (states[id] !== MISS || retries.has(id)) {
      misses.splice(i, 1)
      continue
    }
    if (queue.excluded(id)) {
      queue.exclude(id)
      misses.splice(i, 1)
      continue
    }
    if (canFit(id) && (!sensitive(id) || engineAcceptsSensitive(engine))) {
      misses.splice(i, 1)
      return id
    }
    i++
  }
  const delayed = deferred.get(engine) || new Set<number>()
  deferred.set(engine, delayed)
  if (retries.size < queue.maxPending) {
    for (const id of delayed) {
      if (queue.excluded(id)) {
        queue.exclude(id)
        delayed.delete(id)
        continue
      }
      if (states[id] === UNKNOWN) {
        if (inCacheWindow(id) || !queue.canClaimUnknown()) continue
      } else if (states[id] !== MISS || retries.has(id)) {
        delayed.delete(id)
        continue
      }
      if (canFit(id)) {
        delayed.delete(id)
        return id
      }
    }
    let cursor = cursors.get(engine) || 0
    while (cursor < states.length && delayed.size < 64) {
      const id = cursor++
      cursors.set(engine, cursor)
      if (states[id] === UNKNOWN) {
        if (inCacheWindow(id) || !queue.canClaimUnknown()) continue
      } else if (states[id] !== MISS || retries.has(id)) continue
      if (queue.excluded(id)) {
        queue.exclude(id)
        continue
      }
      if (sensitive(id) && !engineAcceptsSensitive(engine)) continue
      if (!canFit(id)) {
        delayed.add(id)
        continue
      }
      return id
    }
  }
  for (const [id, attempt] of retries) {
    if (states[id] === MISS && attempt.order[attempt.next] === engine && canFit(id)) return id
  }
  return undefined
}
