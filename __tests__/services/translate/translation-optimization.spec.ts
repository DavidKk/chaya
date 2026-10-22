jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/services/runtime/presence', () => ({
  getGamePresence: jest.fn(() => ({ online: false })),
}))
jest.mock('@/services/translate/game-records', () => ({
  loadGameTranslationRecords: jest.fn(),
}))
jest.mock('@/services/translate/live-translate', () => ({
  appendGameNdjson: jest.fn(),
  liveTranslateTexts: jest.fn(),
  resolveBoundContentRoot: jest.fn(() => '/mock/game/content'),
}))
jest.mock('@/services/translate/shared-cache', () => ({
  openSharedCache: jest.fn(() => ({
    upsertOptimizeMany: jest.fn(),
    close: jest.fn(),
  })),
}))

import { fixKnownBadGameTermTranslation, lookupGameTerm } from '@/lib/translate/game-terms'
import { getGamePresence } from '@/services/runtime/presence'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { liveTranslateTexts } from '@/services/translate/live-translate'
import {
  applyGameTermFixes,
  batchOptimizeTranslations,
  isMachineTranslationEngine,
  isSystemIdleForOptimization,
  recordLiveTranslateActivity,
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
    // English source flaws
    expect(fixKnownBadGameTermTranslation('Save', '节省')).toBe('保存')
    expect(fixKnownBadGameTermTranslation('Save', '拯救')).toBe('保存')
    expect(fixKnownBadGameTermTranslation('Load', '装载')).toBe('读取')
    expect(fixKnownBadGameTermTranslation('Load', '负荷')).toBe('读取')
    expect(fixKnownBadGameTermTranslation('Options', '期权')).toBe('设置')

    // Japanese source flaws
    expect(fixKnownBadGameTermTranslation('セーブ', '节省')).toBe('保存')
    expect(fixKnownBadGameTermTranslation('ロード', '装载')).toBe('读取')

    // Preserves control codes / decorations
    expect(fixKnownBadGameTermTranslation('Save', '【节省】')).toBe('【保存】')
    expect(fixKnownBadGameTermTranslation('Save', '节省...')).toBe('保存...')

    // Does not incorrectly alter non-game term phrases
    expect(fixKnownBadGameTermTranslation('Save money for later', '节省钱留作以后')).toBeNull()
  })

  it('checks if an engine is considered low-rank machine translation', () => {
    expect(isMachineTranslationEngine('live:tencent')).toBe(true)
    expect(isMachineTranslationEngine('live:google')).toBe(true)
    expect(isMachineTranslationEngine('live:openai')).toBe(true)
    expect(isMachineTranslationEngine('machine:test')).toBe(true)

    // Protected high-rank engines
    expect(isMachineTranslationEngine('manual')).toBe(false)
    expect(isMachineTranslationEngine('manual:optimize')).toBe(false)
    expect(isMachineTranslationEngine('import')).toBe(false)
    expect(isMachineTranslationEngine('import:patch')).toBe(false)
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
      { src: 'Save', zh: '节省', engine: 'manual' }, // ignored because manual
      { src: 'Hello world', zh: '你好世界', engine: 'live:tencent' }, // polish candidate
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
    })

    expect(res.totalProcessed).toBe(2)
    expect(res.optimizedCount).toBe(2)
    expect(res.items).toEqual([
      { src: 'Save', oldZh: '节省', newZh: '保存', engine: 'builtin:terms' },
      { src: 'Hero speech', oldZh: '英雄演说', newZh: '勇者的演讲', engine: 'google' },
    ])
  })
})
