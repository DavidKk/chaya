import { appleTranslator, toAppleLanguage } from '@/services/translate/lib/macos-translate'

describe('macos-translate', () => {
  it('maps language identifiers correctly', () => {
    expect(toAppleLanguage('ja', 'ja')).toBe('ja')
    expect(toAppleLanguage('zh', 'zh-Hans')).toBe('zh-Hans')
    expect(toAppleLanguage('zh-CN', 'zh-Hans')).toBe('zh-Hans')
    expect(toAppleLanguage('zh-TW', 'zh-Hans')).toBe('zh-Hant')
    expect(toAppleLanguage('cht', 'zh-Hans')).toBe('zh-Hant')
    expect(toAppleLanguage('pt-BR', 'pt-BR')).toBe('pt-BR')
    expect(toAppleLanguage('pt', 'pt-BR')).toBe('pt-BR')
    expect(toAppleLanguage(undefined, 'en')).toBe('en')
    expect(toAppleLanguage('unknown', 'ja')).toBe('unknown')
  })

  it('detects platform capability', () => {
    expect(typeof appleTranslator.isSupportedPlatform()).toBe('boolean')
  })

  it('handles empty text without calling daemon', async () => {
    const res = await appleTranslator.translate('')
    expect(res).toBe('')
    const resSpaces = await appleTranslator.translate('   ')
    expect(resSpaces).toBe('   ')
  })
})

describe('engine registration for apple', () => {
  it('includes apple in TRANSLATE_ENGINE_IDS', async () => {
    const { TRANSLATE_ENGINE_IDS, isBuiltinEngineId } = await import('@/lib/translate/engines')
    expect(TRANSLATE_ENGINE_IDS).toContain('apple')
    expect(isBuiltinEngineId('apple')).toBe(true)
  })

  it('normalizes apple engine in cacheEngineKind', async () => {
    const { cacheEngineKind, CACHE_ENGINE_KINDS } = await import('@/lib/translate/cache-engine-kind')
    expect(CACHE_ENGINE_KINDS).toContain('apple')
    expect(cacheEngineKind('apple')).toBe('apple')
    expect(cacheEngineKind('live:apple')).toBe('apple')
  })
})
