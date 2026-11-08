import type { CompanionComplete } from '@/plugins/mv/src/agent/runtime/companion-chat'
import { STORY_BENCHMARK_GAME_ID } from '@/plugins/mv/src/agent/runtime/companion-core/story-benchmark'
import { StoryContextStore } from '@/plugins/mv/src/agent/runtime/companion-core/story-context'
import { StoryDriver } from '@/plugins/mv/src/agent/runtime/companion-core/story-driver'
import { StoryFailureMemory } from '@/plugins/mv/src/agent/runtime/companion-core/story-failure-memory'
import { createAgentRuntimeIdentity } from '@/plugins/mv/src/agent/runtime/identity'

async function pick(driver: StoryDriver, choices: string[], mapId: number): Promise<number> {
  const index = await driver.resolveChoice(choices, mapId)
  const choiceWindow = {
    active: true,
    select: jest.fn(),
    processOk: () => {
      choiceWindow.active = false
    },
  }
  driver.applyChoiceSelection({ _choiceWindow: choiceWindow }, index)
  return index
}

describe('story choice driver', () => {
  const engine = globalThis as any
  const keys = ['$gameVariables', '$gameParty', '$dataItems', '$gameMap', '$gameSystem', '$gameMessage', '__CHAYA_STORY_QUEST_CONTEXT__', '__CHAYA_STORY_FAILURE_MEMORY__']
  let previous: unknown[]

  beforeEach(() => {
    previous = keys.map((key) => engine[key])
    delete engine.__CHAYA_STORY_QUEST_CONTEXT__
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__
    createAgentRuntimeIdentity('another-game')
  })

  afterEach(() => {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete engine[key]
      else engine[key] = previous[index]
    })
  })

  test('does not turn a cancelled model request into a fallback choice', async () => {
    const abort = new AbortController()
    const complete: CompanionComplete = jest.fn(async () => {
      abort.abort()
      throw new DOMException('Cancelled', 'AbortError')
    })
    const driver = new StoryDriver({ complete, profileId: 'profile', model: 'model', signal: abort.signal })
    await expect(driver.resolveChoice(['Left', 'Right'], 99)).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('discards a model response that ignores cancellation', async () => {
    const abort = new AbortController()
    const complete: CompanionComplete = jest.fn(async () => {
      abort.abort()
      return { role: 'assistant', content: '1' }
    })
    const driver = new StoryDriver({ complete, profileId: 'profile', model: 'model' })
    await expect(driver.resolveChoice(['Left', 'Right'], 99, null, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('keeps the safe fallback for ordinary model errors', async () => {
    const complete: CompanionComplete = jest.fn(async () => {
      throw new Error('Model unavailable')
    })
    const driver = new StoryDriver({ complete, profileId: 'profile', model: 'model' })
    await expect(driver.resolveChoice(['Left', 'Right'], 99)).resolves.toBe(0)
  })

  test('restricts the first-act rule to the benchmark game', async () => {
    const complete: CompanionComplete = jest.fn(async () => ({ role: 'assistant', content: '0' }))
    const driver = new StoryDriver({ complete, profileId: 'profile', model: 'model' })
    await expect(driver.resolveChoice(['Leave', 'Act I'], 215)).resolves.toBe(0)
    expect(complete).toHaveBeenCalledTimes(1)
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    await expect(driver.resolveChoice(['Leave', 'Act I'], 215)).resolves.toBe(1)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  test('does not endlessly pick the same lockpick choice when it repeats', async () => {
    createAgentRuntimeIdentity('another-game')
    const driver = new StoryDriver({})
    const choices = ['撬锁。', '强行打破宝箱。', '离开。']

    const first = await pick(driver, choices, 6)
    expect(first).toBe(0) // First attempt: try lockpick

    const second = await pick(driver, choices, 6)
    expect(second).not.toBe(0) // Second attempt: do not repeat failed lockpick
    expect(second).toBe(2)

    const third = await pick(driver, choices, 6)
    expect(third).toBe(2) // Third attempt: leave
  })

  test('keeps choice attempts separate for different chests and skill levels', async () => {
    let skill = 1
    engine.$gameVariables = { value: () => skill }
    engine.$gameMap = { mapId: () => 6, event: () => ({ _pageIndex: 0, list: () => [{ code: 111, parameters: [1, 3, 0, 11, 1] }] }) }
    const driver = new StoryDriver()
    const choices = ['Lockpick', 'Leave']
    driver.setCurrentTargetEventId(1)
    expect(await pick(driver, choices, 6)).toBe(0)
    expect(await pick(driver, choices, 6)).toBe(1)
    driver.setCurrentTargetEventId(2)
    expect(await pick(driver, choices, 6)).toBe(0)
    driver.setCurrentTargetEventId(1)
    skill = 11
    expect(await pick(driver, choices, 6)).toBe(0)
  })

  test('remembers failed choices after restarting custody and ignores unrelated skill changes', async () => {
    let skill = 1
    engine.$gameVariables = { value: () => skill }
    engine.$gameMap = { mapId: () => 6, event: () => ({ _pageIndex: 0, list: () => [] }) }
    const choices = ['Lockpick', 'Leave']
    const driver = new StoryDriver()
    driver.setCurrentTargetEventId(52)
    expect(await pick(driver, choices, 6)).toBe(0)
    skill = 11
    const resumed = new StoryDriver()
    resumed.setCurrentTargetEventId(52)
    expect(await resumed.resolveChoice(choices, 6)).toBe(1)
    engine.$gameSystem = {}
    const loaded = new StoryDriver()
    loaded.setCurrentTargetEventId(52)
    expect(await loaded.resolveChoice(choices, 6)).toBe(0)
  })

  test('does not blacklist a resolved choice that was never applied', async () => {
    const driver = new StoryDriver()
    expect(await driver.resolveChoice(['是。', '否。'], 5)).toBe(0)
    expect(await driver.resolveChoice(['是。', '否。'], 5)).toBe(0)
  })

  test('does not record disabled or rejected menu confirmations', async () => {
    const driver = new StoryDriver()
    const choices = ['是。', '否。']
    await driver.resolveChoice(choices, 5)
    const processOk = jest.fn()
    driver.applyChoiceSelection({ _choiceWindow: { active: true, select: jest.fn(), isCurrentItemEnabled: () => false, processOk } }, 0)
    expect(processOk).not.toHaveBeenCalled()
    expect(await driver.resolveChoice(choices, 5)).toBe(0)
    driver.applyChoiceSelection({ _choiceWindow: { active: true, select: jest.fn(), processOk } }, 0)
    expect(await driver.resolveChoice(choices, 5)).toBe(0)
  })

  test('separates identical yes/no menus by prompt and interpreter command', async () => {
    let text = '打破大门吗？'
    const interpreter = { _eventId: 22, _index: 3, _waitMode: 'message' }
    engine.$gameMap = { mapId: () => 5, _interpreter: interpreter }
    engine.$gameMessage = { allText: () => text }
    const driver = new StoryDriver()
    const choices = ['是。', '否。']
    expect(await pick(driver, choices, 5)).toBe(0)
    text = '要离开地下城吗？'
    expect(await pick(driver, choices, 5)).toBe(0)
    interpreter._index = 20
    expect(await pick(driver, choices, 5)).toBe(0)
    interpreter._index = 3
    text = '打破大门吗？'
    expect(await pick(driver, choices, 5)).toBe(1)
    expect(await pick(driver, choices, 5)).toBe(-1)
  })

  test('attributes nested message choices to the running event instead of the navigation target', async () => {
    engine.$gameMap = {
      mapId: () => 5,
      _interpreter: { _eventId: 22, _index: 10, _childInterpreter: { _eventId: 22, _index: 3, _waitMode: 'message' } },
    }
    engine.$gameMessage = { allText: () => '打破大门吗？' }
    const driver = new StoryDriver()
    driver.setCurrentTargetEventId(24)
    expect(driver.getChoiceContext().eventId).toBe(22)
    expect(await pick(driver, ['是。', '否。'], 5)).toBe(0)
    StoryFailureMemory.settleChoice(5, 22, true)
    expect(await pick(driver, ['是。', '否。'], 5)).toBe(0)
  })

  test('leaves and records prerequisite when lock level exceeds current lockpick skill', async () => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    const g = globalThis as any
    g.$gameVariables = {
      value: (id: number) => {
        if (id === 3) return 13 // Current lockpick level = 13
        if (id === 2) return 16 // Required lock level = 16
        return 0
      },
    }
    g.$gameParty = { hasItem: () => true }
    g.$dataItems = [null, null, null, null, null, { id: 5 }]

    const driver = new StoryDriver({})
    driver.setCurrentTargetEventId(52)
    const choices = ['撬锁。', '强行打破宝箱。', '离开。']

    // Level 13 < 16: Should choose leave (index 2) instead of lockpick (index 0)
    const picked = await driver.resolveChoice(choices, 6)
    expect(picked).toBe(2)

    const prereq = StoryContextStore.getLockPrerequisite(6, 52)
    expect(prereq).toMatchObject({
      mapId: 6,
      eventId: 52,
      kind: 'chest',
      requiredLevel: 16,
      lastAttemptLevel: 13,
    })
  })

  test('picks lock when current lockpick skill is sufficient', async () => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    const g = globalThis as any
    g.$gameVariables = {
      value: (id: number) => {
        if (id === 3) return 16 // Current lockpick level = 16
        if (id === 2) return 16 // Required lock level = 16
        return 0
      },
    }
    g.$gameParty = { hasItem: () => true }
    g.$dataItems = [null, null, null, null, null, { id: 5 }]

    const driver = new StoryDriver({})
    driver.setCurrentTargetEventId(52)
    const choices = ['撬锁。', '强行打破宝箱。', '离开。']

    // Level 16 >= 16: Should choose lockpick (index 0)
    const picked = await driver.resolveChoice(choices, 6)
    expect(picked).toBe(0)
  })

  test('disarms trap when skill is sufficient and leaves when insufficient', async () => {
    createAgentRuntimeIdentity(STORY_BENCHMARK_GAME_ID)
    const g = globalThis as any
    let currentSkill = 10
    g.$gameVariables = {
      value: (id: number) => {
        if (id === 3) return currentSkill
        if (id === 5) return 12 // Required trap level = 12
        return 0
      },
    }
    const choices = ['试着解除陷阱。', '小心翼翼地触发陷阱。', '离开。']
    const driver = new StoryDriver({})
    driver.setCurrentTargetEventId(22)

    // At skill 10 < 12: leaves (index 2)
    expect(await driver.resolveChoice(choices, 6)).toBe(2)
    expect(StoryContextStore.getLockPrerequisite(6, 22)).toMatchObject({ kind: 'trap', requiredLevel: 12 })

    // Skill increased to 12: disarms (index 0)
    currentSkill = 12
    const driver2 = new StoryDriver({})
    driver2.setCurrentTargetEventId(22)
    expect(await driver2.resolveChoice(choices, 6)).toBe(0)
  })
})
