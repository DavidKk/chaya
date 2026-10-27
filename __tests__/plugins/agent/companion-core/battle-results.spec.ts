import { battleFrame, runningCoordinator } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import type { ActionIntent, ObservedActionResult } from '@/lib/game-agent/companion/core/types'
import type { BattleResultGameEvent } from '@/lib/game-agent/companion/types'
import { bindBattleCommand } from '@/plugins/mv/src/agent/runtime/companion-core/battle-command-binding'
import { installBattleResultHook } from '@/plugins/mv/src/agent/runtime/companion-core/battle-result-hook'
import { type CompanionFactsInstance, createCompanionFacts } from '@/plugins/mv/src/agent/runtime/companion-facts'

const world = globalThis as unknown as Record<string, unknown>
const keys = ['BattleManager', 'Game_Action', '$gameParty', '$gameTroop', 'DataManager']
let previous: unknown[]
let facts: CompanionFactsInstance
let remove: () => void
let results: ObservedActionResult[]
let outcomes: Array<{ id: string; outcome: BattleResultGameEvent['outcome']; turns: number }>
let escapeSuccess: boolean

function target(enemy: boolean, id: number) {
  return {
    hp: 50,
    mhp: 100,
    isEnemy: () => enemy,
    isActor: () => !enemy,
    index: () => 0,
    actorId: () => id,
    enemyId: () => id,
    states: () => [],
    result: () => ({ hpDamage: 999 }),
  }
}
type Target = ReturnType<typeof target>
const hero = target(false, 1)
class GameAction {
  constructor(private damage = 10) {}
  subject() {
    return hero
  }
  item() {
    return { id: 1, name: 'Attack' }
  }
  isItem() {
    return false
  }
  apply(t: Target) {
    t.hp = Math.max(0, Math.min(t.mhp, t.hp - this.damage))
  }
}
const battle = {
  setup() {},
  startAction() {},
  endAction() {},
  processVictory() {},
  processDefeat() {},
  processAbort() {},
  processEscape() {
    if (escapeSuccess) this.processAbort()
    return escapeSuccess
  },
  invokeMagicReflection(action: GameAction, t: Target) {
    action.apply(t)
  },
  invokeCounterAttack(action: GameAction, t: Target) {
    action.apply(t)
  },
}
const encounterId = () => facts.current().current.encounterId.value!
const bind = (action: object, command = 'cmd-1') => bindBattleCommand(action, command, encounterId(), facts.stamp())

beforeEach(() => {
  previous = keys.map((k) => world[k])
  escapeSuccess = true
  results = []
  outcomes = []
  world.Game_Action = GameAction
  world.BattleManager = battle
  world.$gameParty = { battleMembers: () => [hero], aliveMembers: () => [hero], inBattle: () => true }
  world.$gameTroop = { turnCount: () => 3, members: () => [] }
  world.DataManager = { setupNewGame() {} }
  facts = createCompanionFacts({ libraryGameId: 'g1', runtimeInstanceId: 'inst-1', pluginInstanceId: 'plugin', connectionId: 'conn' }, 1)
  remove = installBattleResultHook(
    facts,
    (r) => results.push(r),
    (id, outcome, turns) => outcomes.push({ id, outcome, turns })
  )
  battle.setup()
})
afterEach(() => {
  remove()
  facts.dispose()
  keys.forEach((k, i) => {
    if (previous[i] === undefined) delete world[k]
    else world[k] = previous[i]
  })
})

test('correlates exact action objects and preserves distinct repeated/multi-target result IDs', () => {
  const action = new GameAction(10)
  bind(action)
  battle.startAction()
  action.apply(target(true, 10))
  action.apply(target(true, 11))
  action.apply(target(true, 11))
  battle.endAction()
  expect(results).toHaveLength(3)
  expect(new Set(results.map((r) => r.actionId)).size).toBe(1)
  expect(new Set(results.map((r) => r.resultId)).size).toBe(3)
  expect(results[0]).toMatchObject({ commandId: 'cmd-1', actorId: 1, targetId: 10, hpDamage: 10, encounterId: encounterId() })
  expect(results[1]).toMatchObject({ commandId: 'cmd-1', targetId: 11, hpDamage: 10 })
  new GameAction(-30).apply(target(false, 2))
  expect(results.at(-1)).toMatchObject({ hpRecovery: 30, targetKind: 'actor', targetId: 2 })
  expect(results.at(-1)?.commandId).toBeUndefined()
})

test('does not attribute counters, reflections or an action from another encounter to the selected command', () => {
  const action = new GameAction()
  bind(action)
  battle.startAction()
  battle.invokeCounterAttack(action, target(false, 1))
  battle.invokeMagicReflection(action, target(false, 1))
  expect(results.every((r) => r.commandId === undefined && r.actorId === undefined)).toBe(true)
  battle.setup()
  battle.startAction()
  action.apply(target(true, 10))
  expect(results.at(-1)?.commandId).toBeUndefined()
})

test.each(['win', 'lose', 'escape', 'abort'] as const)('forwards actual %s outcome exactly once, including standalone abort', (outcome) => {
  const id = encounterId()
  const method = { win: 'processVictory', lose: 'processDefeat', escape: 'processEscape', abort: 'processAbort' } as const
  battle[method[outcome]]()
  battle.processAbort()
  expect(outcomes).toEqual([{ id, outcome, turns: 3 }])
})

test('failed escape leaves the encounter active without fabricating a battle result', () => {
  escapeSuccess = false
  const id = encounterId()
  battle.processEscape()
  expect(outcomes).toEqual([])
  expect(encounterId()).toBe(id)
})

test('feeds authoritative results into the ledger without counting a duplicate event twice', () => {
  const intents: ActionIntent[] = []
  const { coordinator } = runningCoordinator({ onDispatchIntent: (i) => intents.push(i) })
  const id = encounterId()
  coordinator.onFrameUpdate(battleFrame({ encounterId: id, stamp: facts.stamp() }))
  const unsubscribe = installBattleResultHook(
    facts,
    (r) => {
      coordinator.onCommandResult(r)
      coordinator.onCommandResult(r)
    },
    (enc, outcome, turns) => coordinator.onEncounterResult(enc, outcome, turns)
  )
  const action = new GameAction()
  bind(action, intents[0].commandId)
  battle.startAction()
  action.apply(target(true, 10))
  battle.endAction()
  battle.processVictory()
  expect(coordinator.ledger.getCommand(intents[0].commandId)?.results).toHaveLength(1)
  expect(coordinator.ledger.getEncounter(id)).toMatchObject({ outcome: 'win', turnsCount: 3, commandsCommitted: 1 })
  unsubscribe()
})

test('retiring fact hooks keeps a later plugin wrapper intact and stops publishing results', () => {
  const installed = GameAction.prototype.apply
  const wrapper = jest.fn(function (this: GameAction, t: Target) {
    installed.call(this, t)
  })
  GameAction.prototype.apply = wrapper
  facts.dispose()
  expect(GameAction.prototype.apply).toBe(wrapper)
  const t = target(true, 10)
  new GameAction().apply(t)
  expect(wrapper).toHaveBeenCalledTimes(1)
  expect(t.hp).toBe(40)
  expect(results).toEqual([])
  // The simulated plugin is removed explicitly; facts never owns this wrapper.
  GameAction.prototype.apply = installed
})
