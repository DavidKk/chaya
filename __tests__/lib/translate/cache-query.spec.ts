import { describe, expect, it } from '@jest/globals'

import { normalizeTranslateQuery } from '@/lib/translate/cache-query'

describe('normalizeTranslateQuery', () => {
  it('returns empty string for null, undefined, or empty/whitespace-only input', () => {
    expect(normalizeTranslateQuery(null)).toBe('')
    expect(normalizeTranslateQuery(undefined)).toBe('')
    expect(normalizeTranslateQuery('')).toBe('')
    expect(normalizeTranslateQuery('   \n\n  \t   ')).toBe('')
    expect(normalizeTranslateQuery('  \u3000\u3000  ')).toBe('')
  })

  it('trims leading and trailing whitespace and newlines', () => {
    const raw = '解放条件：①レベル60以上 ②再度VIP特典の仕事をする\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n'
    expect(normalizeTranslateQuery(raw)).toBe('解放条件：①レベル60以上 ②再度VIP特典の仕事をする')
  })

  it('collapses excessive horizontal spaces to a single space', () => {
    const raw = '  解放条件：①レベル60以上       ②再度VIP特典の仕事をする  '
    expect(normalizeTranslateQuery(raw)).toBe('解放条件：①レベル60以上 ②再度VIP特典の仕事をする')
  })

  it('normalizes fullwidth spaces and collapses them', () => {
    const raw1 = '解放条件：①レベル60以上　　　②再度VIP特典の仕事をする'
    const raw2 = '解放条件：①レベル60以上　②再度VIP特典の仕事をする'
    expect(normalizeTranslateQuery(raw1)).toBe('解放条件：①レベル60以上 ②再度VIP特典の仕事をする')
    expect(normalizeTranslateQuery(raw2)).toBe('解放条件：①レベル60以上 ②再度VIP特典の仕事をする')
  })

  it('normalizes tabs and control chars like backspace', () => {
    const raw = '解放条件：①レベル60以上\t\t\b②再度VIP特典の仕事をする'
    expect(normalizeTranslateQuery(raw)).toBe('解放条件：①レベル60以上 ②再度VIP特典の仕事をする')
  })

  it('collapses multiple newlines to a single newline', () => {
    const raw1 = '第一行\n\n\n\n\n第二行'
    const raw2 = '第一行\n第二行'
    expect(normalizeTranslateQuery(raw1)).toBe('第一行\n第二行')
    expect(normalizeTranslateQuery(raw2)).toBe('第一行\n第二行')
  })

  it('trims spaces around newlines across multiple lines', () => {
    const raw = '  第一行     \n\n   \n   第二行    '
    expect(normalizeTranslateQuery(raw)).toBe('第一行\n第二行')
  })
})
