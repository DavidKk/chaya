import { describe, expect, it } from '@jest/globals'

import { cacheDebugReturnHref, DEFAULT_TRANSLATE_TAB, parseTranslateTab, TRANSLATE_TABS, translateCacheDebugHref, translateTabHref } from '@/components/translate/tabs'

describe('translate tabs 路径', () => {
  it('默认 run，静态 tab 完整', () => {
    expect(DEFAULT_TRANSLATE_TAB).toBe('run')
    expect(TRANSLATE_TABS.map((t) => t.id)).toEqual(['run', 'cache', 'test'])
  })

  it('parse / href', () => {
    expect(parseTranslateTab('cache')).toBe('cache')
    expect(parseTranslateTab('nope')).toBe('run')
    expect(translateTabHref('run')).toBe('/translate/run')
    expect(translateTabHref('cache')).toBe('/translate/cache')
  })
})

it('keeps cache filters in an internal return URL and prefills valid languages only', () => {
  const search = new URLSearchParams({ q: '名前 & 条件', page: '3', from: 'ja', to: 'zh', sort: 'hits', order: 'asc' })
  const link = translateCacheDebugHref(search)
  const debug = new URL(link, 'http://localhost')
  expect(debug.pathname).toBe('/translate/test')
  expect(debug.searchParams.get('from')).toBe('ja')
  expect(cacheDebugReturnHref(debug.searchParams.get('returnTo'))).toBe('/translate/cache?' + search.toString())
  expect(new URL(translateCacheDebugHref(new URLSearchParams('from=bad')), 'http://localhost').searchParams.has('from')).toBe(false)
})
it.each([undefined, null, 'https://evil.test', '//evil.test', 'javascript:alert(1)', '/translate/cache/detail/4', '/translate/cache/../run'])(
  'rejects unexpected debug return target %s',
  (raw) => {
    expect(cacheDebugReturnHref(raw)).toBe('/translate/cache')
  }
)
