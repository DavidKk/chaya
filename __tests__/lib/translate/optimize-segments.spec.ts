import {
  buildOptimizeSegmentPairs,
  canOptimizeTranslation,
  extractJsConcatLiterals,
  hasOptimizeCandidates,
  optimizeSplitSegments,
  peelOptimizeShell,
  stripOptimizeEdgeJunk,
} from '@/lib/translate/optimize-segments'

const DIALOGUE_SRC = `「あん？　んだぁ？　拒否すんのか？
　それでもいいぜ。
　この魔法水晶を許嫁君に送り付けるだけだがなッ！」`

const DIALOGUE_ZH = `「哈？说啥呢？敢拒绝？
行啊无所谓。
老子就把这魔法水晶寄给你未婚夫而已嘛！」`

it('peels outer shells including dialogue and 【】 / 《》', () => {
  expect(peelOptimizeShell('「hello」')).toBe('hello')
  expect(peelOptimizeShell('『nested』')).toBe('nested')
  expect(peelOptimizeShell('【标签】')).toBe('标签')
  expect(peelOptimizeShell('《书名》')).toBe('书名')
  expect(peelOptimizeShell('【加速度】')).toEqual('加速度')
  expect(peelOptimizeShell('前「中」后')).toBe('前「中」后')
  expect(peelOptimizeShell('{actor}')).toBe('{actor}')
})

it('strips edge symbols like ▼ via Unicode categories, not a glyph list', () => {
  expect(stripOptimizeEdgeJunk('▼禁止进入')).toBe('禁止进入')
  expect(peelOptimizeShell('▼禁止进入')).toBe('禁止进入')
  expect(optimizeSplitSegments('▼禁止进入')).toEqual(['禁止进入'])
  expect(optimizeSplitSegments('★注意※')).toEqual(['注意'])
  expect(buildOptimizeSegmentPairs('▼禁止进入', '▼禁止进入')).toEqual({
    srcParts: ['禁止进入'],
    zhParts: ['禁止进入'],
    pairs: [{ src: '禁止进入', zh: '禁止进入' }],
    aligned: true,
    trusted: false,
  })
  expect(hasOptimizeCandidates('▼禁止进入', '▼禁止进入')).toBe(true)
})

it('treats 【body】 as a single body-key optimize candidate', () => {
  expect(optimizeSplitSegments('【加速度】')).toEqual(['加速度'])
  expect(buildOptimizeSegmentPairs('【加速度】', '【加速】')).toEqual({
    srcParts: ['加速度'],
    zhParts: ['加速'],
    pairs: [{ src: '加速度', zh: '加速' }],
    aligned: true,
    trusted: false,
  })
  expect(hasOptimizeCandidates('【加速度】', '【加速】')).toBe(true)
  expect(canOptimizeTranslation('【加速度】', '【加速】')).toBe(true)
})

it('splits dialogue and keeps sentence-tone punctuation on each part', () => {
  expect(optimizeSplitSegments(DIALOGUE_SRC)).toEqual(['あん？', 'んだぁ？', '拒否すんのか？', 'それでもいいぜ。', 'この魔法水晶を許嫁君に送り付けるだけだがなッ！'])
  expect(optimizeSplitSegments(DIALOGUE_ZH)).toEqual(['哈？', '说啥呢？', '敢拒绝？', '行啊无所谓。', '老子就把这魔法水晶寄给你未婚夫而已嘛！'])
})

it('count-matched pairs stay untrusted', () => {
  const result = buildOptimizeSegmentPairs(DIALOGUE_SRC, DIALOGUE_ZH)
  expect(result.aligned).toBe(true)
  expect(result.trusted).toBe(false)
  expect(result.pairs).toHaveLength(5)
  expect(result.pairs[0]).toEqual({ src: 'あん？', zh: '哈？' })
  expect(result.pairs[4]).toEqual({
    src: 'この魔法水晶を許嫁君に送り付けるだけだがなッ！',
    zh: '老子就把这魔法水晶寄给你未婚夫而已嘛！',
  })
  expect(hasOptimizeCandidates(DIALOGUE_SRC, DIALOGUE_ZH)).toBe(true)
  expect(hasOptimizeCandidates('短い')).toBe(false)
})

it('does not strip protective brackets when cleaning sentence edges', () => {
  expect(optimizeSplitSegments('待って（本当？）。次へ。')).toEqual(['待って（本当？）。', '次へ。'])
})

it('marks misaligned pairs when segment counts differ', () => {
  const result = buildOptimizeSegmentPairs('あ。い。', '一对。')
  expect(result.aligned).toBe(false)
  expect(result.trusted).toBe(false)
  expect(result.pairs).toEqual([
    { src: 'あ。', zh: '一对。' },
    { src: 'い。', zh: '' },
  ])
})

it('peels unmatched opening shells on import fragments like （好感度：', () => {
  expect(peelOptimizeShell('（好感度：')).toBe('好感度')
  expect(optimizeSplitSegments('（好感度：')).toEqual(['好感度'])
  expect(buildOptimizeSegmentPairs('（好感度：', '（好感度：')).toEqual({
    srcParts: ['好感度'],
    zhParts: ['好感度'],
    pairs: [{ src: '好感度', zh: '好感度' }],
    aligned: true,
    trusted: false,
  })
  expect(hasOptimizeCandidates('（好感度：', '（好感度：')).toBe(true)
  expect(hasOptimizeCandidates('短い。', '短的。')).toBe(false)
})

it('splits JS string-concat import rows into peeled literal bodies', () => {
  const src = "'レオン' + '（好感度：' +"
  const zh = "'里昂'+'（好感度：'+"
  expect(extractJsConcatLiterals(src)).toEqual(['レオン', '（好感度：'])
  expect(optimizeSplitSegments(src)).toEqual(['レオン', '好感度'])
  expect(optimizeSplitSegments(zh)).toEqual(['里昂', '好感度'])
  expect(buildOptimizeSegmentPairs(src, zh)).toEqual({
    srcParts: ['レオン', '好感度'],
    zhParts: ['里昂', '好感度'],
    pairs: [
      { src: 'レオン', zh: '里昂' },
      { src: '好感度', zh: '好感度' },
    ],
    aligned: true,
    trusted: false,
  })
  expect(hasOptimizeCandidates(src, zh)).toBe(true)
})
