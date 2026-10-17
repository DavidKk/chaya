import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import {
  mapTranslationSegments,
  reconcileTranslationSeed,
  translationCacheLines,
  translationDisplayChunks,
  translationOriginalSources,
  translationSegments,
  translationSources,
} from '@/lib/translate/segments'
import { collectAllStrings } from '@/services/extract/lib/compare'
import { lookupCachedTranslation } from '@/services/translate/cache-lookup'

it('keeps ideographic enumeration commas inside a segment, but splits commas and full stops', () => {
  expect(translationSources('苹果、梨、葡萄，去商店。然后回家,吃饭。')).toEqual(['苹果、梨、葡萄', '去商店', '然后回家', '吃饭'])
  expect(translationSources('名前、説明、備考。')).toEqual(['名前、説明、備考'])
})

it('extracts both visible ruby fields while retaining the complete original dialogue', () => {
  const source = String.raw`「ここは\RB[認定,オーソライズ]です」`
  expect(translationSources(source)).toEqual([String.raw`ここは\RB[認定,オーソライズ]です`, 'ここは', '認定', 'オーソライズ', 'です'])
  expect(translationOriginalSources(source)).toEqual([source, '「ここは', '認定', 'オーソライズ', 'です」'])
  expect(translationSegments('品評会」開催当日')).toEqual(['品評会」開催当日'])
})

it('splits only display controls and preserves semantic variables and dynamic templates', () => {
  const source = String.raw`前\C[9]中央\FS[20]後\C[0]`
  const chunks = translationDisplayChunks(source)
  expect(chunks.filter((chunk) => !chunk.display).map((chunk) => chunk.text)).toEqual(['前', '中央', '後'])
  expect(chunks.map((chunk) => chunk.text).join('')).toBe(source)
  expect(translationDisplayChunks(String.raw`前\V[1]後\N[2]`)).toEqual([{ text: String.raw`前\V[1]後\N[2]`, display: false }])
  expect(translationDisplayChunks(String.raw`_actorは\C[4]_num個得た`)).toHaveLength(1)
  expect(translationDisplayChunks(String.raw`前\V[abc\C[9]]後`)).toHaveLength(1)
})

it('keeps dialogue whole for extraction and splits visual lines only for cache fallback', () => {
  const source = '「セリカ様、\nカウンター内は従業員以外立ち入り禁止ですよ」'
  expect(translationSources(source)).toEqual(['セリカ様、\nカウンター内は従業員以外立ち入り禁止ですよ'])
  expect(translationCacheLines(source).flatMap(translationSources)).toEqual(['セリカ様', 'カウンター内は従業員以外立ち入り禁止ですよ'])
  expect(translationCacheLines(source).join('')).toBe(source)
  expect(translationCacheLines(String.raw`「勇者\N[1]はここにいる」`)).toHaveLength(1)
  expect(translationCacheLines(String.raw`_actorは\n_nameを得た！`)).toHaveLength(1)
  expect(translationCacheLines('前\\V[a\nb]後')).toHaveLength(1)
})

it('peels repeated conditions at either edge while preserving their exact spelling and spaces', () => {
  const source = '  en(!s[671]) if(v[1] > 0) 様子を観察する en(true)  '
  const shell = peelChoiceMetaShell(source)
  expect(shell.core).toBe('様子を観察する')
  expect(shell.lead + shell.core + shell.trail).toBe(source)
  expect(translationSources(source)).toEqual(['様子を観察する'])
  expect(mapTranslationSegments(source, () => '暗中观察')).toBe(source.replace('様子を観察する', '暗中观察'))
  expect(translationOriginalSources(source)).toEqual(['様子を観察する'])
})

it('supports nested calls, quoted parentheses, controls outside metadata and malformed expressions', () => {
  const source = String.raw`\C[2]en(check("(", s[671]))「様子を観察する。」if(test(')'))\C[0]`
  expect(translationSources(source)).toEqual(['様子を観察する'])
  expect(translationOriginalSources(source)).toEqual(['「様子を観察する。」'])
  expect(mapTranslationSegments(source, () => '暗中观察')).toBe(source.replace('様子を観察する', '暗中观察'))
  expect(peelChoiceMetaShell('Open(true)')).toEqual({ lead: '', core: 'Open(true)', trail: '' })
  expect(peelChoiceMetaShell('en(!s[671]様子を観察する').core).toBe('en(!s[671]様子を観察する')
  expect(peelChoiceMetaShell('これはen(s[1])を読む').core).toBe('これはen(s[1])を読む')
})

it('keeps nested quotes and parentheses together across punctuation and display lines', () => {
  const text = '「こんにちは、\n待って（本当？）。」次は、村へ行こう。'
  expect(translationSegments(text)).toEqual(['「こんにちは、\n待って（本当？）。」', '次は、村へ行こう。'])
  expect(translationSegments('(こんにちは、\n元気？)では、行こう。')).toEqual(['(こんにちは、\n元気？)では、行こう。'])
})

it('preserves control codes, decimal numbers and consecutive punctuation', () => {
  expect(translationSegments(String.raw`\C[1]待って\.まだだ！もう、行こう！！`)).toEqual([String.raw`\C[1]待って\.まだだ！`, 'もう、行こう！！'])
  expect(translationSegments('価格は1,200.50です。')).toEqual(['価格は1,200.50です。'])
})

it('collects dialogue as semantic segments instead of visual lines', () => {
  const sources = collectAllStrings([{ kind: 'd', lines: ['「こんにちは、', '村へ行こう。」'], choices: ['行く', '待つ'] }], {})
  expect([...sources]).toEqual(['こんにちは、\n村へ行こう', '行く', '待つ'])
})

it('reconciles obsolete empty fragments without losing translations', () => {
  expect(reconcileTranslationSeed(['「こんにちは、\n村へ行こう。」'], { '「こんにちは、': '', '村へ行こう。」': '', 行く: '去' })).toEqual({
    seed: { 行く: '去', '「こんにちは、\n村へ行こう。」': '' },
    entries: { '「こんにちは、\n村へ行こう。」': '' },
    added: 1,
  })
})

it('reassembles translated segments with whitespace and requires complete cache coverage', () => {
  const src = 'こんにちは，\n村へ行こう。'
  const cache: Record<string, string> = { こんにちは: '你好', 村へ行こう: '去村子吧', '村へ行こう。': '去村子吧。' }
  expect(mapTranslationSegments(src, (part) => cache[part] || part)).toBe('你好，\n去村子吧。')
  expect(lookupCachedTranslation((key) => cache[key], src)).toBe('你好，\n去村子吧。')
  delete cache['村へ行こう']
  delete cache['村へ行こう。']
  expect(lookupCachedTranslation((key) => cache[key], src)).toBeNull()
})

it('uses separate unwrapped speaker and dialogue keys and restores the original shell', () => {
  const source = String.raw`\n<ギルドメンバー>「こっちは男子棟だよ」`
  const cache: Record<string, string> = { ギルドメンバー: '公会成员', こっちは男子棟だよ: '这边是男生宿舍哦' }
  expect(translationSources(source)).toEqual(['ギルドメンバー', 'こっちは男子棟だよ'])
  expect([...collectAllStrings([{ kind: 'd', lines: [source] }], {})]).toEqual(Object.keys(cache))
  expect(mapTranslationSegments(source, (key) => cache[key] || key)).toBe(String.raw`\n<公会成员>「这边是男生宿舍哦」`)
  expect(lookupCachedTranslation((key) => cache[key], source)).toBe(String.raw`\n<公会成员>「这边是男生宿舍哦」`)
})

it('reuses bare text across different wrappers and preserves choice scripts', () => {
  const cache: Record<string, string> = { ギルドメンバー: '公会成员', 行く: '去' }
  for (const source of ['<ギルドメンバー>', '「ギルドメンバー」', '（ギルドメンバー）。']) {
    expect(translationSources(source)).toEqual(['ギルドメンバー'])
    expect(lookupCachedTranslation((key) => cache[key], source)).toBe(source.replace('ギルドメンバー', '公会成员'))
  }
  const choice = '「行く」if(s[1])en(true)'
  expect(translationSources(choice)).toEqual(['行く'])
  expect(mapTranslationSegments(choice, (key) => cache[key] || key)).toBe('「去」if(s[1])en(true)')
})

it('unwraps additional decorative brackets while keeping adjacent contextual text together', () => {
  for (const source of ['【地下室へ】', '《地下室へ》', '[地下室へ]', '［地下室へ］', '{地下室へ}', '〈地下室へ〉', '“地下室へ”']) {
    expect(translationSources(source)).toEqual(['地下室へ'])
    expect(mapTranslationSegments(source, () => '前往地下室')).toBe(source.replace('地下室へ', '前往地下室'))
  }
  expect(translationSources('見る（初回推奨）')).toEqual(['見る（初回推奨）'])
  expect(translationSources('【注意】地下室へ戻れ')).toEqual(['【注意】地下室へ戻れ'])
  expect(translationSources('【注意】地下室へ【入口】')).toEqual(['【注意】地下室へ【入口】'])
  expect(translationSources('{actor}')).toEqual(['{actor}'])
  expect(translationSources('<br>')).toEqual(['<br>'])
  expect(translationSources(String.raw`\C[4]【地下室へ】`)).toEqual(['地下室へ'])
  expect(translationSources('【本当？まだ、行かない！】')).toEqual(['本当？まだ、行かない'])
})
