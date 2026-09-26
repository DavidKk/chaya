import { liveTranslateTexts, ollamaJaToZh } from '@/services/translate/live-translate'
import { getTranslationPlaySettings } from '@/services/translate/play-settings'
import { benchmarkLocalModel, translateDialogue } from '@/services/translate/realtime'

jest.mock('@/services/translate/live-translate', () => ({ liveTranslateTexts: jest.fn(), ollamaJaToZh: jest.fn() }))
jest.mock('@/services/translate/play-settings', () => ({ getTranslationPlaySettings: jest.fn() }))

beforeEach(() => {
  jest.mocked(getTranslationPlaySettings).mockReturnValue({ mode: 'realtime', model: 'local-mini:test', timeoutMs: 8_000 })
  jest.mocked(liveTranslateTexts).mockResolvedValue({ items: [], contentRoot: '/games/A', engines: ['ollama'] })
})

it('pins the game, model and local-only engines independently of background switches', async () => {
  await translateDialogue('/games/A', ['こんにちは'])
  expect(getTranslationPlaySettings).toHaveBeenCalledWith('/games/A')
  expect(liveTranslateTexts).toHaveBeenCalledWith(
    ['こんにちは'],
    expect.objectContaining({ contentRoot: '/games/A', engines: ['ollama'], local: expect.objectContaining({ model: 'local-mini:test', interactive: true }) })
  )
})

it('does not run realtime requests in pretranslated mode', async () => {
  jest.mocked(getTranslationPlaySettings).mockReturnValue({ mode: 'pretranslated', model: '', timeoutMs: 8_000 })
  await expect(translateDialogue('/games/A', ['こんにちは'])).rejects.toThrow('未开启')
  expect(liveTranslateTexts).not.toHaveBeenCalled()
})

it('rejects oversized or invalid dialogue before inference', async () => {
  await expect(translateDialogue('/games/A', ['あ'.repeat(2_001)])).rejects.toThrow('2000')
  await expect(translateDialogue('/games/A', [123])).rejects.toThrow('2000')
  expect(liveTranslateTexts).not.toHaveBeenCalled()
})

it('benchmarks the local model directly without accessing translation caches', async () => {
  jest.mocked(ollamaJaToZh).mockResolvedValue('前面的森林有魔物，天黑之前回村吧。')
  const result = await benchmarkLocalModel({ model: 'mini:bench' })
  expect(result.translation).toContain('回村')
  expect(result.characters).toBeGreaterThan(40)
  expect(ollamaJaToZh).toHaveBeenCalledWith(result.sample, expect.objectContaining({ model: 'mini:bench', interactive: true }))
  expect(liveTranslateTexts).not.toHaveBeenCalled()
})
