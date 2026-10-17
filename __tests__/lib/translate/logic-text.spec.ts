import { buildLogicText, inferNewlineKind, mapLogicRangeToOriginal, usesSpacedSoftBreaks } from '@/lib/translate/logic-text'
import { planSentenceTranslation, type SentenceRecord } from '@/lib/translate/sentence-plan'
import { sentenceUnits } from '@/lib/translate/sentence-units'

const record = (src: string, zh: string, extra: Partial<SentenceRecord> = {}): SentenceRecord => ({
  id: src,
  revision: 1,
  src,
  zh,
  ...extra,
})

describe('logic text soft breaks', () => {
  it('joins Japanese soft breaks without inserting spaces and maps offsets back', () => {
    const original = '好きじゃ\n　ないんスよ'
    const nl = original.indexOf('\n')
    const view = buildLogicText(original, {
      srcLang: 'ja',
      newlines: [{ start: nl, end: nl + 1, kind: 'soft' }],
    })
    expect(view.logic).toBe('好きじゃないんスよ')
    expect(view.logic.includes('\n')).toBe(false)
    expect(view.logic.includes('　')).toBe(false)

    const span = mapLogicRangeToOriginal(view, 0, view.logic.length)
    expect(original.slice(span.start, span.end)).toBe(original)
    expect(span.start).toBe(0)
    expect(span.end).toBe(original.length)
  })

  it('inserts a space between English word characters on soft break', () => {
    const original = 'word\nword'
    const view = buildLogicText(original, {
      srcLang: 'en',
      newlines: [{ start: 4, end: 5, kind: 'soft' }],
    })
    expect(view.logic).toBe('word word')
    expect(view.logicToOriginal.filter((i) => i < 0)).toEqual([-1])
  })

  it('does not glue Hel\\nlo into Hello under English soft policy', () => {
    const original = 'Hel\nlo'
    const view = buildLogicText(original, {
      srcLang: 'en',
      newlines: [{ start: 3, end: 4, kind: 'soft' }],
    })
    expect(view.logic).toBe('Hel lo')
  })

  it('does not insert space when either side is punctuation', () => {
    const original = 'see.\nNext'
    const view = buildLogicText(original, {
      srcLang: 'en',
      newlines: [{ start: 4, end: 5, kind: 'soft' }],
    })
    expect(view.logic).toBe('see.Next')
  })

  it('infers mid-phrase wraps as soft and joins them without an annotation', () => {
    const original = '好きじゃ\nない'
    expect(inferNewlineKind(original, original.indexOf('\n'), original.indexOf('\n') + 1)).toBe('soft')
    expect(buildLogicText(original, { srcLang: 'ja' }).logic).toBe('好きじゃない')
  })

  it('infers hard after sentence-end punctuation', () => {
    const original = '終わり。\n次へ'
    expect(inferNewlineKind(original, original.indexOf('\n'), original.indexOf('\n') + 1)).toBe('hard')
    expect(buildLogicText(original, { srcLang: 'ja' }).logic).toBe(original)
  })

  it('keeps explicit unknown over soft inference', () => {
    const original = '好きじゃ\nない'
    const nl = original.indexOf('\n')
    expect(buildLogicText(original, { srcLang: 'ja', newlines: [{ start: nl, end: nl + 1, kind: 'unknown' }] }).logic).toBe(original)
  })

  it('treats unknown language as spaced for soft breaks', () => {
    expect(usesSpacedSoftBreaks('', 'Hello')).toBe(true)
    expect(usesSpacedSoftBreaks('ja', '好き')).toBe(false)
  })
})

describe('soft-annotated sentence matching', () => {
  it('matches a soft-wrapped query to a continuous cache entry', () => {
    const wrapped = '好きじゃ\n　ないんスよ'
    const continuous = '好きじゃないんスよ'
    const nl = wrapped.indexOf('\n')
    const newlines = [{ start: nl, end: nl + 1, kind: 'soft' as const }]
    expect(sentenceUnits(wrapped, { newlines, srcLang: 'ja' })[0]?.key).toBe(sentenceUnits(continuous, { srcLang: 'ja' })[0]?.key)
    const plan = planSentenceTranslation(wrapped, [record(continuous, '其实不太喜欢啊')], { newlines, srcLang: 'ja' })
    expect(plan.zh).toBe('其实不太喜欢啊')
    expect(plan.matches[0]?.start).toBe(0)
    expect(plan.matches[0]?.end).toBe(wrapped.length)
  })

  it('matches when the cache row carries the soft annotation', () => {
    const wrapped = '好きじゃ\n　ないんスよ'
    const nl = wrapped.indexOf('\n')
    const newlines = [{ start: nl, end: nl + 1, kind: 'soft' as const }]
    const plan = planSentenceTranslation('好きじゃないんスよ', [record(wrapped, '其实不太喜欢啊', { newlines })], { srcLang: 'ja' })
    expect(plan.zh).toBe('其实不太喜欢啊')
  })
})
