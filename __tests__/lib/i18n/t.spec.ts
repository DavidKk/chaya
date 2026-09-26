import { localeFromAcceptLanguage } from '@/lib/i18n/locales'
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
  expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9')).toBe('en')
})
