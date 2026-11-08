import * as navigation from '@/plugins/mv/src/agent/game-control'
import { StoryFailureMemory } from '@/plugins/mv/src/agent/runtime/companion-core/story-failure-memory'
import { createAgentRuntimeIdentity } from '@/plugins/mv/src/agent/runtime/identity'

describe('story failure memory', () => {
  const engine = globalThis as any
  const keys = [
    '$gameSystem',
    '$gameMap',
    '$gameVariables',
    '$gameSwitches',
    '$gameSelfSwitches',
    '$gameParty',
    '$dataItems',
    '$dataCommonEvents',
    '__CHAYA_STORY_FAILURE_MEMORY__',
    'DataManager',
    'localStorage',
  ]
  let previous: unknown[]
  let variables: Record<number, number>
  let switches: Record<number, boolean>
  let inventory: Set<number>
  let event: any

  beforeEach(() => {
    previous = keys.map((key) => engine[key])
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__
    createAgentRuntimeIdentity('memory-game')
    variables = {}
    switches = {}
    inventory = new Set()
    event = { _pageIndex: 0, event: () => ({ pages: [] }), list: () => [] }
    engine.$gameSystem = {}
    engine.$gameMap = { mapId: () => 6, event: () => event }
    engine.$gameVariables = { value: (id: number) => variables[id] ?? 0 }
    engine.$gameSwitches = { value: (id: number) => switches[id] ?? false }
    engine.$gameParty = { hasItem: (item: any) => inventory.has(item.id), gold: () => 10 }
    engine.$dataItems = [null, { id: 1 }, null, null, null, { id: 5 }]
  })

  afterEach(() => {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete engine[key]
      else engine[key] = previous[index]
    })
  })

  test('keeps failure evidence without a time based expiry or unrelated state reset', () => {
    const failure = StoryFailureMemory.record(6, 52, 'unopened', 'No reward after selecting lockpick')
    variables[99] = 123
    switches[88] = true
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 86_400_000)
    expect(StoryFailureMemory.blocked(6, 52)).toMatchObject({ reason: 'unopened', attempts: 1 })
    now.mockRestore()
    expect(failure.firstFailedAt).toBe(failure.lastFailedAt)
  })

  test('upgrades a live pre-outcome store without discarding its failure evidence', () => {
    StoryFailureMemory.record(6, 52, 'unopened', 'No reward')
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__.pendingChoices
    expect(() => StoryFailureMemory.settleChoice(5, 24, true)).not.toThrow()
    StoryFailureMemory.choiceAttempts(6, 52, ['Unlock', 'Leave']).add(0)
    StoryFailureMemory.settleChoice(6, 52, true)
    expect(StoryFailureMemory.choiceAttempts(6, 52, ['Unlock', 'Leave']).has(0)).toBe(false)
    expect(StoryFailureMemory.blocked(6, 52)?.detail).toBe('No reward')
  })

  test('retains legacy program errors for diagnosis without treating them as game failures', () => {
    StoryFailureMemory.record(5, 24, 'error', "Cannot read properties of undefined (reading 'get')")
    expect(StoryFailureMemory.history(5, 24)).toHaveLength(1)
    expect(StoryFailureMemory.blocked(5, 24)).toBeUndefined()
    StoryFailureMemory.record(5, 24, 'no_effect', 'No event progress')
    expect(StoryFailureMemory.blocked(5, 24)?.reason).toBe('no_effect')
  })

  test('ignores ambiguous legacy choice labels while retaining event failure evidence', () => {
    StoryFailureMemory.record(6, 52, 'skill_required', 'Requires level 11', { requiredLevel: 11 })
    const store = engine.__CHAYA_STORY_FAILURE_MEMORY__
    store.choices.set(JSON.stringify(['outcome-v2', 6, 22, ['Yes', 'No'].sort(), {}, '[0,false,[]]']), new Set(['Yes', 'No']))
    store.pendingChoices.set('6:22', { key: 'old', label: 'Yes' })
    expect(StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No']).size).toBe(0)
    expect(StoryFailureMemory.blocked(6, 52)?.detail).toBe('Requires level 11')
  })

  test('restores failures and attempted labels after runtime loss and a reload of the same native save', () => {
    const values = new Map<string, string>()
    engine.localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    engine.DataManager = { _lastAccessedId: 1, loadSavefileInfo: () => ({ timestamp: 1234 }) }
    variables[3] = 1
    StoryFailureMemory.record(6, 52, 'skill_required', 'Requires level 11', { requiredLevel: 11 })
    StoryFailureMemory.choiceAttempts(6, 52, ['Open', 'Leave']).add(0)
    StoryFailureMemory.settleChoice(6, 52, false)
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__
    engine.$gameSystem = {}
    createAgentRuntimeIdentity('memory-game')
    expect(StoryFailureMemory.blocked(6, 52)?.reason).toBe('skill_required')
    expect(StoryFailureMemory.choiceAttempts(6, 52, ['Leave', 'Open']).has(1)).toBe(true)
    variables[3] = 11
    expect(StoryFailureMemory.blocked(6, 52)).toBeUndefined()
    engine.$gameSystem = {}
    engine.DataManager._lastAccessedId = 2
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__
    expect(StoryFailureMemory.history(6)).toEqual([])
  })

  test('ignores a corrupt persisted journal without losing new in-memory evidence', () => {
    engine.localStorage = { getItem: () => '{"version":1,"failures":[["6:52",[{}]]],"choices":[]}', setItem: jest.fn() }
    engine.DataManager = { _lastAccessedId: 1, loadSavefileInfo: () => ({ timestamp: 1234 }) }
    expect(StoryFailureMemory.history(6)).toEqual([])
    StoryFailureMemory.record(6, 52, 'no_effect', 'No progress')
    expect(StoryFailureMemory.blocked(6, 52)).toBeDefined()
  })

  test('rejects malformed retry conditions before hydrating the journal', () => {
    const values = new Map<string, string>()
    engine.localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    engine.DataManager = { _lastAccessedId: 1, loadSavefileInfo: () => ({ timestamp: 1234 }) }
    StoryFailureMemory.record(6, 52, 'no_effect', 'No progress')
    for (const [key, raw] of values) {
      const journal = JSON.parse(raw)
      journal.failures[0][1][0].condition.blockerEventIds = 'not-an-array'
      values.set(key, JSON.stringify(journal))
    }
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__
    engine.$gameSystem = {}
    expect(StoryFailureMemory.history(6)).toEqual([])
  })

  test('requires the actual skill threshold rather than any skill increase', () => {
    variables[3] = 1
    StoryFailureMemory.record(6, 52, 'skill_required', 'Requires level 11', { requiredLevel: 11 })
    variables[3] = 10
    expect(StoryFailureMemory.blocked(6, 52)).toBeDefined()
    variables[3] = 11
    expect(StoryFailureMemory.blocked(6, 52)).toBeUndefined()
    StoryFailureMemory.record(6, 52, 'unopened', 'Still no expected result at level 11', { requiredLevel: 11 })
    variables[3] = 12
    expect(StoryFailureMemory.blocked(6, 52)).toMatchObject({ reason: 'unopened' })
    expect(StoryFailureMemory.history(6, 52)).toHaveLength(2)
  })

  test('releases a missing key only when the required key becomes available', () => {
    event.list = () => [{ code: 111, parameters: [8, 1] }]
    StoryFailureMemory.record(6, 52, 'item_required', 'Requires item 1')
    inventory.add(5)
    expect(StoryFailureMemory.blocked(6, 52)).toBeDefined()
    inventory.add(1)
    expect(StoryFailureMemory.blocked(6, 52)).toBeUndefined()
    inventory.delete(1)
    expect(StoryFailureMemory.blocked(6, 52)).toBeDefined()
  })

  test('tracks a relevant quest switch inside a common event', () => {
    event.list = () => [{ code: 117, parameters: [10] }]
    engine.$dataCommonEvents = {
      10: {
        list: [
          { code: 111, parameters: [0, 27, 0] },
          { code: 117, parameters: [10] },
        ],
      },
    }
    StoryFailureMemory.record(6, 52, 'no_effect', 'Quest not ready')
    switches[99] = true
    expect(StoryFailureMemory.blocked(6, 52)).toBeDefined()
    switches[27] = true
    expect(StoryFailureMemory.blocked(6, 52)).toBeUndefined()
  })

  test('ignores temporary difficulty variables assigned by the event', () => {
    event.list = () => [
      { code: 122, parameters: [2, 2, 0, 2, 1, 20] },
      { code: 111, parameters: [1, 3, 1, 2, 1] },
    ]
    variables[3] = 1
    variables[2] = 11
    StoryFailureMemory.record(6, 52, 'skill_required', 'Requires level 11', { requiredLevel: 11 })
    variables[2] = 0
    variables[3] = 10
    expect(StoryFailureMemory.blocked(6, 52)).toBeDefined()
  })

  test('reevaluates a changed page but retains failures when the old page returns', () => {
    StoryFailureMemory.record(6, 52, 'no_effect', 'No progress on page 0')
    event._pageIndex = 1
    expect(StoryFailureMemory.blocked(6, 52)).toBeUndefined()
    StoryFailureMemory.record(6, 52, 'no_effect', 'No progress on page 1')
    event._pageIndex = 0
    expect(StoryFailureMemory.blocked(6, 52)).toMatchObject({ detail: 'No progress on page 0' })
  })

  test('keeps a proven permanent failure blocked even when event prerequisites change', () => {
    StoryFailureMemory.record(6, 52, 'permanent_failure', 'This action permanently destroyed the reward', {}, true)
    event._pageIndex = 1
    variables[3] = 100
    expect(StoryFailureMemory.blocked(6, 52)).toMatchObject({ permanent: true })
  })

  test('keeps records across runtime reconnections but isolates games and loaded saves', () => {
    StoryFailureMemory.record(6, 52, 'unopened', 'No reward')
    createAgentRuntimeIdentity('memory-game')
    expect(StoryFailureMemory.blocked(6, 52)).toBeDefined()
    engine.$gameSystem = {}
    expect(StoryFailureMemory.blocked(6, 52)).toBeUndefined()
    StoryFailureMemory.record(6, 52, 'unopened', 'New save failure')
    createAgentRuntimeIdentity('different-game')
    expect(StoryFailureMemory.blocked(6, 52)).toBeUndefined()
  })

  test('keeps failed choice labels blocked if the visible options are reordered', () => {
    StoryFailureMemory.choiceAttempts(6, 52, ['Unlock', 'Break', 'Leave']).add(0)
    const reordered = StoryFailureMemory.choiceAttempts(6, 52, ['Leave', 'Break', 'Unlock'])
    expect(reordered.has(2)).toBe(true)
    expect(reordered.has(0)).toBe(false)
  })

  test('releases a successful choice after settlement but retains earlier failed alternatives', () => {
    const choices = ['Unlock', 'Use key', 'Leave']
    StoryFailureMemory.choiceAttempts(6, 52, choices).add(0)
    StoryFailureMemory.settleChoice(6, 52, false)
    StoryFailureMemory.choiceAttempts(6, 52, choices).add(1)
    StoryFailureMemory.settleChoice(6, 52, true)
    const attempts = StoryFailureMemory.choiceAttempts(6, 52, ['Leave', 'Use key', 'Unlock'])
    expect(attempts.has(1)).toBe(false)
    expect(attempts.has(2)).toBe(true)
  })

  test('does not persist an applied choice as a failure before its outcome is known', () => {
    const values = new Map<string, string>()
    engine.localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    engine.DataManager = { _lastAccessedId: 1, loadSavefileInfo: () => ({ timestamp: 1234 }) }
    StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No']).add(0)
    expect(StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No']).has(0)).toBe(true)
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__
    engine.$gameSystem = {}
    expect(StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No']).has(0)).toBe(false)
  })

  test('settles all prompts of an event without discarding confirmed earlier failures', () => {
    StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No'], {}, 'gate').add(0)
    StoryFailureMemory.settleChoice(6, 22, false)
    StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No'], {}, 'gate').add(1)
    StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No'], {}, 'reward').add(0)
    StoryFailureMemory.settleChoice(6, 22, true)
    expect(StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No'], {}, 'gate').has(0)).toBe(true)
    expect(StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No'], {}, 'gate').has(1)).toBe(false)
    expect(StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No'], {}, 'reward').has(0)).toBe(false)
  })

  test('settles an incidental gate after it opens, allowing yes again when loading the original page', () => {
    StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No']).add(0)
    event._pageIndex = 1
    StoryFailureMemory.settleUnownedChoices(null)
    event._pageIndex = 0
    expect(StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No']).has(0)).toBe(false)
    StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No']).add(0)
    StoryFailureMemory.settleUnownedChoices(null)
    expect(StoryFailureMemory.choiceAttempts(6, 22, ['Yes', 'No']).has(0)).toBe(true)
  })

  test('reevaluates a blocked route only after the blocking event changes', () => {
    const blocker = { _pageIndex: 0, _erased: false }
    engine.$gameMap.event = (eventId: number) => (eventId === 7 ? blocker : event)
    StoryFailureMemory.record(6, 52, 'no_path', 'Blocked by door 7', { blockerEventIds: [7] })
    variables[99] = 100
    expect(StoryFailureMemory.blocked(6, 52)).toBeDefined()
    blocker._pageIndex = 1
    expect(StoryFailureMemory.blocked(6, 52)).toBeUndefined()
  })

  test('does not let the same planned route erase an observed navigation failure', () => {
    const route = jest.spyOn(navigation, 'planMapRoute').mockReturnValue({ status: 'reachable', eventBoundaryIds: [] } as any)
    try {
      event._x = 18
      event._y = 25
      StoryFailureMemory.record(6, 17, 'no_path', 'Actual interaction could not reach the chest')
      expect(StoryFailureMemory.blocked(6, 17)?.reason).toBe('no_path')
      variables[99] = 123
      expect(StoryFailureMemory.blocked(6, 17)?.reason).toBe('no_path')
    } finally {
      route.mockRestore()
    }
  })

  test('reevaluates an older navigation algorithm once while retaining its evidence', () => {
    const route = jest.spyOn(navigation, 'planMapRoute').mockReturnValue({ status: 'reachable', eventBoundaryIds: [] } as any)
    try {
      const failure = StoryFailureMemory.record(6, 60, 'no_path', 'Older planner timed out before reaching the tutorial')
      const facts = JSON.parse(failure.facts!)
      facts[facts.length - 1] = ['navigation', ['reachable', []]]
      failure.facts = JSON.stringify(facts)
      expect(StoryFailureMemory.blocked(6, 60)).toBeUndefined()
      StoryFailureMemory.record(6, 60, 'no_path', 'Still blocked after using the corrected planner')
      expect(StoryFailureMemory.blocked(6, 60)?.detail).toBe('Still blocked after using the corrected planner')
      expect(StoryFailureMemory.history(6, 60)).toHaveLength(2)
    } finally {
      route.mockRestore()
    }
  })
})
