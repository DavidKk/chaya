import { createCoverageLookup } from '@/lib/translate/coverage-lookup'
import { lookupTranslationRecord } from '@/lib/translate/lookup'
import { lookupCachedTranslation } from '@/services/translate/cache-lookup'

it('matches an entire cached body across punctuation and line-break differences', () => {
  const lookup = createCoverageLookup([['こんにちは，村へ行こう。休もう。', '你好，去村子吧。休息吧。']])
  expect(lookup('「こんにちは\n村へ行こう！休もう？」')).toBe('「你好，去村子吧。休息吧？」')
  expect(lookup('村へ行こう')).toBeNull()
  expect(lookup('こんにちは知らない村へ行こう休もう')).toBeNull()
})

it.each(['、\n', String.raw`。\n`, ''])('assembles complete cached fragments while restoring the query separator %j', (separator) => {
  const lookup = createCoverageLookup([
    ['こんにちは。', '你好。'],
    ['村へ行こう！', '去村子吧！'],
    ['休もう。', '休息吧。'],
  ])
  expect(lookup(`「こんにちは${separator}村へ行こう${separator}休もう！」`)).toBe(`「你好${separator}去村子吧${separator}休息吧！」`)
})

it('requires complete coverage with no missing text or reordered fragments', () => {
  const lookup = createCoverageLookup([
    ['こんにちは', '你好'],
    ['村へ行こう', '去村子吧'],
  ])
  expect(lookup('こんにちはまだ知らない村へ行こう')).toBeNull()
  expect(lookup('こんにちは村へ行こう未登録')).toBeNull()
  expect(lookup('未登録こんにちは村へ行こう')).toBeNull()
})

it('rejects ambiguous partitions instead of choosing the longest match', () => {
  const lookup = createCoverageLookup([
    ['あいうえ', '第一段'],
    ['おか', '第二段'],
    ['あい', '另一段'],
    ['うえおか', '另一结尾'],
  ])
  expect(lookup('あいうえおか')).toBeNull()
})

it('rejects conflicting punctuation-insensitive whole records', () => {
  const lookup = createCoverageLookup([
    ['こんにちは，村へ行こう', '你好，去村子吧'],
    ['こんにちは！村へ行こう', '您好，前往村庄'],
  ])
  expect(lookup('こんにちは\n村へ行こう')).toBeNull()
})

it('keeps exact whole translations ahead of fragments', () => {
  const cache = { 'こんにちは，村へ行こう': '完整译文', こんにちは: '你好', 村へ行こう: '去村子吧' }
  expect(lookupCachedTranslation((key) => lookupTranslationRecord(cache, key), 'こんにちは，村へ行こう')).toBe('完整译文')
})

it('preserves protected variables and refuses missing or reordered variables', () => {
  const lookup = createCoverageLookup([[String.raw`こんにちは\V[1]，村へ行こう`, String.raw`你好\V[1]，去村子吧`]])
  expect(lookup(String.raw`こんにちは\V[1]！村へ行こう`)).toBe(String.raw`你好\V[1]，去村子吧`)
  expect(lookup('こんにちは村へ行こう')).toBeNull()
  expect(createCoverageLookup([[String.raw`こんにちは\V[1]`, '你好']])('こんにちは')).toBeNull()
  expect(createCoverageLookup([['_actorは_nameを得た！', '_actor获得_name！']])('_actorは、_nameを得た')).toBeNull()
})

it('does not merge ASCII words, identifiers, decimal numbers or incomplete lexical matches', () => {
  const lookup = createCoverageLookup([
    ['cat', '猫'],
    ['nap', '小睡'],
    ['re-sign', '重新签署'],
    ['M06_name', '编号名称'],
    ['価格1.2', '价格一点二'],
  ])
  expect(lookup('catnap')).toBeNull()
  expect(lookup('resign')).toBeNull()
  expect(lookup('M06name')).toBeNull()
  expect(lookup('価格12')).toBeNull()
})

it('reuses ruby pieces learned from a whole cached line', () => {
  const cache = { [String.raw`見染められてそのまま\RB[結婚,ゴールイン]。`]: String.raw`就这样被看中\RB[结婚,进球]。` }
  expect(lookupTranslationRecord(cache, '結婚')).toBe('结婚')
  expect(lookupTranslationRecord(cache, 'ゴールイン')).toBe('进球')
  expect(lookupCachedTranslation((key) => lookupTranslationRecord(cache, key), String.raw`見染められてそのまま\RB[結婚,ゴールイン]！`)).toBe(
    String.raw`就这样被看中\RB[结婚,进球]！`
  )
})

it('treats ruby arguments as text and keeps the wrapper when reassembling', () => {
  const lookup = createCoverageLookup([
    [String.raw`ここは\RB[認定,オーソライズ]です。`, String.raw`这里是\RB[认证,授权]哦。`],
    [String.raw`\RB[認定,オーソライズ]`, String.raw`\RB[认证,授权]`],
    ['です', '哦'],
  ])
  expect(lookup(String.raw`ここは\RB[認定,オーソライズ]です！`)).toBe(String.raw`这里是\RB[认证,授权]哦！`)
  expect(lookup(String.raw`\RB[認定,オーソライズ]です`)).toBe(String.raw`\RB[认证,授权]哦`)
  expect(lookup('認定')).toBeNull()
  expect(createCoverageLookup([[String.raw`\RB[認定,オーソライズ]`, '认证']])(String.raw`\RB[認定,オーソライズ]`)).toBeNull()
})

it('retains the guard against translated choice scripts', () => {
  expect(createCoverageLookup([['こんにちはif(s[1])', '你好如果(s[1])']])('こんにちは')).toBeNull()
})
