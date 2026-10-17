import { cacheEngineKind, isLiveCacheEngine, parseCacheLiveFlag, parseCacheNsfwFlag } from '@/lib/translate/cache-engine-kind'

it('groups stored engine tags into import, agent, google and bing', () => {
  expect(cacheEngineKind('import:翻译文件.json:aligned')).toBe('import')
  expect(cacheEngineKind('live:ollama:nsfw')).toBe('agent')
  expect(cacheEngineKind('live:agent:ollama-local')).toBe('agent')
  expect(cacheEngineKind('live:google')).toBe('google')
  expect(cacheEngineKind('live:bing')).toBe('bing')
  expect(cacheEngineKind('manual')).toBeNull()
  expect(isLiveCacheEngine('live:google')).toBe(true)
  expect(isLiveCacheEngine('live:agent:ollama-local:nsfw')).toBe(true)
  expect(isLiveCacheEngine('import:翻译文件.json')).toBe(false)
  expect(parseCacheNsfwFlag('safe')).toBe('safe')
  expect(parseCacheNsfwFlag('1')).toBe('nsfw')
  expect(parseCacheNsfwFlag('live')).toBe('')
  expect(parseCacheLiveFlag('stored')).toBe('stored')
  expect(parseCacheLiveFlag('nsfw')).toBe('')
})
