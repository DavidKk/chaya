/** Keep checkpoints frequent without giving up fast engines' array batching. */
export function createSeedBatchBudget(initialLimit = 12, isBatchEngine = false) {
  const minLimit = isBatchEngine ? 30 : 4
  const minChars = isBatchEngine ? 2800 : 500
  const defaultChars = isBatchEngine ? 3500 : 3000
  let limit = Math.max(minLimit, Math.min(40, initialLimit))
  let maxChars = defaultChars
  const targetMs = isBatchEngine ? 15000 : 5000
  return {
    current: () => ({ limit, maxChars }),
    observe(elapsedMs: number, failed: number, scanned: number) {
      if (!scanned) return
      const ratio = Math.max(0.5, Math.min(1.5, targetMs / Math.max(1, elapsedMs)))
      // Errors and long tails should reduce the next slice, never grow it.
      const factor = failed ? (isBatchEngine ? Math.min(0.85, ratio) : Math.min(0.75, ratio)) : ratio
      limit = Math.max(minLimit, Math.min(40, Math.floor(limit * factor)))
      maxChars = Math.max(minChars, Math.min(10000, Math.floor(maxChars * factor)))
    },
  }
}
