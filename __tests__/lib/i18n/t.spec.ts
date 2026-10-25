import { localeFromAcceptLanguage, LOCALES } from '@/lib/i18n/locales'
import { MESSAGES } from '@/lib/i18n/messages'
import { en } from '@/lib/i18n/messages/en'
import { zh } from '@/lib/i18n/messages/zh'
import { translate } from '@/lib/i18n/t'

it('resolves nested keys and interpolates params', () => {
  expect(translate(zh, 'nav.library')).toBe('游戏库')
  expect(translate(en, 'nav.library')).toBe('Library')
  expect(translate(zh, 'launchHelp.pickSameDir', { name: 'Demo' })).toBe('请选同一游戏目录：Demo')
})

it('parses Accept-Language for SSR defaults', () => {
  expect(localeFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh')
  expect(localeFromAcceptLanguage('ja,en-US;q=0.8')).toBe('ja')
  expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9')).toBe('fr')
  expect(localeFromAcceptLanguage('it-IT,it;q=0.9')).toBe('en')
})

it.each(LOCALES)('formats batch counts and cache details in %s without unresolved placeholders', (locale) => {
  const tree = MESSAGES[locale]
  const params = {
    engine: 'Google',
    batch: 8400,
    success: 3,
    total: 4,
    failed: 1,
    chars: 120,
    cache: 2,
    cache_info: translate(tree, 'translate.batchLogCacheInfo', { cache: 2 }),
  }
  for (const key of ['translate.batchLogComplete', 'translate.batchLogPartial', 'translate.batchLogFailed'] as const) {
    const text = translate(tree, key, params)
    expect(text).toContain('[Google] #8400')
    expect(text).toContain('120')
    expect(text).not.toMatch(/\{|\}|translate\./)
  }
})
