import { createSentenceResolver } from '@/lib/translate/sentence-plan'
import { punctuationKey, sentenceBodyKey, sentenceUnits, wholeSentenceKey } from '@/lib/translate/sentence-units'

it.each(['...', '....', '......', '.'.repeat(100), '…', '……', '．．．．．．', '…......…'])('treats %s as one ellipsis before splitting at a comma', (ellipsis) => {
  const src = `前${ellipsis}、後`
  const units = sentenceUnits(src)
  expect(units.map((u) => src.slice(u.start, u.end))).toEqual([`前${ellipsis}、`, '後'])
  expect(units[0]).toMatchObject({ key: '前...', tone: '', boundary: ',' })
  expect(wholeSentenceKey(src)).toBe('前...、後')
  expect(sentenceBodyKey(src)).toBe('前...、後')
})

it('keeps an ellipsis before an exclamation mark inside the same source span', () => {
  const src = '前......!後'
  const units = sentenceUnits(src)
  expect(units.map((u) => src.slice(u.start, u.end))).toEqual(['前......!', '後'])
  expect(units[0]).toMatchObject({ key: '前...', tone: '!', boundary: 'stop' })
  expect(sentenceUnits('前……！後')[0]).toMatchObject({ key: '前...', tone: '!', boundary: 'stop' })
})

it('does not swallow an ellipsis that follows a separating comma', () => {
  const src = '前、......後'
  expect(sentenceUnits(src).map((u) => src.slice(u.start, u.end))).toEqual(['前、', '......後'])
})

it('preserves ordinary periods, decimals and control parameters', () => {
  expect(punctuationKey('A.B..3.14')).toBe('A.B..3.14')
  expect(wholeSentenceKey('前\\V[1......]後......')).toBe('前\\V[1......]後...')
  expect(sentenceBodyKey('前\\V[1......]後......')).toBe('前\\V[1......]後...')
})

it('matches normalized ellipses without rewriting the source, offsets or cached translation', () => {
  const record = { id: 'one', revision: 1, src: '前……、', zh: '前文……，' }
  const src = '前.........、変更3'
  const plan = createSentenceResolver([record]).plan(src)
  expect(plan).toMatchObject({ src, status: 'partial', ambiguous: false })
  expect(plan.matches[0]).toMatchObject({ start: 0, end: '前.........、'.length, text: record.zh })
  expect(plan.gaps.map((g) => g.text)).toEqual(['変更3'])
  expect(record.src).toBe('前……、')
})

it('extracts two ellipsis-ended clauses from an aligned parent, including stutter positions', () => {
  const row = { id: 'parent', revision: 1, src: 'む、無理……、こんなの……、イ、イく……っ！）', zh: '不、不行......、这样下去......、要、要高潮了......！）' }
  const resolver = createSentenceResolver([row])
  const full = resolver.plan('無理......、こんなの......')
  expect(full).toMatchObject({ status: 'full', ambiguous: false, zh: '不行......、这样下去......' })
  expect(full.matches).toHaveLength(2)
  expect(full.matches.every((m) => m.alignmentBasis === 'ellipsis')).toBe(true)
  const partial = resolver.plan('無理......、こんな3の......')
  expect(partial).toMatchObject({ status: 'partial', ambiguous: false })
  expect(partial.matches.map((m) => m.text)).toEqual(['不行......、'])
  expect(partial.gaps.map((g) => g.text)).toEqual(['こんな3の......'])
})

it.each([
  ['A...,B...,C', '甲，乙，丙'],
  ['A...,B...,C', '甲……，乙……丙'],
  ['A...,B...,C', '甲……！乙……，丙'],
  ['A,B,C', '甲，乙，丙'],
  ['A...,B...,C', '甲，乙……，丙……'],
])('does not extract ellipsis clauses when parent structures differ: %s / %s', (src, zh) => {
  expect(createSentenceResolver([{ id: 'parent', revision: 1, src, zh }]).plan('A...,B...').matches).toHaveLength(0)
})

it('does not resolve conflicting inferred ellipsis translations arbitrarily', () => {
  const result = createSentenceResolver([
    { id: 'one', revision: 1, src: 'A...,B...,C', zh: '甲……，乙……，丙' },
    { id: 'two', revision: 1, src: 'A...,B...,D', zh: '另译……，别译……，丁' },
  ]).plan('A...,B...')
  expect(result).toMatchObject({ status: 'miss', ambiguous: true })
})
