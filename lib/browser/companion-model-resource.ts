type Priority = 'foreground' | 'control' | 'background'
type Ticket = { id: string; priority: Priority; deadline: number }
type Lease = { key: string; owner?: string; expiresAt: number; prefer: 'foreground' | 'control'; tickets: Ticket[] }

const DB_NAME = 'chaya-model-resources'
const STORE = 'leases'
const RECLAIM_MS = 5_000

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' })
    request.onerror = () => reject(request.error || new Error('MODEL_UNAVAILABLE: cannot coordinate model resources'))
    request.onblocked = () => reject(new Error('MODEL_BUSY: model resource database is blocked'))
    request.onsuccess = () => resolve(request.result)
  })
}

async function updateLease<T>(key: string, change: (lease: Lease) => T): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = store.get(key)
      let result: T
      request.onsuccess = () => {
        try {
          const now = Date.now()
          const lease: Lease = request.result || { key, expiresAt: 0, prefer: 'foreground', tickets: [] }
          lease.tickets = lease.tickets.filter((item) => item.deadline > now)
          if (lease.expiresAt <= now) delete lease.owner
          result = change(lease)
          if (!lease.owner && !lease.tickets.length) store.delete(key)
          else store.put(lease)
        } catch (error) {
          transaction.abort()
          reject(error)
        }
      }
      transaction.oncomplete = () => resolve(result!)
      transaction.onerror = () => reject(transaction.error || new Error('MODEL_UNAVAILABLE: model lease transaction failed'))
      transaction.onabort = () => reject(transaction.error || new Error('MODEL_BUSY: model lease transaction aborted'))
    })
  } finally {
    db.close()
  }
}

function wait(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const done = () => {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(done, 40)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function nextTicket(lease: Lease): Ticket | undefined {
  const foreground = lease.tickets.find((item) => item.priority === 'foreground')
  const control = lease.tickets.find((item) => item.priority === 'control')
  if (foreground && control) return lease.prefer === 'foreground' ? foreground : control
  return foreground || control || lease.tickets.find((item) => item.priority === 'background')
}

/**
 * Same-origin browser hosts coordinate with transactional leases. A dead host's lease
 * remains occupied through its request deadline and a reclaim window.
 */
export async function withBrowserModelResource<T>(input: {
  resourceKey: string
  priority: Priority
  timeoutMs: number
  signal: AbortSignal
  run: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const id = crypto.randomUUID()
  const timeoutMs = Math.max(1, Math.min(input.timeoutMs, 10 * 60_000))
  const deadline = Date.now() + timeoutMs
  const timer = new AbortController()
  const timeout = setTimeout(() => timer.abort(new DOMException('Model queue or generation timed out', 'TimeoutError')), timeoutMs)
  const signal = AbortSignal.any([input.signal, timer.signal])
  let registered = false
  try {
    while (true) {
      if (signal.aborted) throw signal.reason
      const acquired = await updateLease(input.resourceKey, (lease) => {
        if (signal.aborted) throw signal.reason
        if (!registered) {
          if (lease.tickets.length >= 16 || (input.priority === 'background' && lease.tickets.some((item) => item.priority === 'background'))) {
            throw Object.assign(new Error('Model resource queue is full'), { code: 'MODEL_BUSY', retryable: true })
          }
          lease.tickets.push({ id, priority: input.priority, deadline })
        }
        if (lease.owner || nextTicket(lease)?.id !== id) return false
        lease.owner = id
        lease.expiresAt = deadline + RECLAIM_MS
        lease.tickets = lease.tickets.filter((item) => item.id !== id)
        if (input.priority !== 'background') lease.prefer = input.priority === 'foreground' ? 'control' : 'foreground'
        return true
      })
      registered = true
      if (acquired) break
      await wait(signal)
    }
    if (signal.aborted) throw signal.reason
    // Deliberately await upstream settlement; abort does not logically free a live request.
    return await input.run(signal)
  } finally {
    clearTimeout(timeout)
    if (registered) {
      await updateLease(input.resourceKey, (lease) => {
        lease.tickets = lease.tickets.filter((item) => item.id !== id)
        if (lease.owner === id) delete lease.owner
      }).catch(() => undefined)
    }
  }
}
