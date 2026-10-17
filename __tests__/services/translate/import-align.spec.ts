import { compactTranslateKey, normalizeTranslateKey } from '@/lib/translate/lookup'
import { lookupCachedTranslation } from '@/services/translate/cache-lookup'
import { prepareTranslationImport } from '@/services/translate/import-align'
import { isStorableTranslation } from '@/services/translate/text-classify'

it('keeps enumeration phrases intact during import', () => {
  const result = prepareTranslationImport({ '薬、武器、防具。': '药水、武器、护甲。' })
  expect(result.map['薬、武器、防具']).toBe('药水、武器、护甲')
  expect(result.map['薬']).toBeUndefined()
})

it('aligns imported fragments on a shared orphan closing quote without changing the original record', () => {
  const source = '品評会」開催当日'
  const original = { [source]: '品评会」举办当日' }
  const { map } = prepareTranslationImport(original)
  expect(map).toMatchObject({ ...original, 品評会: '品评会', 開催当日: '举办当日' })
  expect(lookupCachedTranslation((key) => map[key], '開催当日')).toBe('举办当日')
  expect(prepareTranslationImport({ [source]: '品评会举办当日' }).map['開催当日']).toBeUndefined()
})

it('derives matching numbered-prefix and punctuation aliases while retaining original records', () => {
  const original = { M06_サブイベ1: 'M06_支线事件1', M06_サブイベ2: 'M06_支线事件2', M06_サブイベ3: 'M06_支线事件3', '受付係の！マーク消去': '接待员！标记消除' }
  const { map } = prepareTranslationImport(original)
  expect(map).toMatchObject({ ...original, サブイベ1: '支线事件1', サブイベ2: '支线事件2', サブイベ3: '支线事件3', 受付係の: '接待员', マーク消去: '标记消除' })
  expect(lookupCachedTranslation((key) => map[key], '受付係の！')).toBeNull()
})

it('keeps explicit translations ahead of prefix and punctuation aliases and skips ambiguity', () => {
  const original = { M06_サブイベ1: 'M06_支线事件1', M07_サブイベ1: 'M07_支线任务1', '受付係の！マーク消去': '接待员！标记消除', '受付係の！案内開始': '前台！开始引导' }
  expect(prepareTranslationImport(original).map['サブイベ1']).toBeUndefined()
  expect(prepareTranslationImport(original).map['受付係の']).toBeUndefined()
  expect(prepareTranslationImport({ ...original, サブイベ1: '独立译文1', 受付係の: '专用译文' }).map).toMatchObject({ サブイベ1: '独立译文1', 受付係の: '专用译文' })
  expect(prepareTranslationImport({ M06_サブイベ1: 'M07_支线事件1' }).map['サブイベ1']).toBeUndefined()
})

it('retains a paragraph with shared Han words and derives its complete aligned third line', () => {
  const source = '「ほう、よくわかったな。\n　お前の想像通り、これは催眠魔法でな。\n　いつからだったか……、おいマキ、覚えてるか？」'
  const target = '「嚯，挺敏锐嘛。\n正如你所想，这是催眠魔法。\n从什么时候开始来着......喂真纪，还记得吗？」'
  const result = prepareTranslationImport({ [source]: target })
  expect(isStorableTranslation(source, result.map[source])).toBe(true)
  expect(result.map['お前の想像通り、これは催眠魔法でな']).toBe('正如你所想，这是催眠魔法')
  expect(result.map['いつからだったか……、おいマキ、覚えてるか']).toBe('从什么时候开始来着......喂真纪，还记得吗')
  expect(result.map['おいマキ']).toBeUndefined()
})

it('caches bare bodies from separately imported dialogue lines with unmatched quotes', () => {
  const result = prepareTranslationImport({
    '「セリカ様、': '「赛莉卡大人，',
    'カウンター内は従業員以外立ち入り禁止ですよ」': '柜台后方禁止非工作人员进入哦」',
  })
  expect(result.map['セリカ様']).toBe('赛莉卡大人')
  expect(result.map['カウンター内は従業員以外立ち入り禁止ですよ']).toBe('柜台后方禁止非工作人员进入哦')
  const source = '「セリカ様、\nカウンター内は従業員以外立ち入り禁止ですよ」'
  expect(lookupCachedTranslation((key) => result.map[key], source)).toBe('「赛莉卡大人、\n柜台后方禁止非工作人员进入哦」')
})

it('retains full paragraphs and derives aligned segments and wrapper-free keys', () => {
  const source = 'こんにちは，村へ行こう。'
  const result = prepareTranslationImport({ [source]: '你好，去村子吧。', '「村へ戻ろう」': '「回村子吧」' })
  expect(result.map).toMatchObject({ [source]: '你好，去村子吧。', こんにちは: '你好', 村へ行こう: '去村子吧', 村へ戻ろう: '回村子吧' })
})

it('aligns matching visual lines despite comma changes and normalizes indentation', () => {
  const result = prepareTranslationImport({ '「こんにちは。\n　村へ行こう，今すぐに。」': '「你好。\n去村子吧，现在就去。」', '行きましょう」': '走吧」' })
  expect(result.map).toMatchObject({ こんにちは: '你好', 村へ行こう: '去村子吧', 今すぐに: '现在就去', 行きましょう: '走吧' })
  expect(compactTranslateKey('こんにちは。\n　村へ行こう')).toBe(compactTranslateKey('こんにちは。\n村へ行こう'))
  expect(normalizeTranslateKey('Hello\nworld')).toBe('Hello\nworld')
  expect(normalizeTranslateKey(String.raw`\name[1]は勇者`)).toBe(String.raw`\name[1]は勇者`)
  expect(normalizeTranslateKey(String.raw`\n[1]は勇者`)).toBe(String.raw`\n[1]は勇者`)
})

it('keeps unmatched paragraphs intact without guessing phrase correspondence', () => {
  const source = '彼は言った，行こう。'
  const result = prepareTranslationImport({ [source]: '他说走吧。' })
  expect(result.map[source]).toBe('他说走吧。')
  expect(result.map['彼は言った']).toBeUndefined()
  expect(result.map['行こう']).toBeUndefined()
  expect(result.unaligned).toBe(1)
})

it('aligns complete sentences first when a different sentence merged its comma clauses', () => {
  const result = prepareTranslationImport({ '彼は言った，行こう。こんにちは，村へ行こう。': '他说走吧。你好，去村子吧。' })
  expect(result.map['こんにちは']).toBe('你好')
  expect(result.map['村へ行こう']).toBe('去村子吧')
  expect(result.map['彼は言った']).toBeUndefined()
})

it('prefers standalone aliases, preserves explicit entries and rejects conflicting inferred translations', () => {
  const result = prepareTranslationImport({
    'こんにちは，村へ行こう。': '你好，去村子吧。',
    'こんにちは，休みましょう。': '您好，休息吧。',
    '「村へ行こう」': '「前往村庄」',
    休みましょう: '歇一会吧',
  })
  expect(result.map['こんにちは']).toBeUndefined()
  expect(result.map['村へ行こう']).toBe('前往村庄')
  expect(result.map['休みましょう']).toBe('歇一会吧')
  expect(result.conflicts).toBeGreaterThan(0)
})

it('reuses valid fragments of a partial translation without admitting the incomplete fragment', () => {
  const result = prepareTranslationImport({ こんにちは: 'こんにちは', 'こんにちは，村へ行こう。': '你好，村へ行こう。' })
  expect(result.map['こんにちは']).toBe('你好')
  expect(result.map['村へ行こう']).toBeUndefined()
  expect(isStorableTranslation('こんにちは，村へ行こう。', result.map['こんにちは，村へ行こう。'])).toBe(false)
})

it('does not split dynamic templates or derive aliases with missing/reordered control tokens', () => {
  const dynamic = String.raw`_actorは「\I[_icon]_name」を\C[14]_num個得た！`
  const target = String.raw`_actor获得「\I[_icon]_name」\C[14]_num个！`
  const result = prepareTranslationImport({ [dynamic]: target, [String.raw`こんにちは\V[1]，行こう。`]: '你好，出发吧。' })
  expect(result.map[dynamic]).toBe(target)
  expect(result.map[String.raw`こんにちは\V[1]`]).toBeUndefined()
})

it('splits ruby flanks and both readings without deriving aliases when the ruby shape differs', () => {
  const source = String.raw`見染められてそのまま\RB[結婚,ゴールイン]……、\nなんてことがあるかもしれません`
  const target = String.raw`就这样被看中\RB[结婚,进球]……、\n也许会有这种事`
  const result = prepareTranslationImport({ [source]: target, なんてことがあるかもしれません: '也许会有这种事' })
  expect(result.map['見染められてそのまま']).toBe('就这样被看中')
  expect(result.map['結婚']).toBe('结婚')
  expect(result.map['ゴールイン']).toBe('进球')
  expect(result.map['なんてことがあるかもしれません']).toBe('也许会有这种事')
  const combined = String.raw`見染められてそのまま\RB[結婚,ゴールイン]。\nなんてことがあるかもしれません`
  expect(lookupCachedTranslation((key) => result.map[key], combined)).toBe(String.raw`就这样被看中\RB[结婚,进球]。\n也许会有这种事`)
  expect(prepareTranslationImport({ [String.raw`\RB[結婚,ゴールイン]です`]: '结婚了。' }).map['結婚']).toBeUndefined()
})

it('lets cached body fragments cover newly extracted segments after import', () => {
  const result = prepareTranslationImport({ 'こんにちは，村へ行こう。': '你好，去村子吧。' })
  expect(lookupCachedTranslation((key) => result.map[key], '「村へ行こう！」')).toBeNull()
})
