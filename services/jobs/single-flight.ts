/** Process-wide single-flight: concurrent callers share one Promise per key. */

export function singleFlight<T>(flights: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = flights.get(key)
  if (existing) return existing
  const pending = run().finally(() => {
    if (flights.get(key) === pending) flights.delete(key)
  })
  flights.set(key, pending)
  return pending
}

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}
