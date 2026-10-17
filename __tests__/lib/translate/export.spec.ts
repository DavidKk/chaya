import { buildTranslationExport, filterTranslationExport } from '@/lib/translate/export'
import { lookupTranslationRecord, translateWithLookup } from '@/lib/translate/lookup'
import { translationExportText, translationOriginalSources } from '@/lib/translate/segments'
import { lookupCachedTranslation } from '@/services/translate/cache-lookup'
import { parseTranslateImportText } from '@/services/translate/import-text'

it('fills translations from the current lookup and retains existing values on a miss', () => {
  const seed = { こんにちは: '', さようなら: '再见', 待って: '' }
  const entries = buildTranslationExport(seed, (source) => (source === 'こんにちは' ? '你好' : null))
  expect(filterTranslationExport(entries, 'all')).toEqual({ こんにちは: '你好', さようなら: '再见', 待って: '' })
  expect(filterTranslationExport(entries, 'untranslated')).toEqual({ 待って: '' })
  expect(seed.こんにちは).toBe('')
})

it('fills empty paragraph variants from saved translations without replacing source indentation', () => {
  const source = '「ほう、よくわかったな。\n　お前の想像通り、これは催眠魔法でな。\n　いつからだったか……、おいマキ、覚えてるか？」'
  const target = '「嚯，挺敏锐嘛。\n正如你所想，这是催眠魔法。\n从什么时候开始来着......喂真纪，还记得吗？」'
  const query = source.replace(/\u3000/g, '')
  expect(buildTranslationExport({ [source]: target, [query]: '' }, () => null)).toEqual({ [source]: target, [query]: '' })
})

it('uses the latest translation and filters strictly empty values', () => {
  const entries = buildTranslationExport({ こんにちは: '旧译文', 待って: '' }, () => '最新译文')
  expect(entries).toEqual({ こんにちは: '最新译文', 待って: '最新译文' })
  expect(filterTranslationExport(entries, 'untranslated')).toEqual({})
  expect(filterTranslationExport({ 空值: '', 空格: ' ', 有值: '译文' }, 'untranslated')).toEqual({ 空值: '' })
})

it('fills prefix and punctuation variants without changing exported source keys', () => {
  const lookup = { M06_サブイベ1: 'M06_支线事件1', '受付係の！マーク消去': '接待员！标记消除' }
  const entries = buildTranslationExport({ サブイベ1: '', '受付係の！': '' }, (src) => lookupCachedTranslation((key) => lookupTranslationRecord(lookup, key), src))
  expect(entries).toEqual({ サブイベ1: '支线事件1', '受付係の！': '' })
  expect(lookup).toEqual({ M06_サブイベ1: 'M06_支线事件1', '受付係の！マーク消去': '接待员！标记消除' })
})

it('does not export unverified boundary or tone variants as complete translations', () => {
  const lookup = { 'こんにちは，村へ行こう。': '你好，去村子吧。', 休もう: '休息吧', 準備を確認する: '确认准备情况' }
  const entries = { '「こんにちは\n村へ行こう！」': '', '「休もう、\n準備を確認する！」': '' }
  expect(buildTranslationExport(entries, (src) => lookupCachedTranslation((key) => lookupTranslationRecord(lookup, key), src))).toEqual({
    '「こんにちは\n村へ行こう！」': '',
    '「休もう、\n準備を確認する！」': '',
  })
})

it('exports explicit unchanged labels as translated values rather than empty entries', () => {
  const labels = { 第1部: '第1部', 第2部: '第2部', 第3部: '第3部' }
  const entries = buildTranslationExport({ 第1部: '', 第2部: '', 第3部: '' }, (source) => lookupCachedTranslation((key) => labels[key as keyof typeof labels], source))
  expect(entries).toEqual(labels)
  expect(filterTranslationExport(entries, 'untranslated')).toEqual({})
})

it('exports original punctuation and wrappers while reusing one cache body across variants', () => {
  const originals = ['「こんにちは。」', '【こんにちは】', 'こんにちは！', String.raw`\C[1]こんにちは。`, '待って？']
  const seed = { こんにちは: '', 待って: '' }
  const cache: Record<string, string> = { こんにちは: '你好', 'こんにちは。': '你好。', 'こんにちは！': '你好！' }
  const entries = buildTranslationExport(seed, (source) => lookupCachedTranslation((key) => cache[key], source), originals)
  expect(entries).toEqual({
    '「こんにちは。」': '「你好。」',
    '【こんにちは】': '【你好】',
    'こんにちは！': '你好！',
    'こんにちは。': '你好。',
    '待って？': '',
  })
  expect(filterTranslationExport(entries, 'untranslated')).toEqual({ '待って？': '' })
  const imported = parseTranslateImportText(JSON.stringify(entries)).map
  expect(lookupCachedTranslation((key) => imported[key], '「こんにちは。」')).toBe('「你好。」')
  expect(lookupCachedTranslation((key) => imported[key], String.raw`\C[1]こんにちは。`)).toBe(String.raw`\C[1]你好。`)
})

it('uses saved seed bodies on lookup misses and leaves untranslated originals empty', () => {
  expect(buildTranslationExport({ 地下室へ: '前往地下室', 待って: '' }, () => null, ['《地下室へ》。', '「待って。」'])).toEqual({
    '《地下室へ》。': '《前往地下室》。',
    '「待って。」': '',
  })
  const source = String.raw`\n<ギルドメンバー>「こっちは男子棟だよ。」`
  expect(translationOriginalSources(source)).toEqual(['<ギルドメンバー>', '「こっちは男子棟だよ。」'])
  expect(translationOriginalSources('「行く！」if(s[1])en(true)')).toEqual(['「行く！」'])
})

it('removes only boundary display codes from exported keys and translated values', () => {
  const originals = [String.raw`\n\b「こんにちは。」\b`, '「こんにちは。」', String.raw`「\b待って？\b」`, String.raw`\N[1]は\V[2]個を持っている。`]
  const entries = buildTranslationExport({}, (source) => (source.startsWith(String.raw`\n\b`) ? String.raw`\n\b「你好。」\b` : null), originals)
  expect(entries).toEqual({ '「こんにちは。」': '「你好。」', '「待って？」': '', [String.raw`\N[1]は\V[2]個を持っている。`]: '' })
  for (const source of [String.raw`\n\b「こんにちは。」\b`, String.raw`「\bこんにちは。\b」`]) {
    expect(lookupCachedTranslation((key) => entries[key], source)).toBe(source.replace('こんにちは', '你好'))
    expect(translateWithLookup(entries, source)).toBe(source.replace('こんにちは', '你好'))
  }
  expect(translationOriginalSources(String.raw`\n\b【地下室へ】`)).toEqual(['【地下室へ】'])
  expect(translationOriginalSources(String.raw`こんにちは\C[2]世界。`)).toEqual([String.raw`こんにちは\C[2]世界。`])
})

it('preserves inline line breaks and formatting in both export keys and values', () => {
  const source = String.raw`\n\b「こんにちは\n世界。\b」\n`
  const translated = String.raw`\n\b「你好\n世界。\b」\n`
  expect(translationExportText(source)).toBe(String.raw`「こんにちは\n世界。」`)
  expect(buildTranslationExport({}, () => translated, [source])).toEqual({
    [String.raw`「こんにちは\n世界。」`]: String.raw`「你好\n世界。」`,
  })
  expect(translationExportText(String.raw`こんにちは\b世界\C[2]です。`)).toBe(String.raw`こんにちは\b世界\C[2]です。`)
  expect(translationExportText('「こんにちは\n世界。」')).toBe('「こんにちは\n世界。」')
})
