import { createSentenceResolver, planSentenceTranslation, renderSentencePlan, type SentenceRecord, validateAlignments } from '@/lib/translate/sentence-plan'
import { sentenceUnits } from '@/lib/translate/sentence-units'

const record = (src: string, zh: string, extra: Partial<SentenceRecord> = {}): SentenceRecord => ({ id: src, revision: 1, src, zh, ...extra })

describe('short-sentence reuse', () => {
  it('reuses a consecutive block, keeping its punctuation and a separate gap', () => {
    const plan = planSentenceTranslation('a,b,c', [record('b,c', '乙，丙')])
    expect(plan.status).toBe('partial')
    expect(plan.matches.map((m) => m.text)).toEqual(['乙，丙'])
    expect(plan.gaps.map((g) => g.text)).toEqual(['a,'])
    expect(renderSentencePlan(plan, new Map([[plan.gaps[0].id, '甲']]))).toBe('甲,乙，丙')
  })
  it('prefers the whole block to independent sentences', () => {
    const plan = planSentenceTranslation('b,c', [record('b', '乙'), record('c', '丙'), record('b,c', '整块译文')])
    expect(plan.zh).toBe('整块译文')
    expect(plan.matches).toHaveLength(1)
  })
  it('supports reverse containment only with a verified mapping', () => {
    const r = record('a,b,c', '甲，乙，丙')
    expect(planSentenceTranslation('b,c', [r]).status).toBe('miss')
    const groups = [{ sourceStart: 2, sourceEnd: 5, targetStart: 2, targetEnd: 5, evidence: 'verified' as const }]
    expect(validateAlignments(r, groups)).toBe(true)
    expect(planSentenceTranslation('b,c', [{ ...r, alignments: groups }]).zh).toBe('乙，丙')
    expect(planSentenceTranslation('b,c', [{ ...r, alignments: groups.map((g) => ({ ...g, evidence: 'structural' })) }]).status).toBe('miss')
    expect(planSentenceTranslation('b', [{ ...r, alignments: groups }]).status).toBe('miss')
  })
  it('never matches word fragments or a different tone', () => {
    expect(planSentenceTranslation('abc', [record('a', '甲'), record('b', '乙'), record('c', '丙')]).status).toBe('miss')
    expect(planSentenceTranslation('b?', [record('b!', '乙！'), record('b', '乙')]).status).toBe('miss')
    expect(planSentenceTranslation('b？', [record('b?', '乙？')]).zh).toBe('乙？')
    expect(planSentenceTranslation('カタカナ！', [record('ｶﾀｶﾅ！', '片假名！')]).zh).toBe('片假名！')
    expect(planSentenceTranslation('b', [record('「b」?', '「乙」?')]).status).toBe('miss')
  })
  it('protects local manual intervals from a longer remote block', () => {
    const plan = planSentenceTranslation('b,c', [record('b', '人工乙', { local: true, engine: 'manual' }), record('b,c', '机翻乙，丙')])
    expect(plan.matches.map((m) => m.text)).toEqual(['人工乙'])
    expect(plan.gaps.map((g) => g.text)).toEqual(['c'])
  })
  it('maximizes global coverage without duplicating overlap', () => {
    const plan = planSentenceTranslation('a,b,c,d', [record('a,b,c', '前三句'), record('a,b', '前两句'), record('c,d', '后两句')])
    expect(plan.status).toBe('full')
    expect(plan.matches.map((m) => m.record.src)).toEqual(['a,b', 'c,d'])
  })
  it('preserves control parameters, numeric punctuation, titles; mid-phrase newlines do not split', () => {
    expect(sentenceUnits('価格1,000.5。名前\\n[1]？【a,b】')).toHaveLength(3)
    expect(sentenceUnits('<span title="a,b">説明</span>')).toHaveLength(1)
    expect(sentenceUnits('https://example.com/a,b')).toHaveLength(1)
    expect(planSentenceTranslation('a\nb', [record('a,b', '甲，乙')]).status).toBe('miss')
    expect(planSentenceTranslation('a\nb', [record('a\nb', '甲\n乙')]).zh).toBe('甲\n乙')
  })

  it('keeps soft wraps together first and only reuses exact independent lines as a fallback', () => {
    const broken = '好きじゃ\n　ないんスよ'
    const units = sentenceUnits(broken)
    expect(units).toHaveLength(1)
    expect(units[0]?.key).toBe(sentenceUnits('好きじゃないんスよ')[0]?.key)
    // A soft wrap remains one semantic unit; explicit whole-line caches may answer the later fallback.
    expect(planSentenceTranslation(broken, [record('好きじゃ', '喜欢'), record('ないんスよ', '啊')]).zh).toBe('喜欢\n　啊')
    expect(planSentenceTranslation(broken, [record(broken, '其实不太喜欢啊')]).zh).toBe('其实不太喜欢啊')
  })

  it('only hard newline annotations create block seams', () => {
    const text = '前段\n后段'
    // Mid-phrase letters → inferred soft → single unit.
    expect(sentenceUnits(text)).toHaveLength(1)
    const hard = sentenceUnits(text, { newlines: [{ start: 2, end: 3, kind: 'hard' }] })
    expect(hard).toHaveLength(2)
    expect(hard[0]?.block).not.toBe(hard[1]?.block)
    expect(sentenceUnits(text, { newlines: [{ start: 2, end: 3, kind: 'soft' }] })).toHaveLength(1)
  })
  it('degrades safely when repeated short sentences exceed the matching budget', () => {
    const query = 'a,'.repeat(400) + 'c'
    const plan = planSentenceTranslation(query, [record('a,'.repeat(400) + 'b', '重复译文')])
    expect(plan.limited).toBe(true)
    expect(plan.status).toBe('miss')
  })
  it('rejects ambiguous unrelated fragments and invalid offsets', () => {
    const a = record('a,b', '甲，乙')
    expect(validateAlignments(a, [{ sourceStart: 1, sourceEnd: 3, targetStart: 0, targetEnd: 3, evidence: 'verified' }])).toBe(false)
  })

  it('matches continuous queries against soft wraps via resolver index (inferred or annotated)', () => {
    const wrapped = '好きじゃ\n　ないんスよ'
    const continuous = '好きじゃないんスよ'
    const nl = wrapped.indexOf('\n')
    const soft = record(wrapped, '其实不太喜欢啊', { newlines: [{ start: nl, end: nl + 1, kind: 'soft' }] })
    expect(planSentenceTranslation(continuous, [soft]).zh).toBe('其实不太喜欢啊')
    expect(createSentenceResolver([soft]).plan(continuous).zh).toBe('其实不太喜欢啊')
    // Mid-phrase wrap infers soft — continuous hits even without stored annotation.
    expect(createSentenceResolver([record(wrapped, '其实不太喜欢啊')]).plan(continuous).zh).toBe('其实不太喜欢啊')
  })
})

it('keeps balanced parentheticals protected and treats open continuation shells as literals', () => {
  expect(sentenceUnits('（前、後）')).toHaveLength(1)
  const text = '(前......、\n 後、続き'
  const units = sentenceUnits(text)
  expect(units.map((u) => text.slice(u.start, u.end))).toEqual(['前......、', '後、', '続き'])
  expect(sentenceUnits('( '.repeat(2000) + '前、後')).toHaveLength(2)
})

it('ignores line-edge indentation without erasing word spacing, controls or hard line boundaries', () => {
  const src = '「First.\n\t　Second.」'
  const zh = '「第一。\n第二。」'
  const resolver = createSentenceResolver([record(src, zh)])
  expect(resolver.plan('「First.\nSecond.」').zh).toBe(zh)
  expect(resolver.plan('「First.Second.」').status).toBe('miss')
  expect(createSentenceResolver([record('「one two.\nthree」', zh)]).plan('「onetwo.\nthree」').status).toBe('miss')
  expect(createSentenceResolver([record('「First.\n\\n[ 1]Second.」', zh)]).plan('「First.\n\\n[1]Second.」').status).toBe('miss')
})

it.each(['「', '『', '“'])('reuses a complete prefix inside an unclosed %s dialogue while protecting nested quotes', (quote) => {
  const prefix = quote + '前半、'
  const translated = quote + '前文、'
  const resolver = createSentenceResolver([record(prefix, translated), record('内側、', '内部、')])
  const plan = resolver.plan(prefix + '【内側、続き】後半！')
  expect(plan.status).toBe('partial')
  expect(plan.matches.map((m) => m.text)).toEqual([translated])
  expect(plan.gaps.map((g) => g.text)).toEqual(['【内側、続き】後半！'])
  expect(resolver.plan(quote + '前半、後半' + { '「': '」', '『': '』', '“': '”' }[quote])?.status).toBe('partial')
})

it.each(['', '\n', '\\n'])('reuses the first cached sentence before an edited second sentence, separator %j', (separator) => {
  const first = '「今回は催淫液を濃縮した特別製のスプレーを用意した。'
  const translated = '「这次准备了浓缩催淫液的特别款喷雾。'
  const second = '効果はさらに上がっている はずだ」'
  const src = first + separator + second
  const plan = createSentenceResolver([record(first, translated), record(first + separator + second.replace('いる はず', 'いるはず'), '整段译文')]).plan(src)
  expect(plan).toMatchObject({ status: 'partial', ambiguous: false, limited: false })
  expect(plan.matches).toHaveLength(1)
  expect(plan.matches[0]).toMatchObject({ start: 0, end: first.length, text: translated })
  expect(plan.gaps.map((g) => g.text)).toEqual(separator === '\\n' ? ['\\n', second] : [second])
  expect(renderSentencePlan(plan)).toBe(translated + separator + second)
})

it('combines a shell-bearing first sentence with an independent body sentence without losing the closing shell', () => {
  const src = '「First.Middle.Changed」'
  const plan = createSentenceResolver([record('「First.', '「第一。'), record('Middle.', '中间。')]).plan(src)
  expect(plan.status).toBe('partial')
  expect(plan.matches.map((m) => m.text)).toEqual(['「第一。', '中间。'])
  expect(renderSentencePlan(plan)).toBe('「第一。中间。Changed」')
})

it('keeps a cached closing dialogue fragment reusable while the prefix changes', () => {
  const plan = createSentenceResolver([record('Second.」', '第二。」')]).plan('「Changed.Second.」')
  expect(plan.status).toBe('partial')
  expect(renderSentencePlan(plan)).toBe('「Changed.第二。」')
})

it('only removes an open parenthetical when both cached sides share the opening shell', () => {
  expect(createSentenceResolver([record('（前半、', '（前文')]).plan('前半、後半').status).toBe('partial')
  expect(createSentenceResolver([record('(前半、', '（前文')]).plan('前半、後半').status).toBe('partial')
  expect(createSentenceResolver([record('（前半、', '前文')]).plan('前半、後半').status).toBe('miss')
  expect(createSentenceResolver([record('（前半、', '（前文）')]).plan('前半、後半').status).toBe('miss')
  expect(createSentenceResolver([record('（前半、後半', '（前文、后文')]).plan('前半、変更').status).toBe('miss')
})
