import { lookupCachedTranslation, lookupGameTranslation, translationLookupKeys } from '@/services/translate/cache-lookup'

it('restores surrounding controls while looking up the stored core', () => {
  const values: Record<string, string> = { こんにちは: '你好' }
  expect(lookupCachedTranslation((key) => values[key], '\\C[0]こんにちは\\C[2]')).toBe('\\C[0]你好\\C[2]')
  expect(translationLookupKeys('\\C[0]こんにちは')).toContain('こんにちは')
})

it('rejects unchanged local seed values and restores numbered template codes', () => {
  expect(lookupCachedTranslation((key) => key, 'こんにちは')).toBeNull()
  const values: Record<string, string> = { '勇者\\n[#]です': '勇者\\n[#]' }
  expect(lookupCachedTranslation((key) => values[key], '勇者\\N[3]です')).toBe('勇者\\N[3]')
})

it('ignores poisoned whole-choice cache entries and preserves executable metadata', () => {
  const src = '\\C[2]こんにちはif(s[1])en(true)'
  const values: Record<string, string> = { [src]: '你好如果(s[1])启用(true)', こんにちは: '你好' }
  expect(lookupCachedTranslation((key) => values[key], src)).toBe('\\C[2]你好if(s[1])en(true)')
  expect(translationLookupKeys(src)).not.toContain(src)
})

it('prefers this game library and falls back to shared translations only on a miss', () => {
  const local: Record<string, string> = { こんにちは: '本作你好' }
  const shared: Record<string, string> = { こんにちは: '其他游戏的你好', さようなら: '再见' }
  const fromLocal = (key: string) => local[key]
  const fromShared = (key: string) => shared[key]
  expect(lookupGameTranslation(fromLocal, fromShared, 'こんにちは')).toEqual({ zh: '本作你好', engine: 'cache:local' })
  expect(lookupGameTranslation(fromLocal, fromShared, 'さようなら')).toEqual({ zh: '再见', engine: 'cache:remote' })
})
