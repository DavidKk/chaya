import { batchSources, isCacheExecution, isCacheResult, replannedResultSources } from '@/lib/translate/result-sources'
import { planSentenceTranslation } from '@/lib/translate/sentence-plan'

it('does not classify legacy partial composites as pure cache', () => {
  const item = { engine: 'cache:partial' }
  expect(isCacheResult(item)).toBe(false)
  expect(isCacheExecution(item)).toBe(false)
  expect(batchSources([item])).toEqual(['unknown', 'cache'])
})

it('separates accepted cache authority from engine execution', () => {
  const item = { engine: 'cache:changed', engineWork: true }
  expect(isCacheResult(item)).toBe(true)
  expect(isCacheExecution(item)).toBe(false)
  expect(batchSources([item])).toEqual(['cache'])
})

it('recognizes a composite with only unchanged gaps as cache-only work', () => {
  expect(isCacheExecution({ engine: 'cache:partial', resultSources: ['cache'], engineWork: false })).toBe(true)
})

it('attributes own shared and local mirror records but excludes later human revisions', () => {
  const written = { id: 'shared-1', revision: 1, src: 'Hello', zh: '你好', engine: 'live:apple' }
  const writes = [{ record: written, sources: ['live:apple'] }]
  expect(replannedResultSources(planSentenceTranslation('Hello', [written]), writes)).toEqual(['live:apple'])
  expect(replannedResultSources(planSentenceTranslation('Hello', [{ ...written, local: true, id: 'local-1', revision: 5 }]), writes)).toEqual(['live:apple'])
  expect(replannedResultSources(planSentenceTranslation('Hello', [{ ...written, engine: 'manual', revision: 2 }]), writes)).toEqual(['cache'])
})
