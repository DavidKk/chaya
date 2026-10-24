import { filterAndRankTranslationListItems, translationListMatchRank } from '@/lib/translate/list-search'
import type { ExtractedTranslationItem } from '@/services/extract/lib/extract-items'

function item(partial: Partial<ExtractedTranslationItem> & Pick<ExtractedTranslationItem, 'id' | 'src'>): ExtractedTranslationItem {
  return {
    zh: '',
    ...partial,
    meta: { category: 'other', label: '其他', ...partial.meta },
  }
}

it('ranks exact src above longer includes for the same query', () => {
  const save = item({ id: '1', src: 'Save' })
  const saveGame = item({ id: '2', src: 'Save the game?' })
  const dontSave = item({ id: '3', src: "Don't save" })
  const ranked = filterAndRankTranslationListItems([saveGame, dontSave, save], 'save')
  expect(ranked.map((entry) => entry.src)).toEqual(['Save', 'Save the game?', "Don't save"])
  expect(translationListMatchRank(save, 'save')).toBeLessThan(translationListMatchRank(saveGame, 'save')!)
  expect(translationListMatchRank(saveGame, 'save')).toBeLessThan(translationListMatchRank(dontSave, 'save')!)
})

it('prefers src matches over translation or file path matches', () => {
  const bySrc = item({ id: '1', src: 'Load', zh: '读取' })
  const byZh = item({ id: '2', src: 'Continue', zh: 'Load elsewhere' })
  const byFile = item({ id: '3', src: 'Other', zh: '', meta: { category: 'other', label: '其他', file: 'Scripts/LoadHelper' } })
  expect(filterAndRankTranslationListItems([byFile, byZh, bySrc], 'Load').map((entry) => entry.id)).toEqual(['1', '2', '3'])
})

it('keeps non-matching items out of ranked results', () => {
  expect(filterAndRankTranslationListItems([item({ id: '1', src: 'Save' })], 'Load')).toEqual([])
})
