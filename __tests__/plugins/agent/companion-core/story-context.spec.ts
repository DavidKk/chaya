import { StoryContextStore } from '@/plugins/mv/src/agent/runtime/companion-core/story-context'
import { StoryExplorationPlanner } from '@/plugins/mv/src/agent/runtime/companion-core/story-exploration'
import { ensureSafeSceneManagerPop } from '@/plugins/mv/src/agent/runtime/companion-core/story-runtime'

describe('StoryContextStore & StoryExplorationPlanner', () => {
  beforeEach(() => {
    const g = globalThis as any
    delete g.__CHAYA_STORY_QUEST_CONTEXT__
    delete g.$gameMap
    delete g.$gameVariables
    delete g.$gameSwitches
    delete g.$gameParty
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
    expect(promptSummary).toContain('【历史行动与已完成事项（之前做过了什么）】')
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
    g.$gameVariables = { value: () => 3 }
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

  test('ensureSafeSceneManagerPop prevents game exit on empty scene stack', () => {
    const g = globalThis as any
    let exitCalled = false
    let gotoTarget: any = null
    const dummySceneMap = { name: 'Scene_Map' }
    g.Scene_Map = dummySceneMap

    g.SceneManager = {
      _stack: [],
      exit: () => {
        exitCalled = true
      },
      goto: (scene: any) => {
        gotoTarget = scene
      },
      pop: function (this: any) {
        if (this._stack.length > 0) {
          this.goto(this._stack.pop())
        } else {
          this.exit()
        }
      },
    }

    ensureSafeSceneManagerPop()
    g.SceneManager.pop()

    expect(exitCalled).toBe(false)
    expect(gotoTarget).toBe(dummySceneMap)
  })
})
