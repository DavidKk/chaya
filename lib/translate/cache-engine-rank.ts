/** Source authority is independent of matching coverage. */
export function cacheEngineRank(engine?: string | null): number {
  if (engine === 'manual') return 4
  if (engine === 'import' || engine?.startsWith('import:')) return 3
  /** Name/term optimization must outrank plain live:* so results are not clobbered. */
  if (engine === 'live:optimize' || engine?.startsWith('live:optimize:') || engine?.startsWith('live:agent')) return 2
  /** Legacy optimize tag — do not use for new writes. */
  if (engine === 'manual:optimize') return 0
  return 1
}
