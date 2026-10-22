/** Estimate remaining work from the current run's measured character throughput only. */
export function estimateRemainMs(opts: { missingChars: number; charsPerSecond: number | null | undefined; running: boolean }): number | null {
  const { missingChars, charsPerSecond, running } = opts
  if (!running || !Number.isFinite(missingChars) || missingChars <= 0 || charsPerSecond == null || !Number.isFinite(charsPerSecond) || charsPerSecond <= 0) return null
  const ms = (missingChars / charsPerSecond) * 1000
  return Number.isFinite(ms) ? Math.ceil(ms) : null
}

/** Recent completed batches only: pauses and startup scans never reduce the measured rate. */
export type TranslationPerformance = { charsPerSecond: number; cacheMs: number }
export type TranslationSample = { elapsedMs: number; completedChars: number; cacheMs: number }

export function translationPerformance(samples: TranslationSample[]): TranslationPerformance | null {
  const recent = samples.slice(-8)
  if (
    recent.some(
      (sample) =>
        !Number.isFinite(sample.elapsedMs) ||
        sample.elapsedMs <= 0 ||
        !Number.isFinite(sample.completedChars) ||
        sample.completedChars < 0 ||
        !Number.isFinite(sample.cacheMs) ||
        sample.cacheMs < 0
    )
  )
    return null
  const elapsed = recent.reduce((sum, sample) => sum + sample.elapsedMs, 0)
  if (!recent.length || elapsed <= 0) return null
  return {
    charsPerSecond: (recent.reduce((sum, sample) => sum + sample.completedChars, 0) * 1000) / elapsed,
    cacheMs: recent[recent.length - 1].cacheMs,
  }
}

export function formatRemainEta(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  const minutes = Math.floor(seconds / 60)
  return seconds < 3600 ? `${pad(minutes)}:${pad(seconds % 60)}` : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds % 60)}`
}
