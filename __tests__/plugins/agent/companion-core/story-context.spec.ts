import { STORY_BENCHMARK_GAME_ID } from '@/plugins/mv/src/agent/runtime/companion-core/story-benchmark'
import { StoryContextStore } from '@/plugins/mv/src/agent/runtime/companion-core/story-context'
import { StoryExplorationPlanner } from '@/plugins/mv/src/agent/runtime/companion-core/story-exploration'
import { createAgentRuntimeIdentity } from '@/plugins/mv/src/agent/runtime/identity'

describe('StoryContextStore & StoryExplorationPlanner', () => {
  let previousDataMap: unknown
  let previousMapInfos: unknown

  beforeEach(() => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    const g = globalThis as any
    previousDataMap = g.$dataMap
    previousMapInfos = g.$dataMapInfos
    g.$dataMap = {}
    delete g.$dataMapInfos
    delete g.__CHAYA_STORY_QUEST_CONTEXT__
    delete g.$gameMap
    delete g.$gameVariables
    delete g.$gameSwitches
    delete g.$gameParty
  })

  afterEach(() => {
    const engine = globalThis as any
    if (previousDataMap === undefined) delete engine.$dataMap
    else engine.$dataMap = previousDataMap
    if (previousMapInfos === undefined) delete engine.$dataMapInfos
    else engine.$dataMapInfos = previousMapInfos
  })

  test.each([null, undefined])('records transitions and derives context while map data is %s', (dataMap) => {
    createAgentRuntimeIdentity('another-game')
    const engine = globalThis as any
    engine.$dataMap = dataMap
    engine.$dataMapInfos = [null, { name: 'Guild' }]
    const displayName = jest.fn(() => engine.$dataMap.displayName)
    engine.$gameMap = { mapId: () => 1, displayName }

    StoryContextStore.recordTransition({ fromMapId: 6, toMapId: 1, timestamp: Date.now() })

    expect(StoryContextStore.getRecentGlobalHistory()[0]).toMatchObject({ mapId: 1, mapName: 'Guild', kind: 'transfer' })
    expect(StoryContextStore.get(1).mapName).toBe('Guild')
    expect(displayName).not.toHaveBeenCalled()
  })

  test('uses a map ID fallback during transitions when map metadata is unavailable', () => {
    const engine = globalThis as any
    engine.$dataMap = null
    engine.$gameMap = { mapId: () => 99, displayName: () => engine.$dataMap.displayName }

    StoryContextStore.recordGlobalAction(99, 'Explored')

    expect(StoryContextStore.getRecentGlobalHistory()[0].mapName).toBe('地图 99')
    expect(StoryContextStore.get(99).mapName).toBe('地图 99')
  })

  test.each([1, 4, 5, 6])('keeps map %s context generic in unrelated games', (mapId) => {
    createAgentRuntimeIdentity('another-game')
    const engine = globalThis as any
    engine.$gameMap = { mapId: () => mapId, displayName: () => 'Unrelated map' }
    engine.$gameVariables = { value: () => 3 }
    engine.$gameSwitches = { value: () => true }
    const context = StoryContextStore.get(mapId)
    expect(context.phase).toBe('exploration')
    expect(context.chestsTotal).toBe(0)
    expect(context.activeObjective).not.toMatch(/试炼|拉维尔娜|匕首/)
  })

  test('derives Map 6 benchmark quest context with 3 trial chests', () => {
    const g = globalThis as any
    g.$gameVariables = { value: (idx: number) => (idx === 6 ? 1 : 0) }
    g.$gameSwitches = { value: () => false }
    g.$gameMap = {
      mapId: () => 6,
      displayName: () => '试炼迷宫深处',
      event: (id: number) => ({ _x: 14, _y: 7, _pageIndex: id === 7 ? 1 : 0, _erased: false }),
    }

    const ctx = StoryContextStore.get(6)
    expect(ctx.mapId).toBe(6)
    expect(ctx.mapName).toBe('试炼迷宫深处')
    expect(ctx.phase).toBe('chest_trial')
    expect(ctx.chestsTotal).toBe(3)
    expect(ctx.activeObjective).toContain('开锁试炼')
  })

  test('persists opened chests and actions across agent swaps', () => {
    const g = globalThis as any
    g.$gameVariables = { value: (idx: number) => (idx === 6 ? 2 : 0) }
    g.$gameSwitches = { value: () => false }
    g.$gameMap = {
      mapId: () => 6,
      displayName: () => '试炼迷宫深处',
      event: () => null,
    }

    StoryContextStore.recordChestOpened(6, 8, '试炼宝箱 8')
    StoryContextStore.recordChestOpened(6, 6, '试炼宝箱 6')

    const ctxB = StoryContextStore.get(6)
    expect(ctxB.chestsOpened).toEqual([8, 6])
    expect(ctxB.lastAction).toContain('开启了宝箱 试炼宝箱 6')

    const promptSummary = StoryContextStore.formatSummaryForPrompt(6)
    expect(promptSummary).toContain('已开启 2/3')
    expect(promptSummary).toContain('试炼宝箱 7(14, 7)')
    expect(ctxB.remainingChestPositions.map((chest) => chest.id)).toEqual([7])
    expect(promptSummary).toContain('【历史行动与已完成事项（之前做过了什么）】')
  })

  test('keeps prior map facts isolated after a transfer', () => {
    const engine = globalThis as any
    engine.$dataMapInfos = { 6: { name: 'Trial' }, 5: { name: 'Sewer' } }
    engine.$gameMap = { mapId: () => 6, displayName: () => 'Trial', event: () => null }
    StoryContextStore.get(6)
    const event = jest.fn(() => ({ _pageIndex: 1 }))
    engine.$gameMap = { mapId: () => 5, displayName: () => 'Sewer', event }

    StoryContextStore.recordGlobalAction(6, 'Left trial')
    const context = StoryContextStore.get(6)

    expect(context.chestsOpened).toEqual([])
    expect(context.remainingChestPositions.map((chest) => chest.id)).toEqual([7, 8, 6])
    expect(StoryContextStore.getRecentGlobalHistory().at(-1)?.mapName).toBe('Trial')
    expect(event).not.toHaveBeenCalled()
  })

  test('tracks map transitions and identifies backtrack portals', () => {
    const g = globalThis as any
    g.$gameMap = {
      mapId: () => 6,
      displayName: () => '试炼迷宫深处',
      event: (id: number) => {
        if (id === 12) {
          // Entry stairway right near arrival point (8, 7) that transfers to Map 5
          return {
            _x: 8,
            _y: 5,
            list: () => [{ code: 201, parameters: [0, 5, 20, 3, 2, 0] }],
          }
        }
        if (id === 58) {
          // Forward statue event on Map 6
          return { _x: 3, _y: 2, list: () => [] }
        }
        return null
      },
    }

    StoryContextStore.recordTransition({
      fromMapId: 5,
      toMapId: 6,
      arrivalPos: { x: 8, y: 7 },
      timestamp: Date.now(),
    })

    expect(StoryContextStore.isBacktrackPortal(6, 12)).toBe(true)
    expect(StoryContextStore.isBacktrackPortal(6, 58)).toBe(false)

    const summary = StoryContextStore.formatSummaryForPrompt(6)
    expect(summary).toContain('刚从地图 5 传送进入当前地图，禁止走回头路返回上一层')
  })

  test('guides player to Laverna Statue on Map 6 when s27 is set (not Map 5 stairway)', () => {
    const g = globalThis as any
    g.$gameSwitches = { value: (id: number) => id === 27 || id === 32 }
    g.$gameVariables = { value: (id: number) => (id === 7 ? 4 : 3) }
    g.$gameParty = { leader: () => null }
    g.$gameMap = { mapId: () => 6, displayName: () => '试炼迷宫深处' }

    const ctx = StoryContextStore.get(6)
    expect(ctx.phase).toBe('laverna_blessing')
    expect(ctx.activeObjective).toContain('拉维尔娜神坛')

    const planner = new StoryExplorationPlanner()
    const target = planner.getBenchmarkGuideTarget(6, { x: 11, y: 7 })

    expect(target).not.toBeNull()
    expect(target!.eventId).toBe(58)
    expect(target!.hint).toContain('拉维尔娜神坛')
    expect(target!.eventId).not.toBe(12)
  })

  test('keeps the offering objective active until all four offerings are collected', () => {
    const engine = globalThis as any
    engine.$gameMap = { mapId: () => 6 }
    engine.$gameSwitches = { value: (id: number) => id === 27 }
    engine.$gameVariables = { value: (id: number) => (id === 7 ? 2 : 3) }

    expect(StoryContextStore.get(6)).toMatchObject({ phase: 'gather_offerings', activeObjective: expect.stringContaining('2/4') })
  })

  test('tracks and clears unreachable event filtering', () => {
    StoryContextStore.recordUnreachable(6, 26)
    StoryContextStore.recordUnreachable(6, 30)

    expect(StoryContextStore.isUnreachable(6, 26)).toBe(true)
    expect(StoryContextStore.isUnreachable(6, 30)).toBe(true)
    expect(StoryContextStore.isUnreachable(6, 7)).toBe(false)

    const summary = StoryContextStore.formatSummaryForPrompt(6)
    expect(summary).toContain('ID 26')
    expect(summary).toContain('ID 30')

    StoryContextStore.clearUnreachable(6)
    expect(StoryContextStore.isUnreachable(6, 26)).toBe(false)
  })

  test('records and queries lock prerequisites by level threshold', () => {
    StoryContextStore.recordLockPrerequisite(6, 52, 'chest', 16, 13)
    StoryContextStore.recordLockPrerequisite(6, 20, 'chest', 14, 13)
    StoryContextStore.recordLockPrerequisite(6, 24, 'trap', 15, 13)

    const p52 = StoryContextStore.getLockPrerequisite(6, 52)
    expect(p52).toMatchObject({ mapId: 6, eventId: 52, kind: 'chest', requiredLevel: 16, lastAttemptLevel: 13 })
    expect(StoryContextStore.formatSummaryForPrompt(6)).toContain('宝箱需要开锁等级 16')

    // At level 13: none unlocked
    expect(StoryContextStore.getEligibleUnlockedTargets(6, 13)).toEqual([])

    // At level 14: event 20 unlocked
    const at14 = StoryContextStore.getEligibleUnlockedTargets(6, 14)
    expect(at14.map((p) => p.eventId)).toEqual([20])

    // At level 16: all three unlocked
    const at16 = StoryContextStore.getEligibleUnlockedTargets(6, 16)
    expect(at16.map((p) => p.eventId).sort()).toEqual([20, 24, 52])

    StoryContextStore.clearLockPrerequisite(6, 52)
    expect(StoryContextStore.getLockPrerequisite(6, 52)).toBeUndefined()
  })
})
