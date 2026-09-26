import { applyRmDigitCodes, extractRmDigitCodes, hasRmDigitCodes, lookupWithRmDigitTemplate, toRmDigitTemplate } from '@/lib/translate/rm-escape'

describe('rm-escape digit templates', () => {
  it('detects and extracts \\n[n] / \\c[n]', () => {
    const s = 'ボクと\\n[1]だけの\\C[16]秘密'
    expect(hasRmDigitCodes(s)).toBe(true)
    expect(extractRmDigitCodes(s)).toEqual(['\\n[1]', '\\C[16]'])
  })

  it('normalizes digits and letter case into template', () => {
    expect(toRmDigitTemplate('ボクと\\n[1]だけ')).toBe('ボクと\\n[#]だけ')
    expect(toRmDigitTemplate('ボクと\\N[3]だけ')).toBe('ボクと\\n[#]だけ')
    expect(toRmDigitTemplate('\\C[2]回復\\C[0]')).toBe('\\c[#]回復\\c[#]')
  })

  it('applies codes from a new sentence onto a template zh', () => {
    const zhTpl = '所以和\\n[#]的秘密'
    expect(applyRmDigitCodes(zhTpl, ['\\n[3]'])).toBe('所以和\\n[3]的秘密')
  })

  it('lookupWithRmDigitTemplate rematerializes actor ids', () => {
    const map: Record<string, string> = {
      'ボクと\\n[#]だけの秘密': '所以和\\n[#]的秘密',
    }
    expect(lookupWithRmDigitTemplate((k) => map[k], 'ボクと\\n[1]だけの秘密')).toBe('所以和\\n[1]的秘密')
    expect(lookupWithRmDigitTemplate((k) => map[k], 'ボクと\\n[3]だけの秘密')).toBe('所以和\\n[3]的秘密')
    expect(lookupWithRmDigitTemplate((k) => map[k], '普通句子')).toBeNull()
  })
})
