jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createSentenceResolver } from '@/lib/translate/sentence-plan'
import { testTranslationCache } from '@/services/translate/cache-diagnostics'
import { openSharedCache } from '@/services/translate/shared-cache'

const pair = { from: 'ja' as const, to: 'zh' as const }
const wrappers = [
  ['', ''],
  ['「', '」'],
  ['『', '』'],
  ['（', '）'],
]
const cases = wrappers.flatMap(([lead, trail]) => ['。', '、', '；', '\n'].flatMap((separator) => [0, 1, 2].map((changed) => ({ lead, trail, separator, changed }))))

it.each(cases.filter((c) => c.lead))('reuses shell-bearing edge records across $lead / $separator / edit $changed', ({ lead, trail, separator, changed }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-shell-matrix-'))
  const file = path.join(dir, 'cache.sqlite')
  const cache = openSharedCache(file)
  try {
    const mark = separator === '\n' ? '' : separator
    const source = [lead + '先頭' + mark, '中間' + mark, '末尾' + mark + trail]
    const target = [lead + '开头' + mark, '中间' + mark, '结尾' + mark + trail]
    const rows = source.map((s, i) => [s, target[i]] as [string, string])
    cache.writeMany(rows, 'manual', pair)
    const parts = source.map((s, i) => (i === changed ? s.replace(['先頭', '中間', '末尾'][i], '変更3') : s))
    const join = separator === '\n' ? '\n' : ''
    const text = parts.join(join)
    const before = cache.listPage(pair)
    const result = testTranslationCache({ ...pair, text, scope: 'shared' }, file)
    expect(result.plan).toMatchObject({ status: 'partial', ambiguous: false, limited: false })
    expect(result.plan.matches).toHaveLength(2)
    expect(result.preview).toBe(parts.map((s, i) => (i === changed ? s : target[i])).join(join))
    expect(createSentenceResolver(source.map((s) => cache.record(s, pair)!)).plan(text)).toEqual(result.plan)
    expect(cache.listPage(pair)).toEqual(before)
  } finally {
    cache.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it.each(cases)('keeps independent unmodified segments across $lead / $separator / edit $changed', ({ lead, trail, separator, changed }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-matrix-'))
  const file = path.join(dir, 'cache.sqlite')
  const cache = openSharedCache(file)
  try {
    const source = ['先頭', '中間', '末尾'],
      target = ['开头', '中间', '结尾']
    const mark = separator === '\n' ? '' : separator
    const rows = source.map((s, i) => [s + mark, target[i] + mark] as [string, string])
    cache.writeMany(rows, 'manual', pair)
    const parts = source.map((s, i) => s + (i === changed ? '3' : '') + mark)
    const text = lead + parts.join(separator === '\n' ? '\n' : '') + trail
    const expected = lead + parts.map((s, i) => (i === changed ? s : target[i] + mark)).join(separator === '\n' ? '\n' : '') + trail
    const before = cache.listPage(pair),
      version = cache.version()
    const result = testTranslationCache({ ...pair, text, scope: 'shared' }, file)
    expect(result.plan).toMatchObject({ status: 'partial', ambiguous: false, limited: false })
    expect(result.plan.matches).toHaveLength(2)
    expect(result.preview).toBe(expected)
    expect(createSentenceResolver(rows.map(([s]) => cache.record(s, pair)!)).plan(text)).toEqual(result.plan)
    expect(cache.plan(text, pair).matches).toEqual(result.plan.matches)
    expect(cache.listPage(pair)).toEqual(before)
    expect(cache.version()).toBe(version)
  } finally {
    cache.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it.each(wrappers.flatMap(([lead, trail]) => [0, 1, 2].map((changed) => ({ lead, trail, changed }))))(
  'extracts unmodified complete sentences from a parent record across $lead / edit $changed',
  ({ lead, trail, changed }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-parent-matrix-'))
    const file = path.join(dir, 'cache.sqlite')
    const cache = openSharedCache(file)
    try {
      const source = ['先頭。', '中間？', '末尾！'],
        target = ['开头。', '中间？', '结尾！']
      const src = source.join('')
      cache.writeMany([[src, target.join('')]], 'manual', pair)
      const text = lead + source.map((s, i) => (i === changed ? '変更3' + s : s)).join('') + trail
      const result = testTranslationCache({ ...pair, text, scope: 'shared' }, file)
      expect(result.plan).toMatchObject({ status: 'partial', ambiguous: false })
      expect(result.plan.matches).toHaveLength(2)
      expect(result.plan.matches.every((m) => m.alignment === 'inferred')).toBe(true)
      expect(result.preview).toBe(lead + source.map((s, i) => (i === changed ? '変更3' + s : target[i])).join('') + trail)
      expect(createSentenceResolver([cache.record(src, pair)!]).plan(text)).toEqual(result.plan)
    } finally {
      cache.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
)
