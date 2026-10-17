import { detectCacheLang, detectCacheTargetLang, parseCacheLang, resolveCacheLangPair } from '@/lib/translate/cache-lang'

describe('cache-lang', () => {
  it('parses known language codes', () => {
    expect(parseCacheLang('ja')).toBe('ja')
    expect(parseCacheLang('EN')).toBe('en')
    expect(parseCacheLang('live')).toBe('')
  })

  it('detects source language from text', () => {
    expect(detectCacheLang('こんにちは')).toBe('ja')
    expect(detectCacheLang('Welcome to the village.')).toBe('en')
    // Han-only source defaults to Japanese for the RPG Maker catalog.
    expect(detectCacheLang('欢迎来到村子')).toBe('ja')
    expect(detectCacheLang('欢迎来到村子', 'zh')).toBe('zh')
  })

  it('detects target language from text', () => {
    expect(detectCacheTargetLang('更上一层楼')).toBe('zh')
    expect(detectCacheTargetLang('こんにちは')).toBe('ja')
    expect(detectCacheTargetLang('Hello')).toBe('en')
  })

  it('resolves explicit pair over detection and keeps default target', () => {
    expect(resolveCacheLangPair({ from: 'en', to: 'ja', src: 'こんにちは' })).toEqual({ from: 'en', to: 'ja' })
    expect(resolveCacheLangPair({ src: 'Hello' })).toEqual({ from: 'en', to: 'zh' })
  })
})
