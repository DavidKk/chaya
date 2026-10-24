import { entriesFromNamePairs, expandNameVariants, findNameSpans, isUsableNamePair, nameGaps, stitchNameLocks } from '@/lib/translate/name-glossary'

describe('name-glossary', () => {
  it('expands Latin possessives for zh only', () => {
    expect(expandNameVariants({ src: 'Rei', zh: '蕾' }).map((e) => [e.src, e.zh])).toEqual([
      ['Rei', '蕾'],
      ["Rei's", '蕾的'],
      ['Rei\u2019s', '蕾的'],
    ])
    expect(expandNameVariants({ src: 'Rei', zh: '蕾' }, 'en')).toEqual([{ src: 'Rei', zh: '蕾' }])
    expect(expandNameVariants({ src: '蕾', zh: 'Rei' })).toEqual([{ src: '蕾', zh: 'Rei' }])
    expect(expandNameVariants({ src: 'Rei', zh: '蕾的' }).some((e) => e.zh === '蕾的的')).toBe(false)
  })

  it('rejects empty, identical, or single-letter names', () => {
    expect(isUsableNamePair('R', '丽')).toBe(false)
    expect(isUsableNamePair('Rei', 'Rei')).toBe(false)
    expect(isUsableNamePair('Rei', '')).toBe(false)
  })

  it("locks Rei / Rei's with Latin word boundaries and skips Reign", () => {
    const entries = entriesFromNamePairs([{ src: 'Rei', zh: '蕾' }])
    expect(findNameSpans("Rei's mother.", entries).map((s) => [s.start, s.end, s.zh])).toEqual([[0, 5, '蕾的']])
    expect(findNameSpans('Reign of Rei', entries).map((s) => [s.start, s.end, s.src])).toEqual([[9, 12, 'Rei']])
    expect(findNameSpans('Reign', entries)).toEqual([])
    expect(findNameSpans('preRei', entries)).toEqual([])
  })

  it('uses longest CJK match and skips control-code interiors', () => {
    const entries = entriesFromNamePairs([
      { src: '武士', zh: 'Warrior' },
      { src: '武', zh: 'Wu' },
    ])
    expect(findNameSpans('武士出现了', entries).map((s) => s.src)).toEqual(['武士'])
    expect(findNameSpans('\\N[1]武士', entries).map((s) => s.src)).toEqual(['武士'])
    expect(findNameSpans('\\N[Rei]', [{ src: 'Rei', zh: '蕾' }])).toEqual([])
  })

  it('stitches locked names and preserves gap whitespace', () => {
    const src = "Rei's mother."
    const spans = findNameSpans(src, [{ src: 'Rei', zh: '蕾' }])
    const gaps = nameGaps(src, spans)
    expect(gaps).toEqual([{ id: '5:13', start: 5, end: 13, text: ' mother.' }])
    expect(stitchNameLocks(src, spans, new Map([['5:13', '母亲']]))).toBe('蕾的母亲')
  })
})
