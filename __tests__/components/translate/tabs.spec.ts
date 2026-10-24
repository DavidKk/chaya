import { describe, expect, it } from '@jest/globals'

import {
  cacheDebugReturnHref,
  DEFAULT_TRANSLATE_TAB,
  isTranslateEngineDetailPath,
  parseTranslateEnginePathId,
  parseTranslateTab,
  TRANSLATE_TABS,
  translateCacheDebugHref,
  translateEngineDetailHref,
  translatePathTab,
  translateTabHref,
} from '@/components/translate/tabs'

describe('translate tabs 路径', () => {
  it('默认 seed，静态 tab 完整', () => {
    expect(DEFAULT_TRANSLATE_TAB).toBe('seed')
    expect(TRANSLATE_TABS.map((t) => t.id)).toEqual(['seed', 'list', 'play', 'engines', 'cache', 'test'])
  })

  it('parse / href', () => {
    expect(parseTranslateTab('cache')).toBe('cache')
    expect(parseTranslateTab('nope')).toBe('seed')
    expect(translateTabHref('seed')).toBe('/translate/seed')
    expect(translateTabHref('cache')).toBe('/translate/cache')
  })

  it('engine detail uses /translate/engines/{entryId}', () => {
    expect(translateEngineDetailHref('m8k2ab1x9q')).toBe('/translate/engines/m8k2ab1x9q')
    expect(translateEngineDetailHref('agent_1')).toBe('/translate/engines/agent_1')
    expect(parseTranslateEnginePathId('/translate/engines')).toBeNull()
    expect(parseTranslateEnginePathId('/translate/engines/m8k2ab1x9q')).toBe('m8k2ab1x9q')
    expect(parseTranslateEnginePathId('/translate/engines/agent:agent_1')).toBeNull()
    expect(parseTranslateEnginePathId('/translate/engines/nope!')).toBeNull()
    expect(isTranslateEngineDetailPath('/translate/engines/m8k2ab1x9q')).toBe(true)
    expect(translatePathTab('/translate/engines/m8k2ab1x9q')).toBe('engines')
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
