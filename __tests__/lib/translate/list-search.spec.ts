import { filterAndRankTranslationListItems, filterTranslationListItems, translationListMatchRank } from '@/lib/translate/list-search'
import type { ExtractedTranslationItem } from '@/services/extract/lib/extract-items'

function item(partial: Partial<ExtractedTranslationItem> & Pick<ExtractedTranslationItem, 'id' | 'src'>): ExtractedTranslationItem {
  return {
    zh: '',
    ...partial,
    meta: { category: 'other', label: '其他', ...partial.meta },
  }
}

it('keeps terminal failures separate from pending items until the user saves a retry', () => {
  const pending = item({ id: '1', src: 'Pending' })
  const failed = item({ id: '2', src: 'Failed', translationFailure: { error: 'All engines failed' } })
  const saved = item({ id: '3', src: 'Saved', zh: '已保存', savedZh: '已保存' })
  const items = [pending, failed, saved]
  expect(filterTranslationListItems(items, { status: 'failed' })).toEqual([failed])
  expect(filterTranslationListItems(items, { status: 'untranslated' })).toEqual([pending])
  failed.zh = '重试预览'
  expect(filterTranslationListItems(items, { status: 'failed' })).toEqual([failed])
  failed.savedZh = failed.zh
  failed.translationFailure = undefined
  expect(filterTranslationListItems(items, { status: 'failed' })).toEqual([])
})

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

it('ranks exact word token match Rei above prefixes like Reika, Reiji, and Reinforcement', () => {
  const reiExact = item({ id: '1', src: 'Rei' })
  const reiSentence = item({ id: '2', src: "Rei: Let's go!" })
  const reiMidSentence = item({ id: '3', src: 'The legend of Rei continues.' })
  const reika = item({ id: '4', src: 'Reika' })
  const reiji = item({ id: '5', src: 'Reiji' })
  const reinforcement = item({ id: '6', src: 'Reinforcement arrived.' })
  const foreign = item({ id: '7', src: 'Foreign visitor.' })

  const list = [reinforcement, reika, foreign, reiMidSentence, reiji, reiSentence, reiExact]
  const ranked = filterAndRankTranslationListItems(list, 'Rei')

  expect(ranked.map((entry) => entry.id)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
})

it('handles Japanese Katakana word boundaries (レイ vs レイの剣 vs レイカ vs キレイ)', () => {
  const reiExact = item({ id: '1', src: 'レイ' })
  const reiSword = item({ id: '2', src: 'レイの剣' })
  const reika = item({ id: '3', src: 'レイカ' })
  const kirei = item({ id: '4', src: 'キレイ' })

  const list = [kirei, reika, reiSword, reiExact]
  const ranked = filterAndRankTranslationListItems(list, 'レイ')

  expect(ranked.map((entry) => entry.id)).toEqual(['1', '2', '3', '4'])
})

it('ranks Chinese token match above arbitrary substring inclusions', () => {
  const exactZh = item({ id: '1', src: 'Action', zh: '待确认' })
  const longZh = item({ id: '2', src: 'Other', zh: '这是需要确认的相关记录' })

  const ranked = filterAndRankTranslationListItems([longZh, exactZh], '确认')
  expect(ranked.map((entry) => entry.id)).toEqual(['1', '2'])
})

it('normalizes full-width and half-width characters (NFKC)', () => {
  const fullWidth = item({ id: '1', src: 'Ｒｅｉ' })
  const ranked = filterAndRankTranslationListItems([fullWidth], 'rei')
  expect(ranked.map((entry) => entry.id)).toEqual(['1'])
})

it('normalizes RPG Maker escape codes like \\C[1] in search targets', () => {
  const colored = item({ id: '1', src: '\\C[1]Rei\\C[0]' })
  const ranked = filterAndRankTranslationListItems([colored], 'Rei')
  expect(ranked.map((entry) => entry.id)).toEqual(['1'])
})

it('handles multi-word queries with word boundaries', () => {
  const atStart = item({ id: '1', src: 'Save game here' })
  const atBoundary = item({ id: '2', src: 'Please save game' })
  const insideWord = item({ id: '3', src: 'Auto-xsave game' })

  const ranked = filterAndRankTranslationListItems([insideWord, atBoundary, atStart], 'save game')
  expect(ranked.map((entry) => entry.id)).toEqual(['1', '2', '3'])
})

it('ranks sentences starting with Chinese search phrase ahead of middle occurrences', () => {
  const atStart = item({ id: '1', src: '待确认结论' })
  const atMiddle = item({ id: '2', src: '这里是关于待确认结论的详细说明' })

  const ranked = filterAndRankTranslationListItems([atMiddle, atStart], '待确认')
  expect(ranked.map((entry) => entry.id)).toEqual(['1', '2'])
})

it('ranks exact Russian words above prefixes and substrings', () => {
  const reiExact = item({ id: '1', src: 'Рей' })
  const reiSentence = item({ id: '2', src: 'Рей: Пойдём!' })
  const reiPhrase = item({ id: '3', src: 'Легендарный меч Рей' })
  const reika = item({ id: '4', src: 'Рейка' })
  const andrei = item({ id: '5', src: 'Андрей' })

  const list = [andrei, reika, reiPhrase, reiSentence, reiExact]
  const ranked = filterAndRankTranslationListItems(list, 'Рей')

  expect(ranked.map((entry) => entry.id)).toEqual(['1', '2', '3', '4', '5'])
})

it('ranks exact Korean words above prefixes and substrings', () => {
  const reiExact = item({ id: '1', src: '레이' })
  const reiSentence = item({ id: '2', src: '레이: 출발하자!' })
  const reiSword = item({ id: '3', src: '레이의 검' })
  const reika = item({ id: '4', src: '레이카' })
  const gray = item({ id: '5', src: '그레이' })

  const list = [gray, reika, reiSword, reiSentence, reiExact]
  const ranked = filterAndRankTranslationListItems(list, '레이')

  // '레이' matches exact token in '레이' (id 1) and particle-stemmed token in '레이의 검' (id 3) / start sentence (id 2)
  expect(ranked.map((entry) => entry.id)).toEqual(['1', '3', '2', '4', '5'])
})
