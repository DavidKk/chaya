import { buildTranslationExport, filterTranslationExport } from '@/lib/translate/export'
import { JAPANESE_GAME_TERMS, lookupJapaneseGameTerm } from '@/lib/translate/japanese-terms'
import { translateWithLookup } from '@/lib/translate/lookup'
import { lookupGameTranslation } from '@/services/translate/cache-lookup'

it.each(Object.entries(JAPANESE_GAME_TERMS))('provides the standalone game term %s as %s', (source, target) => {
  expect(lookupJapaneseGameTerm(source)).toBe(target)
  expect(translateWithLookup({}, source)).toBe(target)
})

it('preserves source keys and fills unchanged terms as nonempty exported translations', () => {
  const empty = Object.fromEntries(Object.keys(JAPANESE_GAME_TERMS).map((key) => [key, '']))
  const exported = buildTranslationExport(empty, () => null)
  expect(exported).toEqual(JAPANESE_GAME_TERMS)
  expect(filterTranslationExport(exported, 'untranslated')).toEqual({})
  expect(empty.炎).toBe('')
})

it('retains wrappers, whitespace and controls around a standalone term', () => {
  expect(lookupJapaneseGameTerm(' 「剣！」 ')).toBe(' 「剑！」 ')
  expect(lookupJapaneseGameTerm(String.raw`\C[2]槍\C[0]`)).toBe(String.raw`\C[2]长枪\C[0]`)
})

it('does not convert ambiguous characters or replace characters inside words', () => {
  for (const source of ['湯', '娘', '床', '走', '剣を装備する', '水属性', '槍兵', 'M06_剣', 'toString', '']) expect(lookupJapaneseGameTerm(source)).toBeNull()
})

it('prefers explicit local and shared translations over built-in defaults', () => {
  expect(
    lookupGameTranslation(
      () => '矛',
      () => '长矛',
      '槍'
    )
  ).toMatchObject({ zh: '矛', engine: 'cache:local' })
  expect(
    lookupGameTranslation(
      () => null,
      () => '长矛',
      '槍'
    )
  ).toMatchObject({ zh: '长矛', engine: 'cache:remote' })
  expect(
    lookupGameTranslation(
      () => null,
      () => null,
      '槍'
    )
  ).toMatchObject({ zh: '长枪' })
  expect(translateWithLookup({ 剣: '刀剑' }, '「剣！」')).toBe('「刀剑！」')
  expect(buildTranslationExport({ 槍: '矛' }, () => null)).toEqual({ 槍: '矛' })
})
