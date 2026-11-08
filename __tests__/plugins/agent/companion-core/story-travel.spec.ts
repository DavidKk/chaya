jest.mock('@/plugins/mv/src/agent/handlers', () => ({ readAgentGameState: () => ({ nearbyEvents: [] }) }))
jest.mock('@/plugins/mv/src/agent/interact', () => ({ interactEvent: jest.fn(async () => ({ outcome: 'choice' })) }))
jest.mock('@/plugins/mv/src/agent/game-control', () => ({ planMapRoute: jest.fn(() => ({ status: 'reachable', eventBoundaryIds: [] })) }))

import { planMapRoute } from '@/plugins/mv/src/agent/game-control'
import { interactEvent } from '@/plugins/mv/src/agent/interact'
import { STORY_BENCHMARK_GAME_ID } from '@/plugins/mv/src/agent/runtime/companion-core/story-benchmark'
import { StoryContextStore } from '@/plugins/mv/src/agent/runtime/companion-core/story-context'
import { StoryDriver } from '@/plugins/mv/src/agent/runtime/companion-core/story-driver'
import { StoryExplorationPlanner } from '@/plugins/mv/src/agent/runtime/companion-core/story-exploration'
import { StoryFailureMemory } from '@/plugins/mv/src/agent/runtime/companion-core/story-failure-memory'
import { computeGuidanceScore } from '@/plugins/mv/src/agent/runtime/companion-core/story-guidance'
import { StoryPuzzleSolver } from '@/plugins/mv/src/agent/runtime/companion-core/story-puzzle-solver'
import { isStoryMapExit } from '@/plugins/mv/src/agent/runtime/companion-core/story-transfer'
import { createAgentRuntimeIdentity } from '@/plugins/mv/src/agent/runtime/identity'

type Command = { code: number; parameters: any[]; indent?: number }

function mapEvent(id: number, name: string, commands: Command[]) {
  return {
    _eventId: id,
    _x: id,
    _y: 0,
    _pageIndex: 0,
    _trigger: 0,
    eventId: () => id,
    event: () => ({ name }),
    list: () => commands,
  }
}

describe('story travel boundaries', () => {
  const engine = globalThis as any
  const keys = [
    '$gameMap',
    '$gameMessage',
    '$gameSystem',
    '$gameParty',
    '$gamePlayer',
    '$gameVariables',
    '$gameSwitches',
    '$dataCommonEvents',
    '__CHAYA_STORY_QUEST_CONTEXT__',
    '__CHAYA_STORY_FAILURE_MEMORY__',
  ]
  let previous: unknown[]
  let events: ReturnType<typeof mapEvent>[]
  let planner: StoryExplorationPlanner
  const up = { code: 201, parameters: [0, 5] }
  const io = { press: jest.fn(), readState: jest.fn(), interrupted: () => false }

  beforeEach(() => {
    previous = keys.map((key) => engine[key])
    keys.forEach((key) => delete engine[key])
    createAgentRuntimeIdentity('another-game')
    events = [mapEvent(1, 'Upstairs', [up]), mapEvent(2, 'Chest', [{ code: 125, parameters: [0, 0, 10] }])]
    engine.$gameSystem = {}
    engine.$gameParty = { leader: () => null }
    engine.$gamePlayer = { x: 0, y: 0 }
    engine.$gameMap = { mapId: () => 6, events: () => events, event: (id: number) => events.find((event) => event._eventId === id) }
    jest.mocked(interactEvent).mockClear()
    jest
      .mocked(planMapRoute)
      .mockReset()
      .mockReturnValue({ status: 'reachable', eventBoundaryIds: [] } as any)
    planner = new StoryExplorationPlanner()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete engine[key]
      else engine[key] = previous[index]
    })
  })

  test('ranks local work ahead of a portal even if the portal has dialogue and rewards', () => {
    events[0].list = () => [{ code: 101, parameters: [] }, { code: 125, parameters: [0, 0, 10] }, up]
    expect(planner.findCandidateBranches(6, { x: 0, y: 0 }).map(({ eventId, kind }) => [eventId, kind])).toEqual([
      [2, 'chest'],
      [1, 'transfer'],
    ])
  })

  test('does not read a command list from an event with no active page', () => {
    const list = jest.fn(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'list')")
    })
    expect(isStoryMapExit({ _pageIndex: -1, list }, 6)).toBe(false)
    expect(isStoryMapExit({ page: () => undefined, list }, 6)).toBe(false)
    expect(isStoryMapExit({ _erased: true, list }, 6)).toBe(false)
    expect(list).not.toHaveBeenCalled()
  })

  test('does not treat unresolved transfer destinations as map exits', () => {
    events[0].list = () => [{ code: 201, parameters: [1, 9] }]
    engine.$gameVariables = { value: () => 0 }
    expect(isStoryMapExit(events[0], 6)).toBe(false)
    expect(planner.isEligible(6, 1)).toBe(true)
    events[0].list = () => [
      { code: 102, indent: 0, parameters: [['上楼', '留下']] },
      { code: 201, parameters: [1, 9] },
    ]
    planner.setPlayerGuidance('只探索当前这一层')
    expect(planner.isEligible(6, 1)).toBe(true)
  })

  test('reclassifies benchmark exits and keeps available local work ahead of them', () => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    events = [mapEvent(26, 'EV026', [up]), mapEvent(2, 'Chest', [{ code: 125, parameters: [0, 0, 10] }])]
    engine.$gameSwitches = { value: () => true }
    engine.$gamePlayer = { x: 20, y: 2 }
    engine.$gameMap.mapId = () => 5
    events[0].list = () => [{ code: 201, parameters: [0, 6] }]
    const candidates = planner.findCandidateBranches(5, { x: 20, y: 2 })
    expect(candidates[0]).toMatchObject({ eventId: 2, kind: 'chest' })
    expect(candidates.find((candidate) => candidate.eventId === 26)?.kind).toBe('transfer')
  })

  test.each(['不要上上一层', '不要上楼', "don't go upstairs", 'не идти наверх', '只探索当前这一层', '不要离开当前地图'])(
    'enforces "%s" during scanning, fallback and final execution',
    async (guidance) => {
      planner.findCandidateBranches(6, { x: 0, y: 0 }, guidance)
      expect(planner.isEligible(6, 1)).toBe(false)
      expect(planner.findFallbackTarget(6, { x: 0, y: 0 })?.eventId).toBe(2)
      await expect(planner.executeTarget({ eventId: 1, x: 1, y: 0, name: 'Upstairs', kind: 'guide', priority: 999 }, io)).resolves.toMatchObject({ outcome: 'ineligible' })
      expect(interactEvent).not.toHaveBeenCalled()
      expect(StoryFailureMemory.history(6, 1)).toEqual([])
    }
  )

  test('keeps the final execution guard local-first even for a stale model or guide target', async () => {
    await expect(planner.executeTarget({ eventId: 1, x: 1, y: 0, name: 'Upstairs', kind: 'guide', priority: 999 }, io)).resolves.toMatchObject({ outcome: 'ineligible' })
    expect(interactEvent).not.toHaveBeenCalled()
  })

  test('does not turn a negative instruction into a score bonus for its forbidden target', () => {
    expect(computeGuidanceScore({ eventId: 1, kind: 'transfer', name: '楼梯', hint: '出口', x: 1, y: 0, priority: 20 }, '不要往上走楼梯和出口', { x: 0, y: 1 })).toBe(0)
  })

  test('keeps return exits blocked after two minutes but recognizes a nearby forward exit', () => {
    StoryContextStore.recordTransition({ fromMapId: 5, toMapId: 6, arrivalPos: { x: 1, y: 0 }, timestamp: Date.now() - 600_000 })
    events.push(mapEvent(3, 'Downstairs', [{ code: 201, parameters: [0, 7] }]))
    expect(planner.findCandidateBranches(6, { x: 0, y: 0 }).map((candidate) => candidate.eventId)).toEqual([2, 3])
    expect(StoryContextStore.isBacktrackPortal(6, 1)).toBe(true)
    expect(StoryContextStore.isBacktrackPortal(6, 3)).toBe(false)
  })

  test('resolves common-event and variable-mode transfers when identifying return exits', () => {
    events[0].list = () => [{ code: 117, parameters: [4] }]
    engine.$dataCommonEvents = {
      4: {
        list: [
          { code: 201, parameters: [1, 9] },
          { code: 117, parameters: [4] },
        ],
      },
    }
    engine.$gameVariables = { value: (id: number) => (id === 9 ? 5 : 0) }
    StoryContextStore.recordTransition({ fromMapId: 5, toMapId: 6, timestamp: Date.now() - 600_000 })
    expect(planner.isEligible(6, 1)).toBe(false)
    expect(planner.findFallbackTarget(6, { x: 0, y: 0 })?.eventId).toBe(2)
  })

  test('allows a later explicit return directive while retaining unrelated failure history', () => {
    StoryContextStore.recordTransition({ fromMapId: 5, toMapId: 6, timestamp: Date.now() })
    StoryFailureMemory.record(6, 2, 'no_effect', 'Chest remains closed')
    planner.setPlayerGuidance('不要上楼')
    expect(planner.isEligible(6, 1)).toBe(false)
    planner.setPlayerGuidance('不要上楼\n现在可以返回上一层')
    expect(planner.findNextTarget(6, { x: 0, y: 0 })?.eventId).toBe(1)
    expect(StoryFailureMemory.blocked(6, 2)).toBeDefined()
  })

  test('does not use an exit as an intermediate prerequisite for local benchmark work', () => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    events = [mapEvent(9, 'Master Boris', [{ code: 101, parameters: [] }]), mapEvent(1, 'Upstairs', [up])]
    jest.mocked(planMapRoute).mockImplementation((_, id) => ({ status: id === 9 ? 'event_boundary' : 'reachable', eventBoundaryIds: id === 9 ? [1] : [] }) as any)
    expect(planner.findCandidateBranches(6, { x: 0, y: 0 }, '不要上楼').some((candidate) => candidate.eventId === 1)).toBe(false)
  })

  test('filters exits from model candidates and rejects a model that still invents one', async () => {
    const complete = jest.fn(async () => ({ role: 'assistant' as const, content: '{"targetEventId":1}' }))
    planner = new StoryExplorationPlanner(new StoryPuzzleSolver({ complete, profileId: 'p', model: 'm' }))
    await expect(planner.resolvePuzzleTarget(6, { x: 0, y: 0 })).resolves.toBeNull()
    expect(complete.mock.calls[0]).toBeDefined()
    const prompt = JSON.stringify(complete.mock.calls[0])
    expect(prompt).toContain('ID 2:')
    expect(prompt).not.toContain('ID 1:')
  })

  test('rechecks policy after a pending puzzle response', async () => {
    events = events.slice(0, 1)
    let finish!: (response: any) => void
    const complete = jest.fn(
      () =>
        new Promise<any>((resolve) => {
          finish = resolve
        })
    )
    planner = new StoryExplorationPlanner(new StoryPuzzleSolver({ complete, profileId: 'p', model: 'm' }))
    const pending = planner.resolvePuzzleTarget(6, { x: 0, y: 0 })
    planner.setPlayerGuidance('不要上楼')
    finish({ role: 'assistant', content: '{"targetEventId":1}' })
    await expect(pending).resolves.toBeNull()
  })

  test('cancelling a pending transfer through policy does not create a game failure', async () => {
    events = events.slice(0, 1)
    await planner.executeTarget({ eventId: 1, kind: 'transfer', x: 1, y: 0, name: 'Upstairs', priority: 20 }, io)
    expect(planner.pendingEventId).toBe(1)
    planner.setPlayerGuidance('不要上楼')
    expect(planner.settlePendingTarget()).toBeNull()
    expect(StoryFailureMemory.history(6, 1)).toEqual([])
    planner.setPlayerGuidance('不要上楼\n现在可以上楼')
    expect(planner.isEligible(6, 1)).toBe(true)
  })

  test.each(['上楼吗？', 'Go upstairs?', 'Подняться наверх?'])('declines "%s" through the actual menu without marking failure', async (question) => {
    engine.$gameMessage = { allText: () => question, choiceCancelType: () => 1 }
    const driver = new StoryDriver()
    driver.setCurrentTargetEventId(1)
    await expect(driver.resolveChoice(['是。', '否。'], 6, '不要上楼')).resolves.toBe(1)
    expect(StoryFailureMemory.history(6, 1)).toEqual([])
    const window = { active: true, select: jest.fn(), processOk: jest.fn() }
    expect(driver.applyChoiceSelection({ _choiceWindow: window }, 0)).toBe(false)
    expect(window.processOk).not.toHaveBeenCalled()
  })

  test('allows a forward yes when the same event also has a backtrack destination', async () => {
    const choices = ['是。', '否。']
    events[0].list = () => [
      { code: 102, indent: 0, parameters: [choices] },
      { code: 402, indent: 0, parameters: [0] },
      { code: 201, indent: 1, parameters: [0, 7] },
      { code: 402, indent: 0, parameters: [1] },
      { code: 201, indent: 1, parameters: [0, 5] },
      { code: 404, indent: 0, parameters: [] },
    ]
    StoryContextStore.recordTransition({ fromMapId: 5, toMapId: 6, arrivalPos: { x: 1, y: 0 }, timestamp: Date.now() })
    engine.$gameMessage = { allText: () => '离开这里吗？', choiceCancelType: () => 1 }
    const driver = new StoryDriver()
    driver.setCurrentTargetEventId(1)
    await expect(driver.resolveChoice(choices, 6, '可以离开')).resolves.toBe(0)
  })

  test('blocks a yes/no transfer hidden inside a common event with no direction in its question', async () => {
    const choices = ['是。', '否。']
    events[0].list = () => [
      { code: 102, indent: 0, parameters: [choices] },
      { code: 402, indent: 0, parameters: [0] },
      { code: 117, indent: 1, parameters: [4] },
      { code: 402, indent: 0, parameters: [1] },
      { code: 404, indent: 0, parameters: [] },
    ]
    engine.$dataCommonEvents = { 4: { list: [up] } }
    engine.$gameMessage = { allText: () => '继续吗？', choiceCancelType: () => 1 }
    const driver = new StoryDriver()
    driver.setCurrentTargetEventId(1)
    await expect(driver.resolveChoice(choices, 6, '只探索当前这一层')).resolves.toBe(1)
  })

  test('reports a policy conflict if every branch leaves the map', async () => {
    const driver = new StoryDriver()
    await expect(driver.resolveChoice(['Go upstairs', 'Go downstairs'], 6, '不要离开当前地图')).resolves.toBe(-2)
    expect(StoryFailureMemory.history(6)).toEqual([])
  })
})
