export type DurationUnit = 'hour' | 'min' | 'sec' | 'ms'
export type DurationPart = { unit: DurationUnit; n: number }

const UNITS = [
  ['hour', 3_600_000],
  ['min', 60_000],
  ['sec', 1000],
  ['ms', 1],
] as const

/** Milliseconds → non-zero parts, largest unit first (90_500 → 1 min 30 sec 500 ms) */
export function durationParts(ms: number): DurationPart[] {
  let rest = Math.max(0, Math.round(ms))
  const parts: DurationPart[] = []
  for (const [unit, size] of UNITS) {
    const n = Math.floor(rest / size)
    if (n) parts.push({ unit, n })
    rest -= n * size
  }
  return parts
}
