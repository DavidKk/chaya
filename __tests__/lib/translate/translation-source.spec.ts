import { classifyTranslationSource, isManualTranslation, resolveItemSourceKind } from '@/lib/translate/translation-source'

describe('translation-source', () => {
  it('classifies various engine strings into correct source kinds', () => {
    expect(classifyTranslationSource('manual')).toBe('manual')
    expect(classifyTranslationSource('agent:profile-1')).toBe('agent')
    expect(classifyTranslationSource('live:agent')).toBe('agent')
    expect(classifyTranslationSource('google')).toBe('platform')
    expect(classifyTranslationSource('live:bing')).toBe('platform')
    expect(classifyTranslationSource('apple')).toBe('offline')
    expect(classifyTranslationSource('live:apple')).toBe('offline')
    expect(classifyTranslationSource('bergamot')).toBe('offline')
    expect(classifyTranslationSource('ollama')).toBe('offline')
    expect(classifyTranslationSource('cache')).toBe('cache')
    expect(classifyTranslationSource('seed')).toBe('cache')
    expect(classifyTranslationSource('import:legacy')).toBe('cache')
    expect(classifyTranslationSource('')).toBe('cache')
    expect(classifyTranslationSource(null)).toBe('cache')
    expect(classifyTranslationSource(undefined)).toBe('cache')
  })

  it('identifies manual translations by engine tag', () => {
    expect(isManualTranslation({ zh: '已翻译', engine: 'manual' })).toBe(true)
    expect(isManualTranslation({ zh: '已翻译', engine: 'google' })).toBe(false)
    expect(isManualTranslation({ zh: '', engine: 'manual' })).toBe(false)
  })

  it('identifies active in-progress manual edits away from initial/saved text', () => {
    expect(isManualTranslation({ zh: '修改后', initialZh: '修改前', engine: 'google' })).toBe(true)
    expect(isManualTranslation({ zh: '修改后', savedZh: '修改前', engine: 'cache' })).toBe(true)
    expect(isManualTranslation({ zh: '未修改', initialZh: '未修改', engine: 'google' })).toBe(false)
  })

  it('resolves item source kind, prioritizing manual', () => {
    expect(resolveItemSourceKind({ zh: '' })).toBeNull()
    expect(resolveItemSourceKind({ zh: '新草稿', initialZh: '旧翻译', engine: 'google' })).toBe('manual')
    expect(resolveItemSourceKind({ zh: '机器翻译', initialZh: '机器翻译', engine: 'google' })).toBe('platform')
    expect(resolveItemSourceKind({ zh: 'AI翻译', initialZh: 'AI翻译', engine: 'agent:1' })).toBe('agent')
    expect(resolveItemSourceKind({ zh: '离线翻译', initialZh: '离线翻译', engine: 'apple' })).toBe('offline')
    expect(resolveItemSourceKind({ zh: '缓存内容', initialZh: '缓存内容', engine: 'cache' })).toBe('cache')
  })
})
