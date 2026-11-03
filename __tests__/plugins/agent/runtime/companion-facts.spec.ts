import { GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import { createCompanionFacts } from '@/plugins/mv/src/agent/runtime/companion-facts'
import { createCompanionHost } from '@/plugins/mv/src/agent/runtime/companion-host'
import { collectCompanionMemory } from '@/plugins/mv/src/agent/runtime/companion-memory-collector'

it('refreshes legal actions and mechanics when skills change without changing their count', () => {
  const skills = [null, { id: 1, name: 'Fire', scope: 1, effects: [] }, { id: 2, name: 'Ice', scope: 1, effects: [] }]
  let skillId = 1
  let canUse = true
  let inputting = true
  const member = {
    actorId: () => 1,
    canMove: () => true,
    isDead: () => false,
    skills: () => [skills[skillId]],
    canUse: () => canUse,
    states: () => [],
  }
  const globals = {
    $gameParty: { inBattle: () => true, members: () => [member] },
    $dataSkills: skills,
    BattleManager: { isInputting: () => inputting },
  }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  const facts = createCompanionFacts({ libraryGameId: 'game', runtimeInstanceId: 'runtime', pluginInstanceId: 'plugin', connectionId: 'connection' }, 1)
  try {
    expect(Object.keys(facts.current().mechanics.skills)).toEqual(['1'])
    skillId = 2
    const changed = facts.current()
    expect(changed.current.legalActions.value?.map((action) => action.id)).toEqual([2])
    expect(Object.keys(changed.mechanics.skills)).toEqual(['2'])
    inputting = false
    canUse = false
    const exhausted = facts.current()
    expect(exhausted.current.legalActions.value).toEqual([])
    expect(Object.keys(exhausted.mechanics.skills)).toEqual([])
  } finally {
    facts.dispose()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

it('records an event using the lightweight stamp without reading all game facts', async () => {
  const facts = createCompanionFacts({ libraryGameId: 'game', runtimeInstanceId: 'runtime', pluginInstanceId: 'plugin', connectionId: 'connection' }, 1)
  const memory = new GameplayMemoryStore()
  const current = jest.spyOn(facts, 'current')
  const ingest = jest.spyOn(memory, 'ingest')
  const collector = collectCompanionMemory(facts, memory, jest.fn())
  try {
    facts.onSaveLifecycle({ kind: 'save', operationId: 'save', phase: 'begin', saveKind: 'native', at: 1 })
    await collector.close()
    expect(current).not.toHaveBeenCalled()
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ stamp: facts.stamp() }))
  } finally {
    await collector.close()
    facts.dispose()
  }
})

it('queries battle-start memories only for an actual battle-start event', async () => {
  const battle = { setup: () => {} }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'BattleManager')
  Object.assign(globalThis, { BattleManager: battle })
  const facts = createCompanionFacts({ libraryGameId: 'game', runtimeInstanceId: 'runtime', pluginInstanceId: 'plugin', connectionId: 'connection' }, 1)
  const memory = new GameplayMemoryStore()
  const query = jest.spyOn(memory, 'queryDetailed')
  const host = createCompanionHost({
    facts,
    memory,
    libraryGameId: 'game',
    complete: jest.fn(),
    startControl: jest.fn(),
    stopExternalControl: jest.fn(),
  })
  try {
    await memory.ready()
    battle.setup()
    expect(query).toHaveBeenCalledTimes(1)
    facts.onSaveLifecycle({ kind: 'save', operationId: 'save', phase: 'begin', saveKind: 'native', at: 1 })
    expect(query).toHaveBeenCalledTimes(1)
  } finally {
    host.dispose()
    facts.dispose()
    if (previous) Object.defineProperty(globalThis, 'BattleManager', previous)
    else Reflect.deleteProperty(globalThis, 'BattleManager')
  }
})
