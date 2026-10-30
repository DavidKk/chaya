/** Estimate remaining work from the current run's measured character throughput only. */
export function estimateRemainMs(opts: { missingChars: number; charsPerSecond: number | null | undefined; running: boolean }): number | null {
  const { missingChars, charsPerSecond, running } = opts
  if (!running || !Number.isFinite(missingChars) || missingChars <= 0 || charsPerSecond == null || !Number.isFinite(charsPerSecond) || charsPerSecond <= 0) return null
  const ms = (missingChars / charsPerSecond) * 1000
  return Number.isFinite(ms) ? Math.ceil(ms) : null
}

/** Recent completed batches only: pauses and startup scans never reduce the measured rate. */
export type TranslationPerformance = { charsPerSecond: number; cacheMs: number; measuredAt?: number }
export type TranslationSample = { elapsedMs: number; completedChars: number; cacheMs: number }
export type LiveTranslationSample = { at: number; chars: number }

/** A persisted rate stops describing current throughput after results stop arriving. */
export function freshTranslationPerformance(performance: TranslationPerformance | null | undefined, measuredAt: number, now: number): TranslationPerformance | null {
  if (!performance || !Number.isFinite(measuredAt) || measuredAt <= 0 || !Number.isFinite(now) || now <= 0 || now - measuredAt > 30_000) return null
  return performance
}

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

/**
 * Character throughput over a recent wall-clock window. Item callbacks keep the ETA
 * moving between multi-second engine batches instead of waiting for the next slice.
 */
export function rollingTranslationPerformance(
  samples: LiveTranslationSample[],
  opts?: { now?: number; windowMs?: number; cacheMs?: number; minElapsedMs?: number }
): TranslationPerformance | null {
  const now = opts?.now ?? Date.now()
  const windowMs = opts?.windowMs ?? 10_000
  const minElapsedMs = opts?.minElapsedMs ?? 400
  const recent = samples.filter((sample) => Number.isFinite(sample.at) && sample.at <= now && now - sample.at <= windowMs)
  if (recent.length < 2) return null
  const chars = recent.reduce((sum, sample) => sum + (Number.isFinite(sample.chars) && sample.chars > 0 ? sample.chars : 0), 0)
  const elapsedMs = now - recent[0].at
  if (chars <= 0 || elapsedMs < minElapsedMs) return null
  return { charsPerSecond: (chars * 1000) / elapsedMs, cacheMs: opts?.cacheMs ?? 0 }
}

/** Damp short-window spikes without freezing the estimate after a genuine speed change. */
export function smoothTranslationPerformance(
  previous: TranslationPerformance | null | undefined,
  next: TranslationPerformance | null | undefined,
  alpha = 0.2
): TranslationPerformance | null {
  if (!next || !Number.isFinite(next.charsPerSecond) || next.charsPerSecond <= 0 || !Number.isFinite(next.cacheMs) || next.cacheMs < 0) {
    return previous && Number.isFinite(previous.charsPerSecond) && previous.charsPerSecond > 0 ? previous : null
  }
  if (!previous || !Number.isFinite(previous.charsPerSecond) || previous.charsPerSecond <= 0) return next
  const weight = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 0.2))
  return {
    charsPerSecond: previous.charsPerSecond * (1 - weight) + next.charsPerSecond * weight,
    cacheMs: next.cacheMs,
    ...((next.measuredAt ?? previous.measuredAt) != null ? { measuredAt: next.measuredAt ?? previous.measuredAt } : {}),
  }
}

/** Extrapolate only a short distance so a stalled worker does not make the ETA keep falling. */
export function projectRemainingChars(opts: { missingChars: number; charsPerSecond: number | null | undefined; elapsedMs: number; maxElapsedMs?: number }): number {
  const { missingChars, charsPerSecond, elapsedMs } = opts
  if (!Number.isFinite(missingChars) || missingChars <= 0) return Math.max(0, Number.isFinite(missingChars) ? missingChars : 0)
  if (charsPerSecond == null || !Number.isFinite(charsPerSecond) || charsPerSecond <= 0) return missingChars
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return missingChars
  const maxElapsedMs = Number.isFinite(opts.maxElapsedMs) ? Math.max(0, opts.maxElapsedMs!) : 2000
  const chars = (charsPerSecond * Math.min(elapsedMs, maxElapsedMs)) / 1000
  return Math.max(0, Math.ceil(missingChars - chars))
}

export function formatRemainEta(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  const minutes = Math.floor(seconds / 60)
  return seconds < 3600 ? `${pad(minutes)}:${pad(seconds % 60)}` : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds % 60)}`
}
