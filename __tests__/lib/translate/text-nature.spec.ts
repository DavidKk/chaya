import { categoriesForNature, natureOfCategory, parseTextNature } from '@/lib/translate/text-nature'

it('maps extract categories to coarse natures', () => {
  expect(natureOfCategory('item')).toBe('name')
  expect(natureOfCategory('dialogue')).toBe('dialogue')
  expect(natureOfCategory('item_desc')).toBe('desc')
  expect(natureOfCategory(undefined)).toBe('')
  expect(categoriesForNature('name')).toContain('actor')
  expect(parseTextNature('name')).toBe('name')
  expect(parseTextNature('nope')).toBe('')
})
