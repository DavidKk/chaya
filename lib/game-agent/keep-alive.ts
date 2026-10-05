const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }

/** Ollama keep_alive (`10m` / `1h` / `500ms` / `0` / `-1`) → milliseconds; -1 = keep loaded */
export function keepAliveToMs(value: string, fallback = 600_000): number {
  const text = value.trim()
  if (text === '-1') return -1
  if (text === '0') return 0
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text)
  if (!match) return fallback
  return Math.round(Number(match[1]) * UNIT_MS[match[2]])
}

/** Milliseconds → the shortest exact keep_alive string */
export function msToKeepAlive(ms: number): string {
  if (!Number.isFinite(ms)) return '10m'
  if (ms < 0) return '-1'
  const n = Math.round(ms)
  if (n === 0) return '0'
  for (const unit of ['h', 'm', 's'] as const) if (n % UNIT_MS[unit] === 0) return `${n / UNIT_MS[unit]}${unit}`
  return `${n}ms`
}

export type KeepAlivePart = { unit: 'hour' | 'min' | 'sec' | 'ms'; n: number }
export type KeepAliveLabel = { kind: 'forever' } | { kind: 'unload' } | { kind: 'span'; parts: KeepAlivePart[] }

export function keepAliveLabel(ms: number): KeepAliveLabel {
  if (ms < 0) return { kind: 'forever' }
  let rest = Math.round(ms)
  if (rest === 0) return { kind: 'unload' }
  const parts: KeepAlivePart[] = []
  for (const [unit, size] of [
    ['hour', 3_600_000],
    ['min', 60_000],
    ['sec', 1000],
    ['ms', 1],
  ] as const) {
    const n = Math.floor(rest / size)
    if (n) parts.push({ unit, n })
    rest -= n * size
  }
  return { kind: 'span', parts }
}
