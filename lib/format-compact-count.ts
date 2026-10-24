/** Compact integer for UI/logs: 1200 → 1.2k, 2e6 → 2m, 3e9 → 3b. */
export function formatCompactCount(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (!Number.isFinite(abs)) return String(n)
  if (abs < 1000) return `${sign}${Math.round(abs)}`
  const trim = (value: number, suffix: string) => {
    const fixed = value >= 10 ? value.toFixed(0) : value.toFixed(1)
    return `${sign}${fixed.replace(/\.0$/, '')}${suffix}`
  }
  if (abs < 1_000_000) return trim(abs / 1000, 'k')
  if (abs < 1_000_000_000) return trim(abs / 1_000_000, 'm')
  return trim(abs / 1_000_000_000, 'b')
}
