import { describe, expect, it } from '@jest/globals'

import { DEFAULT_TRANSLATE_TAB, parseTranslateTab, TRANSLATE_TABS, translateTabHref } from '@/components/translate/tabs'

describe('translate tabs 路径', () => {
  it('默认 run，静态 tab 完整', () => {
    expect(DEFAULT_TRANSLATE_TAB).toBe('run')
    expect(TRANSLATE_TABS.map((t) => t.id)).toEqual(['run', 'cache'])
  })

  it('parse / href', () => {
    expect(parseTranslateTab('cache')).toBe('cache')
    expect(parseTranslateTab('nope')).toBe('run')
    expect(translateTabHref('run')).toBe('/translate/run')
    expect(translateTabHref('cache')).toBe('/translate/cache')
  })
})
