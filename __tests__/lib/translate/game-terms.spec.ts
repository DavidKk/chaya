import { buildTranslationExport } from '@/lib/translate/export'
import { type GameTermLanguage, lookupGameTerm } from '@/lib/translate/game-terms'
import { translateWithLookup } from '@/lib/translate/lookup'
import { lookupGameTranslation } from '@/services/translate/cache-lookup'

it.each<[string, GameTermLanguage, string]>([
  ['剣', 'zh', '剑'],
  ['剣', 'en', 'Sword'],
  ['剣', 'ko', '검'],
  ['剑', 'en', 'Sword'],
  ['Sword', 'ko', '검'],
  ['검', 'zh', '剑'],
  ['검', 'ja', '剣'],
  ['銃', 'en', 'Gun'],
  ['槍', 'en', 'Spear'],
  ['枪', 'ko', '총'],
  ['长枪', 'ko', '창'],
  ['炎', 'en', 'Flame'],
  ['Fire', 'ko', '화염'],
])('translates the standalone label %s into %s as %s', (source, target, expected) => {
  expect(lookupGameTerm(source, target)).toBe(expected)
})

it('supports explicit source languages and preserves formatting around translations', () => {
  expect(lookupGameTerm('「검！」', 'en', 'ko')).toBe('「Sword！」')
  expect(lookupGameTerm(String.raw`\C[2]sword\C[0]`, 'ko', 'en')).toBe(String.raw`\C[2]검\C[0]`)
  expect(lookupGameTerm('Sword', 'ko', 'ja')).toBeNull()
})

it('keeps untranslated multiword text and unknown or ambiguous labels out of the table', () => {
  for (const source of ['Sword Master', '검을 장비한다', '女儿', '湯', '娘', '床', 'toString']) expect(lookupGameTerm(source, 'en')).toBeNull()
  expect(lookupGameTerm('Sword', 'fr' as GameTermLanguage)).toBeNull()
})

it('keeps Simplified Chinese defaults while recognizing English and Korean source labels', () => {
  expect(translateWithLookup({}, 'Sword')).toBe('剑')
  expect(translateWithLookup({}, '검')).toBe('剑')
  expect(buildTranslationExport({ Sword: '', 검: '' }, () => null)).toEqual({ Sword: '剑', 검: '剑' })
  expect(
    lookupGameTranslation(
      () => null,
      () => null,
      '검'
    )
  ).toMatchObject({ zh: '剑' })
  expect(
    lookupGameTranslation(
      () => '宝剑',
      () => '长剑',
      'Sword'
    )
  ).toMatchObject({ zh: '宝剑' })
  expect(
    lookupGameTranslation(
      () => null,
      () => '长剑',
      'Sword'
    )
  ).toMatchObject({ zh: '长剑' })
})
