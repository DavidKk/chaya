import { CACHE_LANG_CODE, formatCacheHitCount, formatCacheUpdatedAt } from '@/lib/translate/cache-format'

it('exposes short language codes for dense cells', () => {
  expect(CACHE_LANG_CODE).toEqual({ ja: 'JA', en: 'EN', zh: 'ZH', ko: 'KO', ru: 'RU' })
})

it('compacts hit counts at 1k / 10k / 1m / 1b thresholds', () => {
  expect(formatCacheHitCount(0)).toBe('0')
  expect(formatCacheHitCount(999)).toBe('999')
  expect(formatCacheHitCount(1000)).toBe('1k+')
  expect(formatCacheHitCount(9999)).toBe('9k+')
  expect(formatCacheHitCount(10_000)).toBe('10k+')
  expect(formatCacheHitCount(25_000)).toBe('20k+')
  expect(formatCacheHitCount(999_999)).toBe('990k+')
  expect(formatCacheHitCount(1_000_000)).toBe('1m+')
  expect(formatCacheHitCount(2_500_000)).toBe('2m+')
  expect(formatCacheHitCount(1_000_000_000)).toBe('1b+')
})

it('formats updated-at as compact local mm-dd hh:mm', () => {
  expect(formatCacheUpdatedAt(0)).toBe('—')
  const ts = new Date(2026, 9, 17, 15, 32, 8).getTime()
  expect(formatCacheUpdatedAt(ts)).toBe('10-17 15:32')
})
