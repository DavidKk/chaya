/** Keep checkpoints frequent without giving up fast engines' array batching. */
export function createSeedBatchBudget(initialLimit = 12) {
  let limit = Math.max(4, Math.min(40, initialLimit))
  let maxChars = 3000
  const targetMs = 5000
  return {
    current: () => ({ limit, maxChars }),
    observe(elapsedMs: number, failed: number, scanned: number) {
      if (!scanned) return
      const ratio = Math.max(0.5, Math.min(1.5, targetMs / Math.max(1, elapsedMs)))
      // Errors and long tails should reduce the next slice, never grow it.
      const factor = failed ? Math.min(0.75, ratio) : ratio
      limit = Math.max(4, Math.min(40, Math.floor(limit * factor)))
      maxChars = Math.max(500, Math.min(10000, Math.floor(maxChars * factor)))
    },
  }
}
