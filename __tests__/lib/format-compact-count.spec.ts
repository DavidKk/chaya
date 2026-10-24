import { formatCompactCount } from '@/lib/format-compact-count'

describe('formatCompactCount', () => {
  it('keeps small integers', () => {
    expect(formatCompactCount(0)).toBe('0')
    expect(formatCompactCount(999)).toBe('999')
  })

  it('uses k / m / b suffixes', () => {
    expect(formatCompactCount(1200)).toBe('1.2k')
    expect(formatCompactCount(15_000)).toBe('15k')
    expect(formatCompactCount(2_500_000)).toBe('2.5m')
    expect(formatCompactCount(3_000_000_000)).toBe('3b')
  })
})
