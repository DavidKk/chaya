import { createSentenceResolver, planSentenceTranslation, renderSentencePlan, type SentenceRecord } from '@/lib/translate/sentence-plan'

const record = (src: string, zh: string, extra: Partial<SentenceRecord> = {}): SentenceRecord => ({ id: src, revision: 1, src, zh, ...extra })

it('extracts a complete sentence from a containing paragraph without a stored mapping', () => {
  const row = record('勇者パーティの天才美少女魔法使い。勇者レオンとは幼馴染で許嫁。', '勇者队伍的天才美少女魔法使。与勇者里昂是青梅竹马兼未婚夫。')
  const before = JSON.stringify(row)
  const query = '勇者パーティの天才美少女魔法使い。勇者レオンとは幼馴 3染で許嫁。'
  const plan = createSentenceResolver([row]).plan(query)
  expect(plan.status).toBe('partial')
  expect(plan.matches).toEqual([expect.objectContaining({ kind: 'extracted', alignment: 'inferred', sourceStart: 0, sourceEnd: row.src.indexOf('。') + 1 })])
  expect(renderSentencePlan(plan)).toBe('勇者队伍的天才美少女魔法使。勇者レオンとは幼馴 3染で許嫁。')
  expect(JSON.stringify(row)).toBe(before)
})

it.each([
  ['A.', '甲。'],
  ['C.', '丙。'],
  ['D.', '丁。'],
  ['C.D.', '丙。丁。'],
])('reuses leading, middle, trailing or consecutive complete sentences: %s', (query, expected) => {
  const result = createSentenceResolver([record('A.C.D.', '甲。丙。丁。')]).plan(query)
  expect(result.zh).toBe(expected)
  expect(result.matches.every((m) => m.alignment === 'inferred')).toBe(true)
})

it('keeps whole translations, independent sentences and verified spans ahead of inference', () => {
  const parent = record('A.C.', '推断甲。丙。')
  const whole = record('A.B.', '整段译文')
  expect(planSentenceTranslation('A.B.', [parent, whole]).matches).toEqual([expect.objectContaining({ record: whole, text: '整段译文' })])
  const direct = record('A.', '独立甲。')
  const partial = planSentenceTranslation('A.B.', [parent, direct])
  expect(partial.matches.map((m) => m.text)).toEqual(['独立甲。'])
  expect(partial.matches[0].alignment).toBeUndefined()
  const verified = record('A.C.', '确认甲。确认丙。', { alignments: [{ sourceStart: 0, sourceEnd: 2, targetStart: 0, targetEnd: 4, evidence: 'verified' }] })
  expect(planSentenceTranslation('A.B.', [parent, verified]).matches.map((m) => m.text)).toEqual(['确认甲。'])
})

it('does not infer across existing manual mapping groups or structure-disabled records', () => {
  const parent = record('A.C.', '甲。丙。', { alignments: [{ sourceStart: 0, sourceEnd: 4, targetStart: 0, targetEnd: 4, evidence: 'verified' }] })
  expect(planSentenceTranslation('A.B.', [parent]).status).toBe('miss')
  expect(planSentenceTranslation('A.B.', [record('A.C.', '甲。丙。', { structure: { source: { mode: 'disabled' } } })]).status).toBe('miss')
  expect(planSentenceTranslation('A.B.', [record('A.C.', '甲。丙。')], { structure: { mode: 'disabled' } }).status).toBe('miss')
})

it('aggregates commas into complete sentences but never extracts their individual clauses', () => {
  const parent = record('A, B. C.', '甲乙。丙。')
  expect(
    createSentenceResolver([parent])
      .plan('A, B. Missing.')
      .matches.map((m) => m.text)
  ).toEqual(['甲乙。'])
  expect(createSentenceResolver([parent]).plan('B. Missing.').status).toBe('miss')
  expect(createSentenceResolver([record('A,B,C', '甲，乙，丙')]).plan('A,Missing').status).toBe('miss')
})

it.each([
  ['A.C.', '甲乙。'],
  ['A.C', '甲。丙。'],
  ['A.C.', '甲。丙'],
  ['A?C.', '甲！丙。'],
  ['A...C...', '甲……丙……'],
  ['「A.C.」', '「甲。丙。」'],
  ['A;C;', '甲；丙；'],
])('rejects incompatible or protected sentence structures: %s → %s', (src, zh) => {
  expect(planSentenceTranslation('A.B.', [record(src, zh)]).status).toBe('miss')
})

it('requires placeholders to stay in the same sentence and refuses cross-sentence formatting state', () => {
  const query = 'A\\V[1]. Missing.'
  expect(
    createSentenceResolver([record('A\\V[1]. C.', '甲\\V[1]。丙。')])
      .plan(query)
      .matches.map((m) => m.text)
  ).toEqual(['甲\\V[1]。'])
  expect(createSentenceResolver([record('A\\V[1]. C.', '甲。丙\\V[1]。')]).plan(query).status).toBe('miss')
  expect(createSentenceResolver([record('A{name}. C.', '甲。丙{name}。')]).plan('A{name}. Missing.').status).toBe('miss')
  expect(createSentenceResolver([record('A\\C[2]. C.', '甲\\C[2]。丙。')]).plan('A\\C[2]. Missing.').status).toBe('miss')
  expect(createSentenceResolver([record('<span>A.</span>C.', '<span>甲。</span>丙。')]).plan('<span>A.</span>Missing.').status).toBe('miss')
})

it('keeps conflicting inferred translations ambiguous instead of choosing by engine or id', () => {
  const result = planSentenceTranslation('A.B.', [record('A.C.', '甲。丙。', { engine: 'manual', local: true }), record('A.D.', '另译。丁。')])
  expect(result).toMatchObject({ status: 'miss', ambiguous: true })
  const provenConflict = planSentenceTranslation('A.B.', [record('A.', '一。'), record('A.', '二。', { id: 'other' }), record('A.C.', '甲。丙。')])
  expect(provenConflict).toMatchObject({ status: 'miss', ambiguous: true })
})

it('fills separate gaps around a direct match while preserving whitespace', () => {
  const plan = planSentenceTranslation('A.\nB. D.', [record('A.C.', '甲。丙。'), record('B.', '乙。')])
  expect(plan).toMatchObject({ status: 'partial' })
  expect(renderSentencePlan(plan)).toBe('甲。\n乙。 D.')
  expect(plan.matches).toHaveLength(2)
})

it('keeps existing list aliases available without inventing sentence alignments for list records', () => {
  const plan = planSentenceTranslation('A.B.', [record('Items: 1. A. 2. C.', '材料：1.甲。2.丙。')])
  expect(plan.matches.every((m) => m.alignment !== 'inferred')).toBe(true)
})

it('does not hide a conflicting sentence inside a longer inferred block', () => {
  const plan = planSentenceTranslation('A.B.', [record('A.C.', '甲。丙。'), record('A.B.D.', '另译。乙。丁。')])
  expect(plan).toMatchObject({ status: 'partial', ambiguous: true })
  expect(plan.matches.map((m) => m.text)).toEqual(['乙。'])
  expect(plan.gaps.map((g) => g.text)).toEqual(['A.'])
})

it('requires a complete sentence on the query side as well as the cache side', () => {
  const parent = record('A.C.', '甲。丙。')
  expect(planSentenceTranslation('X,A.B.', [parent]).status).toBe('miss')
  expect(planSentenceTranslation('X;A.B.', [parent]).status).toBe('miss')
  expect(planSentenceTranslation('X\nA.B.', [parent]).status).toBe('miss')
  expect(planSentenceTranslation('X.A.B.', [parent]).matches.map((m) => m.text)).toEqual(['甲。'])
  expect(planSentenceTranslation('A. unfinished', [parent]).matches.map((m) => m.text)).toEqual(['甲。'])
})

it('never infers from an incomplete in-memory candidate set', () => {
  const rows = Array.from({ length: 501 }, (_, i) => record(`A.X${i}.`, `甲。尾${i}。`))
  rows.push(record('A.C.', '甲。丙。'))
  const resolver = createSentenceResolver(rows)
  expect(resolver.select('A.C.B.').limited).toBe(true)
  expect(resolver.plan('A.C.B.')).toMatchObject({ status: 'miss', limited: true, matches: [] })
})

it('does not report a conflict when cache punctuation variants render identically', () => {
  const plan = planSentenceTranslation('First、\nSecond。\nModified 2。', [record('First、', '第一、'), record('First', '第一'), record('Second。', '第二。')])
  expect(plan).toMatchObject({ status: 'partial', ambiguous: false })
  expect(plan.matches).toHaveLength(2)
  expect(plan.gaps.map((g) => g.text)).toEqual(['Modified 2。'])
  expect(renderSentencePlan(plan)).toBe('第一、\n第二。\nModified 2。')
})

it('still rejects different translations at a comma seam', () => {
  const plan = planSentenceTranslation('First、\nMissing。', [record('First、', '第一、'), record('First', '另一译文')])
  expect(plan).toMatchObject({ status: 'miss', ambiguous: true })
})

it('reuses independent complete lines after a modified prefix while preserving the layout', () => {
  const text = 'Start,3changed,\nName\nKnown tail'
  const rows = [record('Start', '开头'), record('Name', '名字'), record('Known tail', '后文')]
  const plan = createSentenceResolver(rows).plan(text)
  expect(plan).toMatchObject({ status: 'partial', ambiguous: false })
  expect(plan.matches.map((m) => m.text)).toEqual(['开头', '名字', '后文'])
  expect(renderSentencePlan(plan)).toBe('开头,3changed,\n名字\n后文')
  expect(plan.gaps.map((g) => g.text)).toEqual(['3changed,'])
})

it('never infers translations from equal-count visual lines or matches arbitrary substrings within a line', () => {
  expect(createSentenceResolver([record('Name\nKnown', '名字\n已知')]).plan('Name\nChanged').status).toBe('miss')
  expect(createSentenceResolver([record('Known', '已知')]).plan('PrefixKnown\nChanged').status).toBe('miss')
  expect(createSentenceResolver([record('Name', '名字'), record('Known', '已知')]).plan('Preface「Name\nKnown」').status).toBe('miss')
})

it('keeps whole and continuous soft-wrap translations ahead of independent line caches', () => {
  const rows = [record('Name', '名字'), record('Known', '已知'), record('NameKnown', '连续整段')]
  expect(createSentenceResolver(rows).plan('Name\nKnown').zh).toBe('名字\n已知')
  expect(createSentenceResolver([...rows, record('Name Known', '整段译文')]).plan('Name\nKnown').zh).toBe('整段译文')
  expect(createSentenceResolver([record('前段', '前文'), record('后段', '后文'), record('前段后段', '连续整段')]).plan('前段\n后段').zh).toBe('连续整段')
})

it('checks an intermediate shell for a whole cached translation before stripping deeper shells', () => {
  const rows = [record('（先頭。末尾。）', '已确认的整段译文'), record('先頭。', '开头。'), record('末尾。', '末尾。')]
  expect(createSentenceResolver(rows).plan('「（先頭。末尾。）」').zh).toBe('「已确认的整段译文」')
})

it('keeps ambiguity in an intermediate shell instead of bypassing it through a deeper view', () => {
  const rows = [record('（先頭。末尾。）', '译文一'), record('（先頭。末尾。）', '译文二', { id: 'other' }), record('先頭。', '开头。')]
  expect(createSentenceResolver(rows).plan('「（先頭。末尾。）」')).toMatchObject({ status: 'miss', ambiguous: true })
})
