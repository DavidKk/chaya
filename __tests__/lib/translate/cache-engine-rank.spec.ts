import { cacheEngineRank } from '@/lib/translate/cache-engine-rank'

it('ranks optimize above plain live and below manual/import', () => {
  expect(cacheEngineRank('manual')).toBe(4)
  expect(cacheEngineRank('import')).toBe(3)
  expect(cacheEngineRank('import:patch')).toBe(3)
  expect(cacheEngineRank('live:optimize')).toBe(2)
  expect(cacheEngineRank('live:optimize:terms')).toBe(2)
  expect(cacheEngineRank('live:agent:foo')).toBe(2)
  expect(cacheEngineRank('live:google')).toBe(1)
  expect(cacheEngineRank('manual:optimize')).toBe(0)
})
