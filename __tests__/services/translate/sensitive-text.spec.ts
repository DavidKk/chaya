jest.mock('wordguard', () => ({
  wordguard: () => ({
    matchAll: (text: string) => {
      const hits: Array<{ word: string }> = []
      for (const w of ['レイプ', 'セックス', '強姦']) {
        if (String(text).includes(w)) hits.push({ word: w })
      }
      return hits
    },
  }),
}))

import { isNsfwCacheRow, isNsfwTaggedEngine, isSensitiveForCloud, partitionCloudSafeTexts } from '@/services/translate/sensitive-text'

describe('sensitive-text cloud partition', () => {
  it('keeps ordinary dialogue in the safe bucket', () => {
    const { safe, sensitive } = partitionCloudSafeTexts(['今日はいい天気だ', 'クエストを受注する'])
    expect(sensitive).toEqual([])
    expect(safe).toHaveLength(2)
  })

  it('isolates NSFW lines so one phrase cannot poison a cloud chunk', () => {
    const lines = ['村長に話を聞く', 'レイプされてしまった', '次の町へ向かう']
    const { safe, sensitive } = partitionCloudSafeTexts(lines)
    expect(sensitive).toEqual(['レイプされてしまった'])
    expect(safe).toEqual(['村長に話を聞く', '次の町へ向かう'])
  })

  it('isSensitiveForCloud matches explicit adult terms', () => {
    expect(isSensitiveForCloud('普通の会話です')).toBe(false)
    expect(isSensitiveForCloud('セックスする')).toBe(true)
  })

  it('isNsfwTaggedEngine reads live / skip tags', () => {
    expect(isNsfwTaggedEngine('live:ollama:nsfw')).toBe(true)
    expect(isNsfwTaggedEngine('skip:sensitive')).toBe(true)
    expect(isNsfwTaggedEngine('live:bing')).toBe(false)
    expect(isNsfwTaggedEngine(null)).toBe(false)
  })

  it('isNsfwCacheRow combines tag and text inspect', () => {
    expect(isNsfwCacheRow('普通の会話です', 'live:bing')).toBe(false)
    expect(isNsfwCacheRow('普通の会話です', 'live:ollama:nsfw')).toBe(true)
    expect(isNsfwCacheRow('セックスする', 'live:bing')).toBe(true)
  })
})
