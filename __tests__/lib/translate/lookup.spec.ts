import { type GlossaryEntry, indexGlossaryTemplate, maskGlossary, translateByGlossaryTemplate } from '@/lib/translate/glossary-mask'
import { indexTrailingStem, normalizeTranslateKey, trailingNumberParts, translateWithLookup } from '@/lib/translate/lookup'
import { toRmDigitTemplate } from '@/lib/translate/rm-escape'

describe('normalizeTranslateKey', () => {
  it('剥引号残片并 NFKC', () => {
    expect(normalizeTranslateKey('"こんにちは");')).toBe('こんにちは')
    expect(normalizeTranslateKey('ｶﾀｶﾅ')).toBe('カタカナ')
  })
})

describe('trailingNumberParts', () => {
  it('拆词干与编号', () => {
    expect(trailingNumberParts('自警団の団員2')).toEqual({ stem: '自警団の団員', num: '2' })
    expect(trailingNumberParts('ただです')).toBeNull()
  })
})

describe('translateWithLookup', () => {
  it('精确命中', () => {
    const lookup = { こんにちは: '你好' }
    expect(translateWithLookup(lookup, 'こんにちは')).toBe('你好')
  })

  it('按 RM 控制码切段命中', () => {
    const lookup = { 回復: '恢复' }
    expect(translateWithLookup(lookup, '\\C[2]回復\\C[0]する')).toBe('\\C[2]恢复\\C[0]する')
  })

  it('数字码模板：\\n[1] 缓存可命中 \\n[3]', () => {
    const lookup = {
      [toRmDigitTemplate('ボクと\\n[1]だけの秘密')]: toRmDigitTemplate('所以和\\n[1]的秘密'),
    }
    expect(translateWithLookup(lookup, 'ボクと\\n[3]だけの秘密')).toBe('所以和\\n[3]的秘密')
  })

  it('末尾数字族推导', () => {
    const lookup = { 自警団の団員2: '自警团团员2' }
    const stemBase = new Map<string, string>()
    indexTrailingStem(stemBase, '自警団の団員2', '自警团团员2')
    expect(translateWithLookup(lookup, '自警団の団員5', { stemBase })).toBe('自警团团员5')
  })
})

describe('glossary template', () => {
  const entries: GlossaryEntry[] = [
    { jp: 'アリス', type: 'name', token: '__NAME__' },
    { jp: 'ボブ', type: 'name', token: '__NAME__' },
  ]

  it('同句式专名可互换命中', () => {
    const templateZh = new Map<string, string>()
    const zhMap = { アリス: '爱丽丝', ボブ: '鲍勃' }
    indexGlossaryTemplate(templateZh, 'アリスはボブを殴った', '爱丽丝打了鲍勃', entries, zhMap)
    expect(maskGlossary('キャロルはボブを殴った', [...entries, { jp: 'キャロル', type: 'name', token: '__NAME__' }]).masked).toBe('__NAME__は__NAME__を殴った')
    const more: GlossaryEntry[] = [...entries, { jp: 'キャロル', type: 'name', token: '__NAME__' }]
    const zh = translateByGlossaryTemplate('キャロルはボブを殴った', more, { ...zhMap, キャロル: '卡罗尔' }, templateZh)
    expect(zh).toBe('卡罗尔打了鲍勃')
  })
})
