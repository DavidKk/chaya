import { traceTranslationCache } from '@/lib/translate/cache-match-trace'
import { planSentenceTranslation, type SentenceRecord } from '@/lib/translate/sentence-plan'

const record = (src: string, zh: string): SentenceRecord => ({ id: src, revision: 1, src, zh })

it('keeps examining every branch and body split after an adopted whole hit', () => {
  const src = '「First.Second.」'
  const rows = [record(src, '整段译文'), record('First.', '第一。'), record('Second.', '第二。')]
  const actual = planSentenceTranslation(src, rows)
  const before = JSON.stringify([actual, rows])
  const trace = traceTranslationCache(src, rows, actual)
  expect(trace.paths).toHaveLength(14)
  expect(trace.paths.map((p) => p.kind).slice(0, 7)).toEqual(['whole', 'segments', 'verified', 'sentences', 'ellipsis', 'lines', 'structure'])
  expect(trace.paths.find((p) => p.id === '0:whole')).toMatchObject({ status: 'full', adopted: true })
  expect(trace.paths.find((p) => p.id === '0:segments')?.alternatives).toHaveLength(0)
  const body = trace.paths.find((p) => p.id === '1:segments')!
  expect(body).toMatchObject({ status: 'full', adopted: false, offset: 1 })
  expect(body.units).toHaveLength(2)
  expect(body.preview).toBe('第一。第二。')
  expect(body.alternatives).toHaveLength(2)
  expect(JSON.stringify([actual, rows])).toBe(before)
})

it('adopts an independent first sentence inside a complete dialogue shell', () => {
  const src = '「First.\nChanged second」'
  const rows = [record('「First.', '「第一。')]
  const actual = planSentenceTranslation(src, rows)
  expect(actual.status).toBe('partial')
  const trace = traceTranslationCache(src, rows, actual)
  expect(trace.paths.find((p) => p.id === '0:lines')).toMatchObject({ status: 'partial', adopted: true })
  const segments = trace.paths.find((p) => p.id === '1:segments')!
  expect(segments.status).toBe('miss')
  expect(segments.lookupKeys).toContain('First.\nChanged second')
  expect(segments.checks[0].reasons).toContain('source_units_differ')
})

it('shows explicit limits without hiding the remaining registered branches', () => {
  const src = 'A.'.repeat(300)
  const rows = [record('A.', '甲。')]
  const actual = planSentenceTranslation(src, rows)
  const trace = traceTranslationCache(src, rows, actual)
  expect(trace.limited).toBe(true)
  expect(trace.paths).toHaveLength(7)
  expect(trace.paths.some((p) => p.limited)).toBe(true)
})

it('reports alternative conflicts without choosing a translation or changing the adopted plan', () => {
  const rows = [record('A.B.', '整体'), record('A.', '甲'), { ...record('A.', '另一译文'), id: 'other' }, record('B.', '乙')]
  const actual = planSentenceTranslation('A.B.', rows)
  const trace = traceTranslationCache('A.B.', rows, actual)
  expect(actual.zh).toBe('整体')
  const segments = trace.paths.find((p) => p.kind === 'segments')!
  expect(segments.ambiguous).toBe(true)
  expect(segments.alternatives.length).toBeGreaterThan(segments.matches.length)
  expect(segments.reasons).toContain('ambiguous_translation')
})

it('marks upstream candidate limits on every path instead of reporting an exhaustive miss', () => {
  const actual = { ...planSentenceTranslation('A.B.', []), limited: true }
  const trace = traceTranslationCache('A.B.', [], actual)
  expect(trace.limited).toBe(true)
  expect(trace.paths.every((p) => p.limited && p.reasons.includes('candidate_limit'))).toBe(true)
  expect(trace.paths.some((p) => p.reasons.includes('no_candidates'))).toBe(false)
})

it('lists hypothetical splits when splitting is explicitly disabled', () => {
  const text = '「A.B.」'
  const options = { structure: { mode: 'disabled' as const } }
  const rows = [record(text, '整体'), record('A.', '甲。'), record('B.', '乙。')]
  const trace = traceTranslationCache(text, rows, planSentenceTranslation(text, rows, options), options)
  expect(trace.paths).toHaveLength(14)
  expect(trace.paths.find((p) => p.id === '1:segments')).toMatchObject({ status: 'full', applicable: false, adopted: false })
  expect(trace.paths.find((p) => p.id === '1:whole')).toMatchObject({ applicable: false, adopted: false })
})

it('distinguishes invalid query boundaries from a rejected parent alignment', () => {
  const rows = [record('A.C.', '甲。丙。')]
  const text = 'X,A.B.'
  const trace = traceTranslationCache(text, rows, planSentenceTranslation(text, rows))
  expect(trace.paths.find((p) => p.kind === 'sentences')?.checks[0].reasons).toContain('query_boundary_incompatible')
})

it('allows sentence inference around local variable controls consistently with the actual planner', () => {
  const text = '変数\\V[1]。変更。'
  const rows = [record('変数\\V[1]。続き。', '变量\\V[1]。后续。')]
  const actual = planSentenceTranslation(text, rows)
  expect(actual.matches).toHaveLength(1)
  expect(traceTranslationCache(text, rows, actual).paths.find((p) => p.kind === 'sentences')).toMatchObject({ applicable: true, adopted: true, status: 'partial' })
})

it('does not claim line breaks are absent when complete lines exist but no cache matches them', () => {
  const text = 'First.\nSecond.'
  const rows = [record('Other.', '其他。')]
  const trace = traceTranslationCache(text, rows, planSentenceTranslation(text, rows))
  const lines = trace.paths.find((p) => p.kind === 'lines')!
  expect(lines.applicable).toBe(true)
  expect(lines.reasons).toContain('source_units_differ')
  expect(lines.reasons).not.toContain('no_line_break')
})
