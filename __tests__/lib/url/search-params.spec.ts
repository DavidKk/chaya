import { describe, expect, it } from '@jest/globals'

import { hrefWithQuery, parseFlag01, parsePositiveInt, patchSearchParams } from '@/lib/url/search-params'

describe('patchSearchParams / game URL 跳转', () => {
  it('写入 game id', () => {
    expect(patchSearchParams(new URLSearchParams(), { game: 'aaa-bbb' })).toBe('game=aaa-bbb')
  })

  it('同 id 再 patch 时 query 字符串不变（避免 Suspense 整页闪）', () => {
    const current = new URLSearchParams('game=kimochi-a')
    const next = patchSearchParams(current, { game: 'kimochi-a' })
    expect(next).toBe(current.toString())
  })

  it('切换到另一作时只改 game', () => {
    const current = new URLSearchParams('game=kimochi-a&tab=run')
    expect(patchSearchParams(current, { game: 'kimochi-b' })).toBe('game=kimochi-b&tab=run')
  })

  it('null / 空串删除键（解绑清 query）', () => {
    expect(patchSearchParams(new URLSearchParams('game=x&q=1'), { game: null })).toBe('q=1')
    expect(patchSearchParams(new URLSearchParams('game=x'), { game: '' })).toBe('')
  })

  it('hrefWithQuery 无 query 时不加 ?', () => {
    expect(hrefWithQuery('/game', '')).toBe('/game')
    expect(hrefWithQuery('/game', 'game=a')).toBe('/game?game=a')
  })

  it('模拟 replaceQuery：query 未变则不应导航', () => {
    const search = new URLSearchParams('game=stable-id')
    const query = patchSearchParams(search, { game: 'stable-id' })
    const shouldNavigate = query !== search.toString()
    expect(shouldNavigate).toBe(false)
  })

  it('模拟两作互跳：A→B 会导航，B→B 不再导航', () => {
    let q = 'game=game-a'
    const go = (id: string) => {
      const next = patchSearchParams(new URLSearchParams(q), { game: id })
      const navigated = next !== q
      q = next
      return navigated
    }
    expect(go('game-b')).toBe(true)
    expect(q).toBe('game=game-b')
    expect(go('game-b')).toBe(false)
  })
})

describe('parsePositiveInt / parseFlag01', () => {
  it('正整数夹紧', () => {
    // Number(null) === 0 → 夹到下限 1
    expect(parsePositiveInt(null, 10)).toBe(1)
    expect(parsePositiveInt('abc', 10)).toBe(10)
    expect(parsePositiveInt('3', 10)).toBe(3)
    expect(parsePositiveInt('0', 10)).toBe(1)
    expect(parsePositiveInt('9999999', 10, 100)).toBe(100)
  })

  it('flag 01', () => {
    expect(parseFlag01(null, true)).toBe(true)
    expect(parseFlag01('1', false)).toBe(true)
    expect(parseFlag01('0', true)).toBe(false)
  })
})
