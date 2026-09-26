/** 合并 URL query；`null` / `undefined` / `''` 表示删除该键。 */
export function patchSearchParams(current: URLSearchParams | ReadonlyURLSearchParamsLike, patch: Record<string, string | null | undefined>): string {
  const next = new URLSearchParams(current.toString())
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') next.delete(key)
    else next.set(key, value)
  }
  return next.toString()
}

export function hrefWithQuery(pathname: string, query: string): string {
  return query ? `${pathname}?${query}` : pathname
}

type ReadonlyURLSearchParamsLike = { toString(): string }

export function parsePositiveInt(raw: string | null, fallback: number, max = 1_000_000): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(1, Math.floor(n)))
}

export function parseFlag01(raw: string | null, whenMissing: boolean): boolean {
  if (raw == null) return whenMissing
  return raw === '1' || raw === 'true'
}
