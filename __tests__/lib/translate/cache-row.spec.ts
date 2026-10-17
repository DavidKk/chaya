import { parseCacheRow } from '@/lib/translate/cache-row'

describe('cache-row newlines', () => {
  it('keeps valid soft annotations and drops invalid spans', () => {
    const wrapped = '好きじゃ\n　ないんスよ'
    const nl = wrapped.indexOf('\n')
    const ok = parseCacheRow({
      s: wrapped,
      t: '其实不太喜欢啊',
      newlines: [{ start: nl, end: nl + 1, kind: 'soft' }],
    })
    expect(ok?.newlines).toEqual([{ start: nl, end: nl + 1, kind: 'soft' }])
    const bad = parseCacheRow({
      s: wrapped,
      t: '其实不太喜欢啊',
      newlines: [{ start: 0, end: 1, kind: 'soft' }],
    })
    expect(bad?.newlines).toBeUndefined()
  })
})
