import {
  isIdenticalTranslation,
  isStorableTranslation,
  isUsefulTranslation,
  peelControlShell,
  peelProtectShell,
  protectForTranslate,
  restoreForTranslate,
  shouldTranslate,
  translationCoreForCache,
} from '@/services/translate/text-classify'

describe('text-classify protect / cache core', () => {
  it('peels leading \\c[n] / \\C[n] shells', () => {
    expect(peelProtectShell('\\c[16]次のレベルまで')).toEqual({
      lead: '\\c[16]',
      core: '次のレベルまで',
      trail: '',
    })
    expect(peelProtectShell('\\C[0]ミレリア学園に通う三年生')).toEqual({
      lead: '\\C[0]',
      core: 'ミレリア学園に通う三年生',
      trail: '',
    })
  })

  it('peelControlShell only strips RM controls, not ellipsis', () => {
    expect(peelControlShell('\\c[16]次のレベルまで')).toEqual({
      lead: '\\c[16]',
      core: '次のレベルまで',
      trail: '',
    })
    expect(peelControlShell('か……」')).toEqual({ lead: '', core: 'か……」', trail: '' })
  })

  it('cache core omits lead control codes; restore keeps them for in-game apply', () => {
    const guard = protectForTranslate('\\c[16]次のレベルまで')
    expect(guard.core).toBe('次のレベルまで')
    expect(guard.lead).toBe('\\c[16]')
    expect(guard.plain).toBe('次のレベルまで')

    const rawZh = '更上一层楼'
    expect(translationCoreForCache(rawZh, guard)).toBe('更上一层楼')
    expect(restoreForTranslate(rawZh, guard)).toBe('\\c[16]更上一层楼')
  })

  it('shouldTranslate skips han-only / control-only shells', () => {
    expect(shouldTranslate('値')).toBe(false)
    expect(shouldTranslate('現')).toBe(false)
    expect(shouldTranslate('\\c[16]')).toBe(false)
    expect(shouldTranslate('次のレベルまで')).toBe(true)
  })

  it('rejects identical src/zh as useful translation', () => {
    expect(isIdenticalTranslation('値', '値')).toBe(true)
    expect(isUsefulTranslation('値', '値', '値', '値')).toBe(false)
    expect(isUsefulTranslation('\\c[16]次のレベルまで', '次のレベルまで', '更上一层楼', '\\c[16]更上一层楼')).toBe(true)
  })

  it('keeps only fully translated text in the library', () => {
    expect(isStorableTranslation('こんにちは', '你好')).toBe(true)
    expect(isStorableTranslation('こんにちは', 'こんにちは')).toBe(false)
    expect(isStorableTranslation('こんにちは', '你好、こんにちは')).toBe(false)
    expect(isStorableTranslation('こんにちは', '你好、ゲーム')).toBe(false)
    expect(isStorableTranslation('\\C[1]こんにちは', '\\C[1]你好')).toBe(true)
    expect(isStorableTranslation('\\C[1]你好', '\\C[2]你好')).toBe(false)
    expect(isStorableTranslation('こんにちは', '\\C[1]')).toBe(false)
    expect(isStorableTranslation('こんにちは', 'Hello')).toBe(false)
    expect(isStorableTranslation('・1時間あたりの睡眠でスタミナ10回復します。', '・每个小时的睡眠都会恢复10耐力。')).toBe(true)
    expect(isStorableTranslation('こんにちは', '你好・世界ー')).toBe(true)
    expect(shouldTranslate('・ー。！？')).toBe(false)
    expect(isStorableTranslation('魔王', 'Demon King')).toBe(false)
    expect(isStorableTranslation('魔王', '魔王大人')).toBe(true)
    expect(isStorableTranslation('応接室へ行く', '去応接室')).toBe(false)
    expect(isStorableTranslation('応接室へ行く', '去会客室')).toBe(true)
    expect(isUsefulTranslation('こんにちは', 'こんにちは', '你好、こんにちは', '你好、こんにちは')).toBe(false)
  })

  it('protects mid-string \\n[n] actor codes as placeholders', () => {
    const guard = protectForTranslate('だからボクと\\n[1]だけの秘密')
    expect(guard.plain).toBe('だからボクと__C0__だけの秘密')
    expect(guard.tokens).toEqual(['\\n[1]'])
    expect(restoreForTranslate('所以和__C0__的秘密', guard)).toBe('所以和\\n[1]的秘密')
    expect(isUsefulTranslation('だからボクと\\n[1]だけの秘密', guard.plain, '所以和秘密', '所以和秘密')).toBe(false)
    expect(isUsefulTranslation('だからボクと\\n[1]だけの秘密', guard.plain, '所以和__C0__的秘密', '所以和\\n[1]的秘密')).toBe(true)
  })

  it('peels leading ! / !# skill-name marks then restores after translate', () => {
    expect(peelProtectShell('!#护盾')).toEqual({ lead: '!#', core: '护盾', trail: '' })
    expect(peelProtectShell('!アストラルホーリー')).toEqual({ lead: '!', core: 'アストラルホーリー', trail: '' })

    const guard = protectForTranslate('!エスクード')
    expect(guard.lead).toBe('!')
    expect(guard.core).toBe('エスクード')
    expect(guard.plain).toBe('エスクード')
    expect(restoreForTranslate('护盾', guard)).toBe('!护盾')
  })
})
