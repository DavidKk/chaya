/**
 * @jest-environment jsdom
 */
import { itemLabel, tName } from '@/plugins/src/cheat/console/item-label'

describe('tName', () => {
  afterEach(() => {
    delete (window as Window & { ChayaTrans?: unknown }).ChayaTrans
    delete (window as Window & { _chayaTranslate?: unknown })._chayaTranslate
  })

  it('returns empty string for falsy input', () => {
    expect(tName('')).toBe('')
    expect(tName(null)).toBe('')
    expect(tName(undefined)).toBe('')
  })

  it('stringifies as-is when no translator is present', () => {
    expect(tName('剣')).toBe('剣')
    expect(tName(12)).toBe('12')
  })

  it('returns the original when translation equals the source', () => {
    window.ChayaTrans = { translate: (s: string) => s }
    expect(tName('剣')).toBe('剣')
  })

  it('prefers ChayaTrans over _chayaTranslate', () => {
    window._chayaTranslate = (s: string) => `old:${s}`
    expect(tName('a')).toBe('old:a')
    window.ChayaTrans = { translate: (s: string) => `new:${s}` }
    expect(tName('a')).toBe('new:a')
  })
})

describe('itemLabel', () => {
  afterEach(() => {
    delete (window as Window & { ChayaTrans?: unknown }).ChayaTrans
  })

  it('null/undefined → empty label', () => {
    expect(itemLabel(null)).toEqual({ name: '', zh: '' })
    expect(itemLabel(undefined)).toEqual({ name: '', zh: '' })
  })

  it('with name: zh is filled only when different', () => {
    window.ChayaTrans = { translate: (s: string) => (s === '薬' ? 'Potion' : s) }
    expect(itemLabel({ name: '薬' })).toEqual({ name: '薬', zh: 'Potion' })
    expect(itemLabel({ name: 'Potion' })).toEqual({ name: 'Potion', zh: '' })
  })

  it('empty name: strips control codes, takes first description line, truncates to 48', () => {
    window.ChayaTrans = { translate: (s: string) => `ZH:${s}` }
    const long = 'あ'.repeat(60)
    expect(itemLabel({ id: 3, name: '', description: `\\C[2]${long}\\n第二行` })).toEqual({
      name: 'あ'.repeat(48),
      zh: `ZH:${'あ'.repeat(48)}`,
    })
  })

  it('no name and no description → #id', () => {
    expect(itemLabel({ id: 7, name: '', description: '' })).toEqual({ name: '#7', zh: '' })
    expect(itemLabel({ id: 7, description: '   ' })).toEqual({ name: '#7', zh: '' })
  })
})
