import type { CacheLang } from '@/lib/translate/cache-lang'

/** Compact language codes for dense table cells (filters keep full labels). */
export const CACHE_LANG_CODE: Record<CacheLang, string> = {
  ja: 'JA',
  en: 'EN',
  zh: 'ZH',
  ko: 'KO',
  ru: 'RU',
}

/** Compact hit counts: 999 → 999, 1500 → 1k+, 12000 → 10k+, 2.5e6 → 2m+, 1.5e9 → 1b+. */
export function formatCacheHitCount(n: number): string {
  const v = Math.floor(Number(n) || 0)
  if (v < 1_000) return String(Math.max(0, v))
  if (v < 10_000) return `${Math.floor(v / 1_000)}k+`
  if (v < 1_000_000) return `${Math.floor(v / 10_000) * 10}k+`
  if (v < 1_000_000_000) return `${Math.floor(v / 1_000_000)}m+`
  return `${Math.floor(v / 1_000_000_000)}b+`
}

/** Compact updated-at for table: `10-17 15:32` (local). Full string left for title/tooltip. */
export function formatCacheUpdatedAt(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}
