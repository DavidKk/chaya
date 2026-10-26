import { LOCALES, MESSAGES, translate } from '@/lib/i18n'
import { formatTranslationFailure, readTranslationFailure } from '@/lib/translate/failure-log'

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(MESSAGES.zh, key, params)

test('legacy logs preserve source parentheses and separate engine reasons without splitting error punctuation', () => {
  const text =
    'Translation failed: 70 森３ (入口) (agent:mvl7n320zs0h: No valid translation returned or control tokens missing; apple: Apple offline language pack not installed. Please download.; bergamot: Language pack not installed: /local/ja_zh/config.yml)'
  const failure = readTranslationFailure(text)!
  expect(failure.source).toBe('70 森３ (入口)')
  const formatted = formatTranslationFailure(failure, t)
  expect(formatted.split('\n')).toHaveLength(4)
  expect(formatted).toContain('Agent (mvl7n320zs0h)：返回内容未通过校验')
  expect(formatted).toContain('Apple：缺少本次翻译所需的离线语言包')
  expect(formatted).toContain('Bergamot (ja → zh)：缺少本次翻译所需的离线语言包')
  expect(formatted).not.toContain('/local/ja_zh/config.yml')
})

test('generic Apple errors and unknown diagnostics remain intact without pack installation advice', () => {
  const formatted = formatTranslationFailure({ source: '森', error: 'apple: Unable to Translate; diagnostic (code: 42)' }, t)
  expect(formatted).toContain('Apple：Unable to Translate; diagnostic (code: 42)')
  expect(formatted).not.toContain('语言包')
  expect(readTranslationFailure('Translation paused: 42')).toBeUndefined()
  expect(readTranslationFailure('Translation failed: 森 (unrecognized error)')).toBeUndefined()
})

test('new validation reasons distinguish invalid translation from missing controls', () => {
  expect(formatTranslationFailure({ source: '森', error: 'agent:a: No valid translation returned' }, t)).toContain('未返回有效译文')
  expect(formatTranslationFailure({ source: '森', error: 'agent:a: Translation control tokens missing' }, t)).toContain('译文缺少必须保留的控制标记')
})

test('each engine reports its requested language pair independently of its failure reason', () => {
  const formatted = formatTranslationFailure(
    {
      source: '123 森１８-ev1',
      error:
        'agent:a: [ja -> zh] No valid translation returned; apple: [ja -> zh] Apple offline language pack not installed; bergamot: [ja -> zh] Language pack not installed: /local/ja_zh/config.yml',
    },
    t
  )
  expect(formatted).toContain('Agent (a · ja → zh)：未返回有效译文')
  expect(formatted).toContain('Apple (ja → zh)：缺少本次翻译所需的离线语言包')
  expect(formatted).toContain('Bergamot (ja → zh)：缺少本次翻译所需的离线语言包')
  expect(formatted).not.toContain('[ja -> zh]')
  expect(formatted).not.toContain('/local/')
})

test('language pair metadata preserves generic engine errors without installation advice', () => {
  const formatted = formatTranslationFailure({ source: 'Test', error: 'apple: [en -> zh-Hans] Unable to Translate' }, t)
  expect(formatted).toContain('Apple (en → zh-Hans)：Unable to Translate')
  expect(formatted).not.toContain('语言包')
})

test.each(LOCALES)('failure log messages are available in %s', (locale) => {
  const formatted = formatTranslationFailure(
    { source: '森', error: 'agent:a: No valid translation returned; apple: Apple offline language pack not installed; bergamot: Language pack not installed: config.yml' },
    (key, params) => translate(MESSAGES[locale], key, params)
  )
  expect(formatted).not.toContain('translate.failure')
  expect(formatted).not.toMatch(/\{(?:source|reasons|engine|reason)\}/)
})
