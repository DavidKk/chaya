jest.mock('@/plugins/mv/src/agent/handlers', () => ({ readAgentGameState: () => ({ nearbyEvents: [] }) }))
jest.mock('@/plugins/mv/src/agent/interact', () => ({ interactEvent: jest.fn(async () => ({ outcome: 'done' })) }))

import * as gameControl from '@/plugins/mv/src/agent/game-control'
import { interactEvent } from '@/plugins/mv/src/agent/interact'
import type { CompanionComplete } from '@/plugins/mv/src/agent/runtime/companion-chat'
import { STORY_BENCHMARK_GAME_ID } from '@/plugins/mv/src/agent/runtime/companion-core/story-benchmark'
import { StoryContextStore } from '@/plugins/mv/src/agent/runtime/companion-core/story-context'
import { StoryExplorationPlanner } from '@/plugins/mv/src/agent/runtime/companion-core/story-exploration'
import { StoryFailureMemory } from '@/plugins/mv/src/agent/runtime/companion-core/story-failure-memory'
import { StoryPuzzleSolver } from '@/plugins/mv/src/agent/runtime/companion-core/story-puzzle-solver'
import { createAgentRuntimeIdentity } from '@/plugins/mv/src/agent/runtime/identity'

function npc(eventId: number) {
  return {
    _eventId: eventId,
    _x: 1,
    _y: 1,
    _pageIndex: 0,
    _erased: false,
    _trigger: 0,
    eventId: () => eventId,
    event: () => ({ name: 'Guide' }),
    list: () => [{ code: 101, parameters: [] }],
  }
}

describe('story exploration game isolation', () => {
  const engine = globalThis as any
  const keys = [
    '$gameMap',
    '$gameParty',
    '$gamePlayer',
    '$gameVariables',
    '$gameSwitches',
    '$gameMessage',
    '$gameSystem',
    '$dataWeapons',
    '__CHAYA_STORY_QUEST_CONTEXT__',
    '__CHAYA_STORY_FAILURE_MEMORY__',
  ]
  let previous: unknown[]
  let events: ReturnType<typeof npc>[]

  beforeEach(() => {
    jest
      .mocked(interactEvent)
      .mockReset()
      .mockResolvedValue({ outcome: 'done' } as Awaited<ReturnType<typeof interactEvent>>)
    previous = keys.map((key) => engine[key])
    delete engine.__CHAYA_STORY_QUEST_CONTEXT__
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    events = [npc(99)]
    engine.$gameParty = { leader: () => null }
    engine.$gameMap = {
      mapId: () => 1,
      displayName: () => 'Guild',
      event: (eventId: number) => events.find((event) => event.eventId() === eventId),
      events: () => events,
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete engine[key]
      else engine[key] = previous[index]
    })
  })

  test('uses actual NPCs when the benchmark event is missing', () => {
    const planner = new StoryExplorationPlanner()
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toMatchObject({ eventId: 99, kind: 'npc' })
  })

  test('retains blocked offering goals to resolve their reachable passage prerequisite', () => {
    engine.$gameMap.mapId = () => 6
    engine.$gameSwitches = { value: (id: number) => id === 27 }
    engine.$gameVariables = { value: (id: number) => (id === 3 ? 13 : 0) }
    events = [npc(19), npc(22), npc(60)]
    const route = jest.spyOn(gameControl, 'planMapRoute')
    route.mockImplementation((_, eventId) => {
      const boundaries = eventId === 19 ? [22] : eventId === 22 ? [60] : []
      return { status: boundaries.length ? 'event_boundary' : 'reachable', eventBoundaryIds: boundaries } as any
    })
    StoryFailureMemory.record(6, 19, 'no_path', 'Blocked by trap')
    StoryFailureMemory.record(6, 22, 'no_path', 'Blocked by passage')
    const target = new StoryExplorationPlanner().findNextTarget(6, { x: 0, y: 0 })
    expect(target).toMatchObject({ eventId: 60, guided: true })
    expect(StoryFailureMemory.blocked(6, 19)).toBeDefined()
  })

  test('honors the failure blacklist even for the benchmark guide', () => {
    events.push(npc(3))
    const planner = new StoryExplorationPlanner()
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toMatchObject({ eventId: 3, kind: 'guide' })
    for (let attempt = 0; attempt < 3; attempt++) planner.recordFailure(3)
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toMatchObject({ eventId: 99, kind: 'npc' })
  })

  test.each(['erased', 'inactive'] as const)('skips %s guide events', (state) => {
    const guide = npc(3)
    if (state === 'erased') guide._erased = true
    else guide._pageIndex = -1
    events.push(guide)
    expect(new StoryExplorationPlanner().findNextTarget(1, { x: 0, y: 0 })).toMatchObject({ eventId: 99, kind: 'npc' })
  })

  test('uses generic exploration for another game with identical map and event IDs', () => {
    createAgentRuntimeIdentity('another-game')
    events.push(npc(3))
    const planner = new StoryExplorationPlanner()
    expect(planner.getBenchmarkGuideTarget(1, { x: 0, y: 0 })).toBeNull()
    expect(planner.findNextTarget(1, { x: 0, y: 0 })?.kind).toBe('npc')
  })

  test.each(['inactive', 'erased'] as const)('reaches the puzzle model without reading %s event commands', async (state) => {
    createAgentRuntimeIdentity('another-game')
    const unavailable = npc(2)
    if (state === 'inactive') unavailable._pageIndex = -1
    else unavailable._erased = true
    unavailable.list = jest.fn(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'list')")
    })
    events.unshift(unavailable)
    const complete = jest.fn<ReturnType<CompanionComplete>, Parameters<CompanionComplete>>(async () => ({
      role: 'assistant' as const,
      content: JSON.stringify({ targetEventId: 99, hint: 'Talk to the guide' }),
    }))
    const planner = new StoryExplorationPlanner(new StoryPuzzleSolver({ complete, profileId: 'profile', model: 'model' }))

    await expect(planner.resolvePuzzleTarget(1, { x: 0, y: 0 })).resolves.toMatchObject({ eventId: 99 })
    expect(unavailable.list).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][0][1].content).toContain('ID 99')
    expect(complete.mock.calls[0][0][1].content).not.toContain('ID 2:')
  })

  test('does not auto-equip weapon 5 in another game', async () => {
    createAgentRuntimeIdentity('another-game')
    const leader = { isEquipped: () => false, changeEquip: jest.fn() }
    engine.$gameParty = { leader: () => leader }
    engine.$gamePlayer = {}
    engine.$dataWeapons = Array.from({ length: 6 }, () => ({}))
    events.push(npc(3))
    const result = await new StoryExplorationPlanner().executeTarget(
      { eventId: 3, x: 1, y: 1, kind: 'npc', name: 'Guide', priority: 50 },
      { press: jest.fn(), readState: jest.fn(), interrupted: () => false },
      new AbortController().signal
    )
    expect(result.success).toBe(true)
    expect(leader.changeEquip).not.toHaveBeenCalled()
  })

  test('propagates program exceptions without persisting them as failed game actions', async () => {
    engine.$gamePlayer = {}
    const failure = new TypeError("Cannot read properties of undefined (reading 'get')")
    jest.mocked(interactEvent).mockRejectedValue(failure)
    const planner = new StoryExplorationPlanner()
    const target = { eventId: 99, x: 1, y: 1, kind: 'npc' as const, name: 'Guide', priority: 50 }
    await expect(planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })).rejects.toBe(failure)
    expect(StoryFailureMemory.history(1, 99)).toEqual([])
  })

  test.each(['no_reaction', 'nothing_to_run', 'gone', 'runs_by_itself', 'timeout'])('stops selecting a target after repeated %s outcomes', async (outcome) => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    jest.mocked(interactEvent).mockResolvedValue({ outcome } as Awaited<ReturnType<typeof interactEvent>>)
    const complete = jest.fn<ReturnType<CompanionComplete>, Parameters<CompanionComplete>>(async () => ({
      role: 'assistant',
      content: JSON.stringify({ targetEventId: 99 }),
    }))
    const planner = new StoryExplorationPlanner(new StoryPuzzleSolver({ complete, profileId: 'profile', model: 'model' }))
    const target = planner.findNextTarget(1, { x: 0, y: 0 })!
    for (let attempt = 0; attempt < 3; attempt++) {
      await planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    }
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toBeNull()
    await expect(planner.resolvePuzzleTarget(1, { x: 0, y: 0 })).resolves.toBeNull()
    expect(complete).not.toHaveBeenCalled()
  })

  test.each(['interrupted', 'input_required', 'scene_changed'])('keeps targets eligible after transient %s outcomes', async (outcome) => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    jest.mocked(interactEvent).mockResolvedValue({ outcome } as Awaited<ReturnType<typeof interactEvent>>)
    const planner = new StoryExplorationPlanner()
    const target = planner.findNextTarget(1, { x: 0, y: 0 })!
    for (let attempt = 0; attempt < 3; attempt++) {
      await planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    }
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toMatchObject({ eventId: 99 })
  })

  test('prioritizes nearby interactive ground pickups and objects over distant targets', () => {
    createAgentRuntimeIdentity('another-game')
    const distantTarget = npc(10)
    distantTarget._x = 15
    distantTarget._y = 15

    const nearbyPickup = {
      _eventId: 5,
      _x: 1,
      _y: 0,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      _characterName: '!Flame',
      eventId: () => 5,
      event: () => ({ name: 'Ground Sparkle' }),
      list: () => [{ code: 125, parameters: [0, 0, 15] }],
    }

    events = [distantTarget, nearbyPickup]
    const planner = new StoryExplorationPlanner()
    const next = planner.findNextTarget(1, { x: 0, y: 0 })
    expect(next).toMatchObject({ eventId: 5, kind: 'chest' })
  })

  test('detects visible interactive objects and prevents re-targeting once visited', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    const barrel = {
      _eventId: 12,
      _x: 2,
      _y: 2,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      _characterName: '!Chest_Barrel',
      eventId: () => 12,
      event: () => ({ name: 'Wooden Barrel' }),
      list: () => [{ code: 250, parameters: [] }],
    }
    events = [barrel]
    const planner = new StoryExplorationPlanner()
    const target = planner.findNextTarget(1, { x: 0, y: 0 })
    expect(target).toMatchObject({ eventId: 12, kind: 'other' })

    const res = await planner.executeTarget(target!, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    expect(res.success).toBe(true)
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toBeNull()
  })

  test('does not apply proximity boost to transfer portals over interactables', () => {
    createAgentRuntimeIdentity('another-game')
    const portalRightNextToPlayer = {
      _eventId: 10,
      _x: 0,
      _y: 1,
      _pageIndex: 0,
      _erased: false,
      _trigger: 1,
      eventId: () => 10,
      event: () => ({ name: 'Exit Door' }),
      list: () => [{ code: 201, parameters: [0, 2, 5, 5] }],
    }
    const lootChest = {
      _eventId: 11,
      _x: 5,
      _y: 5,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      _characterName: '!Chest',
      eventId: () => 11,
      event: () => ({ name: 'Loot Chest' }),
      list: () => [{ code: 125, parameters: [0, 0, 50] }],
    }
    events = [portalRightNextToPlayer, lootChest]
    const planner = new StoryExplorationPlanner()
    const target = planner.findNextTarget(1, { x: 0, y: 0 })
    expect(target).toMatchObject({ eventId: 11, kind: 'chest' })
  })

  test('allows travel to a lower-numbered map without a recent reverse transition', () => {
    createAgentRuntimeIdentity('another-game')
    const backtrackPortal = {
      _eventId: 12,
      _x: 0,
      _y: 1,
      _pageIndex: 0,
      _erased: false,
      _trigger: 1,
      eventId: () => 12,
      event: () => ({ name: 'Stairs Up' }),
      list: () => [{ code: 201, parameters: [0, 1, 5, 5] }], // targetMap 1 < currentMap 2
    }
    events = [backtrackPortal]
    engine.$gameMap.mapId = () => 2
    const planner = new StoryExplorationPlanner()
    const target = planner.findNextTarget(2, { x: 0, y: 0 })
    expect(target).toMatchObject({ eventId: 12, kind: 'transfer' })
  })

  test('marks chest interaction as failure when the chest remains unopened after interaction', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    const closedChest = {
      _eventId: 52,
      _x: 2,
      _y: 2,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      _characterName: '!Chest',
      eventId: () => 52,
      event: () => ({ name: 'Locked Chest', pages: [{}, {}] }),
      list: () => [{ code: 125, parameters: [0, 0, 100] }],
    }
    events = [closedChest]
    const planner = new StoryExplorationPlanner()
    const target = planner.findNextTarget(1, { x: 0, y: 0 })!
    expect(target).toMatchObject({ eventId: 52, kind: 'chest' })

    const res = await planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    expect(res.success).toBe(false)
    expect(res.outcome).toBe('unopened')

    // Second failure triggers blacklist
    await planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    expect(planner.isBlacklisted(52)).toBe(true)
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toBeNull()
  })

  test('skips chests whose static lock requirement exceeds current lockpick skill', () => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    engine.$gameVariables = { value: (id: number) => (id === 3 ? 13 : 0) } // Diana lockpick level = 13
    const highLevelChest = {
      _eventId: 52,
      _x: 2,
      _y: 2,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      _characterName: '!Chest',
      eventId: () => 52,
      event: () => ({
        name: 'High Level Chest',
        pages: [
          {
            list: [
              { code: 122, parameters: [54, 54, 0, 0, 16] }, // Requires 16
              { code: 125, parameters: [0, 0, 100] },
            ],
          },
        ],
      }),
      list: () => [
        { code: 122, parameters: [54, 54, 0, 0, 16] },
        { code: 125, parameters: [0, 0, 100] },
      ],
    }
    const accessibleChest = {
      _eventId: 19,
      _x: 4,
      _y: 4,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      _characterName: '!Chest',
      eventId: () => 19,
      event: () => ({
        name: 'Accessible Chest',
        pages: [
          {
            list: [
              { code: 122, parameters: [2, 2, 0, 0, 11] }, // Requires 11
              { code: 125, parameters: [0, 0, 50] },
            ],
          },
        ],
      }),
      list: () => [
        { code: 122, parameters: [2, 2, 0, 0, 11] },
        { code: 125, parameters: [0, 0, 50] },
      ],
    }
    events = [highLevelChest, accessibleChest]
    const planner = new StoryExplorationPlanner()
    const target = planner.findNextTarget(6, { x: 0, y: 0 })
    expect(target).toMatchObject({ eventId: 19, kind: 'chest' })
  })

  test('un-blacklists and prioritizes recorded chests when lockpick skill levels up', () => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    let currentLockLevel = 13
    engine.$gameVariables = { value: (id: number) => (id === 3 ? currentLockLevel : 0) }
    StoryContextStore.recordLockPrerequisite(6, 52, 'chest', 16, 13)

    const highLevelChest = {
      _eventId: 52,
      _x: 2,
      _y: 2,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      _characterName: '!Chest',
      eventId: () => 52,
      event: () => ({
        name: 'High Level Chest',
        pages: [{ list: [{ code: 122, parameters: [54, 54, 0, 0, 16] }] }],
      }),
      list: () => [
        { code: 122, parameters: [54, 54, 0, 0, 16] },
        { code: 125, parameters: [0, 0, 100] },
      ],
    }
    events = [highLevelChest]
    const planner = new StoryExplorationPlanner()

    // Level 13: chest is skipped
    expect(planner.findNextTarget(6, { x: 0, y: 0 })).toBeNull()

    // Level up to 16: chest becomes available with priority boost
    currentLockLevel = 16
    const target = planner.findNextTarget(6, { x: 0, y: 0 })
    expect(target).toMatchObject({ eventId: 52, kind: 'chest', priority: 115 })
  })

  test('findCandidateBranches returns multiple candidate routes ordered by priority', () => {
    createAgentRuntimeIdentity('another-game')
    const chest = {
      _eventId: 10,
      _x: 3,
      _y: 3,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      _characterName: '!Chest',
      eventId: () => 10,
      event: () => ({ name: 'Chest' }),
      list: () => [{ code: 125, parameters: [0, 0, 10] }],
    }
    const talkNpc = {
      _eventId: 20,
      _x: 5,
      _y: 5,
      _pageIndex: 0,
      _erased: false,
      _trigger: 0,
      eventId: () => 20,
      event: () => ({ name: 'Villager' }),
      list: () => [{ code: 101, parameters: [] }],
    }
    events = [chest, talkNpc]
    const planner = new StoryExplorationPlanner()
    const branches = planner.findCandidateBranches(1, { x: 0, y: 0 })
    expect(branches.length).toBeGreaterThanOrEqual(2)
    expect(branches[0].eventId).toBe(10)
    expect(branches[1].eventId).toBe(20)
  })

  test.each(['guide', 'other', 'chest'] as const)('defers %s chest verification until its choice event ends', async (kind) => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    const chest = { ...npc(52), _characterName: '!Chest', event: () => ({ name: 'Locked Chest', pages: [{}, {}] }), list: () => [{ code: 125, parameters: [0, 0, 10] }] }
    events = [chest]
    let running = true
    engine.$gameMap.isEventRunning = () => running
    jest.mocked(interactEvent).mockResolvedValue({ outcome: 'choice' } as any)
    const planner = new StoryExplorationPlanner()
    const target = { eventId: 52, kind, x: 1, y: 1, name: 'Model target', priority: 50 }
    await expect(planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })).resolves.toMatchObject({ pending: true })
    expect(planner.isBlacklisted(52)).toBe(false)
    expect(planner.settlePendingTarget()).toBeNull()
    running = false
    expect(planner.settlePendingTarget()?.result).toMatchObject({ success: false, outcome: 'unopened' })
    expect(planner.findFallbackTarget(1, { x: 0, y: 0 })).toBeNull()
    await expect(planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })).resolves.toMatchObject({ outcome: 'ineligible' })
    expect(interactEvent).toHaveBeenCalledTimes(1)
  })

  test('settles a chest only after a reward actually increases', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    engine.$gameParty = { _items: { 5: 1 } }
    const chest = { ...npc(52), _characterName: '!Chest', event: () => ({ name: 'Chest', pages: [{}, {}] }), list: () => [{ code: 125, parameters: [0, 0, 10] }] }
    events = [chest]
    const planner = new StoryExplorationPlanner()
    jest.mocked(interactEvent).mockResolvedValue({ outcome: 'choice' } as any)
    await planner.executeTarget({ eventId: 52, kind: 'guide', x: 1, y: 1, name: 'Chest', priority: 50 }, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    engine.$gameParty._items[8] = 1
    expect(planner.settlePendingTarget()?.result.success).toBe(true)
    expect(StoryContextStore.get(1).chestsOpened).toContain(52)
  })

  test('treats a trap reveal as an intermediate step and keeps disarming available', async () => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    engine.$gamePlayer = {}
    engine.$gameVariables = { value: (id: number) => (id === 3 ? 10 : 0) }
    const trap = {
      ...npc(22),
      event: () => ({ name: 'Trap' }),
      list: () => [
        { code: 102, parameters: [] },
        { code: 122, parameters: [5, 5, 0, 0, 10] },
      ],
    }
    events = [trap]
    jest.mocked(interactEvent).mockImplementation(async () => {
      trap._pageIndex = 1
      return { outcome: 'done' } as any
    })
    const planner = new StoryExplorationPlanner()
    const target = { eventId: 22, kind: 'other' as const, x: 1, y: 1, name: 'Trap', priority: 50 }
    await expect(planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })).resolves.toMatchObject({ success: true, outcome: 'revealed' })
    expect(planner.isEligible(1, 22)).toBe(true)
    expect(planner.isBlacklisted(22)).toBe(false)
  })

  test('does not treat a quest payment as a loot reward', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    const guide = {
      ...npc(99),
      list: () => [
        { code: 101, parameters: [] },
        { code: 125, parameters: [1, 0, 50] },
      ],
    }
    events = [guide]
    const planner = new StoryExplorationPlanner()
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toMatchObject({ eventId: 99, kind: 'npc' })
    await expect(
      planner.executeTarget({ eventId: 99, kind: 'guide', x: 1, y: 1, name: 'Quest giver', priority: 50 }, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    ).resolves.toMatchObject({ success: true })
    expect(StoryContextStore.get(1).chestsOpened).not.toContain(99)
  })

  test('keeps failed event IDs isolated by map and discards them on save replacement', () => {
    const planner = new StoryExplorationPlanner()
    planner.setMap(1)
    planner.recordFailure(99)
    planner.recordFailure(99)
    expect(planner.isEligible(1, 99)).toBe(false)
    expect(planner.isEligible(2, 99)).toBe(true)
    expect(planner.isEligible(1, 99)).toBe(false)
    engine.$gameSystem = {}
    expect(planner.isEligible(1, 99)).toBe(true)
  })

  test('excludes a failed event after a detour and a new custody runtime, including fallback and model routes', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    jest.mocked(interactEvent).mockResolvedValue({ outcome: 'no_reaction' } as any)
    const complete = jest.fn<ReturnType<CompanionComplete>, Parameters<CompanionComplete>>(async () => ({ role: 'assistant', content: '{"targetEventId":99}' }))
    const planner = new StoryExplorationPlanner()
    const target = planner.findNextTarget(1, { x: 0, y: 0 })!
    await planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    planner.setMap(2)
    const resumed = new StoryExplorationPlanner(new StoryPuzzleSolver({ complete, profileId: 'profile', model: 'model' }))
    expect(resumed.findNextTarget(1, { x: 0, y: 0 }, 'Guide')).toBeNull()
    expect(resumed.findFallbackTarget(1, { x: 0, y: 0 })).toBeNull()
    await expect(resumed.resolvePuzzleTarget(1, { x: 0, y: 0 })).resolves.toBeNull()
    await expect(resumed.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })).resolves.toMatchObject({ outcome: 'ineligible' })
    expect(interactEvent).toHaveBeenCalledTimes(1)
    expect(complete).not.toHaveBeenCalled()
    expect(StoryFailureMemory.history(1, 99)).toEqual([expect.objectContaining({ reason: 'no_reaction', attempts: 1 })])
    expect(StoryContextStore.formatSummaryForPrompt(1)).toContain('no_reaction')
  })

  test('does not reopen a failed event for an unrelated reward or a variable change below its requirement', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    let level = 1
    const unrelated = { value: 0 }
    engine.$gameVariables = { value: (id: number) => (id === 8 ? level : unrelated.value) }
    events[0].list = () => [{ code: 111, parameters: [1, 8, 0, 11, 1] }]
    jest.mocked(interactEvent).mockResolvedValue({ outcome: 'no_reaction' } as any)
    const planner = new StoryExplorationPlanner()
    await planner.executeTarget({ eventId: 99, kind: 'other', x: 1, y: 1, name: 'Gate', priority: 50 }, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    level = 10
    unrelated.value = 100
    engine.$gameParty.gold = () => 1000
    expect(new StoryExplorationPlanner().isEligible(1, 99)).toBe(false)
    level = 11
    expect(new StoryExplorationPlanner().isEligible(1, 99)).toBe(true)
    level = 1
    expect(new StoryExplorationPlanner().isEligible(1, 99)).toBe(false)
  })

  test('does not use a no-effect inspection again as fallback after restarting custody', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    const planner = new StoryExplorationPlanner()
    await planner.executeTarget({ eventId: 99, kind: 'npc', x: 1, y: 1, name: 'Guide', priority: 50 }, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    expect(new StoryExplorationPlanner().findFallbackTarget(1, { x: 0, y: 0 })).toBeNull()
    expect(StoryFailureMemory.blocked(1, 99)).toMatchObject({ reason: 'no_effect' })
  })

  test('does not let unrelated variable writes disguise a repeated no-effect interaction', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    engine.$gameVariables = { _data: [], value: () => 0 }
    jest.mocked(interactEvent).mockImplementation(async () => {
      engine.$gameVariables._data[99] = 1
      return { outcome: 'done' } as any
    })
    const planner = new StoryExplorationPlanner()
    await planner.executeTarget({ eventId: 99, kind: 'npc', x: 1, y: 1, name: 'Guide', priority: 50 }, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    expect(new StoryExplorationPlanner().findFallbackTarget(1, { x: 0, y: 0 })).toBeNull()
  })

  test('allows puzzle model to re-examine eligible visited events when all new candidate branches are exhausted', async () => {
    createAgentRuntimeIdentity('another-game')
    engine.$gamePlayer = {}
    const guide = npc(99)
    guide.event = () => ({ name: 'Guide', pages: [{ conditions: { switch1Valid: true, switch1Id: 1 } }] })
    events = [guide]
    let switch1 = false
    engine.$gameSwitches = { value: (id: number) => (id === 1 ? switch1 : false) }
    jest.mocked(interactEvent).mockImplementation(async () => {
      switch1 = true
      return { outcome: 'done' } as any
    })
    const complete = jest.fn(async () => ({
      role: 'assistant' as const,
      content: JSON.stringify({ targetEventId: 99, hint: 'Ask the guide for another clue' }),
    }))
    const planner = new StoryExplorationPlanner(new StoryPuzzleSolver({ complete, profileId: 'profile', model: 'model' }))
    const target = planner.findNextTarget(1, { x: 0, y: 0 })!
    expect(target).toMatchObject({ eventId: 99 })
    const res = await planner.executeTarget(target, { press: jest.fn(), readState: jest.fn(), interrupted: () => false })
    expect(res.success).toBe(true)
    expect(planner.findNextTarget(1, { x: 0, y: 0 })).toBeNull()

    const puzzleTarget = await planner.resolvePuzzleTarget(1, { x: 0, y: 0 })
    expect(puzzleTarget).toMatchObject({ eventId: 99, hint: 'Ask the guide for another clue' })
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
