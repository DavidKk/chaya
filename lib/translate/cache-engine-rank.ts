/** Source authority is independent of matching coverage. */
export function cacheEngineRank(engine?: string | null): number {
  if (engine === 'manual') return 4
  if (engine === 'import' || engine?.startsWith('import:')) return 3
  if (engine?.startsWith('live:agent')) return 2
  if (engine === 'manual:optimize') return 0
  return 1
}
