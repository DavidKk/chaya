jest.mock('@/services/storage/game-files', () => ({ appendPublicGameCache: jest.fn() }))
jest.mock('@/services/translate/game-records', () => ({ loadGameTranslationRecords: jest.fn() }))
jest.mock('@/services/translate/name-glossary-game', () => ({ loadGameNameEntries: jest.fn() }))
jest.mock('@/services/translate/live-translate', () => ({
  appendGameNdjson: jest.fn(),
  liveTranslateTexts: jest.fn(),
  resolveBoundContentRoot: jest.fn(() => '/mock/game/content'),
}))
jest.mock('@/services/translate/shared-cache', () => ({
  openSharedCache: jest.fn(() => ({
    writeMany: jest.fn((pairs: Array<[string, string]>) => ({ accepted: pairs, records: [], rejected: [] })),
    close: jest.fn(),
  })),
}))
jest.mock('@/services/runtime/presence', () => ({ getGamePresence: jest.fn(() => ({ online: false })) }))
jest.mock('@/services/translate/live-activity', () => ({ assertOptimizeMayDispatch: jest.fn(() => ({ ok: true })) }))

import { appendPublicGameCache } from '@/services/storage/game-files'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { assertOptimizeMayDispatch } from '@/services/translate/live-activity'
import { liveTranslateTexts } from '@/services/translate/live-translate'
import { loadGameNameEntries } from '@/services/translate/name-glossary-game'
import { applyNameSentenceSync, scanNameSentenceSync } from '@/services/translate/name-sync-service'
import { openSharedCache } from '@/services/translate/shared-cache'

const loadRecords = loadGameTranslationRecords as jest.MockedFunction<typeof loadGameTranslationRecords>
const loadNames = loadGameNameEntries as jest.MockedFunction<typeof loadGameNameEntries>
const live = liveTranslateTexts as jest.MockedFunction<typeof liveTranslateTexts>
const gate = assertOptimizeMayDispatch as jest.MockedFunction<typeof assertOptimizeMayDispatch>

beforeEach(() => {
  jest.clearAllMocks()
  gate.mockReturnValue({ ok: true })
  live.mockResolvedValue({
    items: [{ src: ' mother.', zh: '母亲。', engine: 'live:google' }],
    contentRoot: '/mock/game/content',
    engines: ['google'],
  })
  loadNames.mockResolvedValue([{ src: 'Rei', zh: '蕾' }])
  loadRecords.mockReturnValue([
    { id: '1', revision: 1, src: "Rei's mother.", zh: '丽的母亲', engine: 'live:google' },
    { id: '2', revision: 1, src: 'Rei', zh: '蕾', engine: 'live:google' },
    { id: '3', revision: 1, src: "Rei's father.", zh: '手改', engine: 'manual' },
  ])
})

it('prepares a fully translated preview without writing and skips manual rows', async () => {
  const res = await scanNameSentenceSync('/mock/game/content')
  expect(res.skippedProtected).toBe(1)
  expect(res.candidates).toEqual([expect.objectContaining({ src: "Rei's mother.", oldZh: '丽的母亲', newZh: '蕾的母亲。' })])
  expect(res.candidates.some((c) => c.src === "Rei's father.")).toBe(false)
  expect(res.previewId).toEqual(expect.any(String))
  expect(openSharedCache).not.toHaveBeenCalled()
  expect(live).toHaveBeenCalledWith([' mother.'], expect.objectContaining({ persist: false }))
})

it('does not scan when the caller passes an empty name list', async () => {
  const res = await scanNameSentenceSync('/mock/game/content', { names: [] })
  expect(res.candidates).toEqual([])
  expect(res.nameCount).toBe(0)
  expect(live).not.toHaveBeenCalled()
})

it('writes the exact preview without retranslating and rejects replay', async () => {
  const scan = await scanNameSentenceSync('/mock/game/content')
  live.mockClear()
  const options = { contentRoot: '/mock/game/content', previewId: scan.previewId! }
  const res = await applyNameSentenceSync(options)
  expect(res.applied).toBe(1)
  expect(res.items).toEqual(scan.candidates)
  expect(appendPublicGameCache).toHaveBeenCalledWith('/mock/game/content', [expect.objectContaining({ s: "Rei's mother.", t: '蕾的母亲。', engine: 'live:optimize:names' })])
  expect(live).not.toHaveBeenCalled()
  const replay = await applyNameSentenceSync(options)
  expect(replay.applied).toBe(0)
  expect(replay.pausedReason).toBeTruthy()
})

it('rejects a preview when the glossary changes or the game switches', async () => {
  const scan = await scanNameSentenceSync('/mock/game/content')
  const otherGame = await applyNameSentenceSync({ contentRoot: '/other/game', previewId: scan.previewId! })
  expect(otherGame.pausedReason).toBeTruthy()
  loadNames.mockResolvedValue([{ src: 'Rei', zh: '莉' }])
  const renamed = await applyNameSentenceSync({ contentRoot: '/mock/game/content', previewId: scan.previewId! })
  expect(renamed.pausedReason).toBeTruthy()
  expect(openSharedCache).not.toHaveBeenCalled()
})

it('allows only one concurrent apply of the same preview', async () => {
  const scan = await scanNameSentenceSync('/mock/game/content')
  const options = { contentRoot: '/mock/game/content', previewId: scan.previewId! }
  const results = await Promise.all([applyNameSentenceSync(options), applyNameSentenceSync(options)])
  expect(results.map((result) => result.applied).sort()).toEqual([0, 1])
})

it('never rewrites the authoritative name itself even if its machine cache disagrees', async () => {
  loadRecords.mockReturnValue([{ id: '2', revision: 1, src: 'Rei', zh: '国王', engine: 'live:bing' }])
  const scan = await scanNameSentenceSync('/mock/game/content')
  expect(scan.candidates).toEqual([])
  expect(live).not.toHaveBeenCalled()
})

it('skips a sentence edited after preview', async () => {
  const scan = await scanNameSentenceSync('/mock/game/content')
  loadRecords.mockReturnValue([{ id: '1', revision: 2, src: "Rei's mother.", zh: '人工定稿', engine: 'manual' }])
  const res = await applyNameSentenceSync({ contentRoot: '/mock/game/content', previewId: scan.previewId! })
  expect(res.applied).toBe(0)
  expect(res.skippedCount).toBe(1)
})

it('does not dispatch gaps when realtime activity holds the gate', async () => {
  gate.mockReturnValue({ ok: false, pausedReason: 'live-active' })
  const scan = await scanNameSentenceSync('/mock/game/content')
  expect(scan.pausedReason).toBe('live-active')
  expect(scan.previewId).toBeUndefined()
  expect(live).not.toHaveBeenCalled()
})

it('keeps failed gap translations for review and never writes them', async () => {
  live.mockResolvedValue({ items: [{ src: ' mother.', zh: null, error: 'failed' }], engines: [], contentRoot: '/mock/game/content' })
  const scan = await scanNameSentenceSync('/mock/game/content')
  expect(scan.review).toBe(1)
  expect(scan.candidates[0].via).toBe('review')
  const res = await applyNameSentenceSync({ contentRoot: '/mock/game/content', previewId: scan.previewId! })
  expect(res.applied).toBe(0)
})

it.each(['en', 'cht', 'zh-tw'])('does not write simplified Chinese translations for target %s', async (targetLang) => {
  const scan = await scanNameSentenceSync('/mock/game/content', { targetLang })
  expect(scan.candidates).toEqual([])
  expect(live).not.toHaveBeenCalled()
})
