jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/services/runtime/presence', () => ({
  getGamePresence: jest.fn(() => ({ online: false })),
}))
jest.mock('@/services/translate/game-records', () => ({
  loadGameTranslationRecords: jest.fn(),
}))
jest.mock('@/services/extract/lib/extract-items', () => ({
  loadExtractedItems: jest.fn(() => []),
}))
jest.mock('@/services/translate/live-translate', () => ({
  appendGameNdjson: jest.fn(),
  liveTranslateTexts: jest.fn(),
  resolveBoundContentRoot: jest.fn(() => '/mock/game/content'),
}))
jest.mock('@/services/translate/shared-cache', () => ({
  openSharedCache: jest.fn(() => ({
    writeMany: jest.fn((pairs: Array<[string, string]>) => ({
      accepted: pairs,
      records: [],
      rejected: [],
    })),
    upsertOptimizeMany: jest.fn(),
    close: jest.fn(),
  })),
}))

import { fixKnownBadGameTermTranslation, lookupGameTerm } from '@/lib/translate/game-terms'
import { loadExtractedItems } from '@/services/extract/lib/extract-items'
import { getGamePresence } from '@/services/runtime/presence'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { liveTranslateTexts } from '@/services/translate/live-translate'
import {
  applyGameTermFixes,
  batchOptimizeTranslations,
  isAlreadyOptimizedEngine,
  isMachineTranslationEngine,
  isShortEntityItem,
  isSystemIdleForOptimization,
  OPTIMIZE_ENGINE_AGENT,
  OPTIMIZE_ENGINE_TERMS,
  recordLiveTranslateActivity,
  runShortEntityOptimization,
  scanGameTranslationsForOptimization,
  trackLiveTranslateRequest,
} from '@/services/translate/optimize-service'

describe('Game Terms Optimization and Disambiguation', () => {
  it('correctly looks up and prioritizes game terms over machine translation', () => {
    expect(lookupGameTerm('Save')).toBe('保存')
    expect(lookupGameTerm('Load')).toBe('读取')
    expect(lookupGameTerm('New Game')).toBe('新游戏')
    expect(lookupGameTerm('Continue')).toBe('继续游戏')
    expect(lookupGameTerm('Options')).toBe('设置')
    expect(lookupGameTerm('Item')).toBe('道具')
    expect(lookupGameTerm('Skill')).toBe('技能')
    expect(lookupGameTerm('Equip')).toBe('装备')
    expect(lookupGameTerm('Status')).toBe('状态')
    expect(lookupGameTerm('Quit')).toBe('退出')
    expect(lookupGameTerm('Gold')).toBe('金币')
  })

  it('identifies and fixes known bad machine translations of game terms', () => {
    expect(fixKnownBadGameTermTranslation('Save', '节省')).toBe('保存')
    expect(fixKnownBadGameTermTranslation('Save', '拯救')).toBe('保存')
    expect(fixKnownBadGameTermTranslation('Load', '装载')).toBe('读取')
    expect(fixKnownBadGameTermTranslation('Load', '负荷')).toBe('读取')
    expect(fixKnownBadGameTermTranslation('Load', '供电量')).toBe('读取')
    expect(fixKnownBadGameTermTranslation('Load', '负载')).toBe('读取')
    expect(fixKnownBadGameTermTranslation('Options', '期权')).toBe('设置')

    expect(fixKnownBadGameTermTranslation('セーブ', '节省')).toBe('保存')
    expect(fixKnownBadGameTermTranslation('ロード', '装载')).toBe('读取')

    expect(fixKnownBadGameTermTranslation('Save', '【节省】')).toBe('【保存】')
    expect(fixKnownBadGameTermTranslation('Save', '节省...')).toBe('保存...')

    expect(fixKnownBadGameTermTranslation('Save money for later', '节省钱留作以后')).toBeNull()
  })

  it('checks if an engine is considered low-rank machine translation', () => {
    expect(isMachineTranslationEngine('live:tencent')).toBe(true)
    expect(isMachineTranslationEngine('live:google')).toBe(true)
    expect(isMachineTranslationEngine('live:openai')).toBe(true)
    expect(isMachineTranslationEngine('machine:test')).toBe(true)

    expect(isMachineTranslationEngine('manual')).toBe(false)
    expect(isMachineTranslationEngine('manual:optimize')).toBe(false)
    expect(isMachineTranslationEngine('import')).toBe(false)
    expect(isMachineTranslationEngine('import:patch')).toBe(false)
    expect(isMachineTranslationEngine('live:optimize')).toBe(false)
    expect(isMachineTranslationEngine('live:optimize:terms')).toBe(false)
    expect(isAlreadyOptimizedEngine('live:optimize:agent')).toBe(true)
  })

  it('filters short entity categories and length', () => {
    expect(
      isShortEntityItem({
        id: '1',
        src: 'Potion',
        zh: '药水',
        meta: { category: 'item', label: 'item' },
      })
    ).toBe(true)
    expect(
      isShortEntityItem({
        id: '2',
        src: 'A very long dialogue line that should not be treated as a short entity name at all',
        zh: 'x',
        meta: { category: 'dialogue', label: 'dlg' },
      })
    ).toBe(false)
    expect(
      isShortEntityItem({
        id: '3',
        src: 'Healing herb description text that is long',
        zh: 'x',
        meta: { category: 'item_desc', label: 'desc' },
      })
    ).toBe(false)
  })
})

describe('Idle Detection and Request Throttling', () => {
  it('detects live translation activity and marks system as not idle when game is online', () => {
    const mockPresence = getGamePresence as jest.Mock
    mockPresence.mockReturnValue({ online: true })

    recordLiveTranslateActivity()
    const status = isSystemIdleForOptimization(5000)
    expect(status.isIdle).toBe(false)
    expect(status.reason).toContain('Recent in-game')
  })

  it('reports idle when game is offline regardless of past translate activity', () => {
    const mockPresence = getGamePresence as jest.Mock
    mockPresence.mockReturnValue({ online: false })

    const status = isSystemIdleForOptimization(5000)
    expect(status.isIdle).toBe(true)
    expect(status.reason).toBe('Game offline')
  })

  it('tracks in-flight live translate requests', async () => {
    const mockPresence = getGamePresence as jest.Mock
    mockPresence.mockReturnValue({ online: true })

    let statusDuringRequest: { isIdle: boolean; reason: string } | null = null
    await trackLiveTranslateRequest(async () => {
      statusDuringRequest = isSystemIdleForOptimization(5000)
    })

    expect(statusDuringRequest).toEqual({
      isIdle: false,
      reason: 'Live translate requests in flight',
    })
  })
})

describe('Batch Optimization and Term Application Service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('scans game translations and identifies term fixes and polish candidates', () => {
    const mockLoad = loadGameTranslationRecords as jest.Mock
    mockLoad.mockReturnValue([
      { src: 'Save', zh: '节省', engine: 'live:tencent' },
      { src: 'Load', zh: '装载', engine: 'live:google' },
      { src: 'Save', zh: '节省', engine: 'manual' },
      { src: 'Hello world', zh: '你好世界', engine: 'live:tencent' },
    ])

    const res = scanGameTranslationsForOptimization('/mock/root')
    expect(res.totalRecords).toBe(4)
    expect(res.termFixCandidates).toHaveLength(2)
    expect(res.termFixCandidates[0]).toEqual({
      src: 'Save',
      currentZh: '节省',
      suggestedZh: '保存',
      engine: 'live:tencent',
    })
    expect(res.termFixCandidates[1]).toEqual({
      src: 'Load',
      currentZh: '装载',
      suggestedZh: '读取',
      engine: 'live:google',
    })
    expect(res.polishCandidatesCount).toBe(1)
  })

  it('scans short-entities from extracted items joined with translations', () => {
    ;(loadExtractedItems as jest.Mock).mockReturnValue([
      { id: 'a', src: 'Save', zh: '节省', meta: { category: 'item', label: 'item' } },
      { id: 'b', src: 'Hero', zh: '英雄', meta: { category: 'actor', label: 'actor' } },
      { id: 'c', src: 'Long dialogue about the world', zh: '长对白', meta: { category: 'dialogue', label: 'dlg' } },
    ])
    ;(loadGameTranslationRecords as jest.Mock).mockReturnValue([
      { src: 'Save', zh: '节省', engine: 'live:google' },
      { src: 'Hero', zh: '英雄', engine: 'live:google' },
    ])

    const res = scanGameTranslationsForOptimization('/mock/root', { scope: 'short-entities' })
    expect(res.scope).toBe('short-entities')
    expect(res.totalCandidates).toBe(2)
    expect(res.termFixCandidates).toEqual([expect.objectContaining({ src: 'Save', suggestedZh: '保存', category: 'item' })])
  })

  it('applies term fixes and writes back to cache and ndjson', () => {
    const mockLoad = loadGameTranslationRecords as jest.Mock
    mockLoad.mockReturnValue([{ src: 'Save', zh: '节省', engine: 'live:tencent' }])

    const res = applyGameTermFixes('/mock/root')
    expect(res.fixedCount).toBe(1)
    expect(res.items).toEqual([{ src: 'Save', oldZh: '节省', newZh: '保存' }])
  })

  it('batch optimizes translations using term fixes and engine polish', async () => {
    const mockLoad = loadGameTranslationRecords as jest.Mock
    mockLoad.mockReturnValue([
      { src: 'Save', zh: '节省', engine: 'live:tencent' },
      { src: 'Hero speech', zh: '英雄演说', engine: 'live:tencent' },
    ])

    const mockLive = liveTranslateTexts as jest.Mock
    mockLive.mockResolvedValue({
      items: [{ src: 'Hero speech', zh: '勇者的演讲', engine: 'google' }],
    })

    const res = await batchOptimizeTranslations({
      contentRoot: '/mock/root',
      engines: ['google'],
      requireIdle: false,
    })

    expect(res.totalProcessed).toBe(2)
    expect(res.optimizedCount).toBe(2)
    expect(res.items).toEqual([
      { src: 'Save', oldZh: '节省', newZh: '保存', engine: OPTIMIZE_ENGINE_TERMS },
      { src: 'Hero speech', oldZh: '英雄演说', newZh: '勇者的演讲', engine: OPTIMIZE_ENGINE_AGENT },
    ])
  })

  it('pauses short-entity optimization when live translate is in flight', async () => {
    const mockPresence = getGamePresence as jest.Mock
    mockPresence.mockReturnValue({ online: true })
    recordLiveTranslateActivity()

    const res = await runShortEntityOptimization({ contentRoot: '/mock/root', requireIdle: true })
    expect(res.pausedReason).toBeTruthy()
    expect(res.totalProcessed).toBe(0)
  })

  it('runs short-entity term fixes when idle', async () => {
    const mockPresence = getGamePresence as jest.Mock
    mockPresence.mockReturnValue({ online: false })
    ;(loadExtractedItems as jest.Mock).mockReturnValue([{ id: 'a', src: 'Save', zh: '节省', meta: { category: 'item', label: 'item' } }])
    ;(loadGameTranslationRecords as jest.Mock).mockReturnValue([{ src: 'Save', zh: '节省', engine: 'live:google' }])

    const res = await runShortEntityOptimization({ contentRoot: '/mock/root', requireIdle: true })
    expect(res.termFixed).toBe(1)
    expect(res.items[0]).toMatchObject({ src: 'Save', newZh: '保存', engine: OPTIMIZE_ENGINE_TERMS })
  })
})
