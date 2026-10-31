import { battleFrame, runningCoordinator } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { chooseAction } from '@/lib/game-agent/companion/core/action-selector'
import { evaluateSituation } from '@/lib/game-agent/companion/core/situation'
import { DEFAULT_TACTIC_PLAN } from '@/lib/game-agent/companion/core/tactics'
import type { ActionIntent } from '@/lib/game-agent/companion/core/types'
import { readLiveBattleFrame } from '@/plugins/mv/src/agent/runtime/companion-core/battle-adapter'

const world = globalThis as unknown as Record<string, unknown>
const keys = ['SceneManager', 'Scene_Battle', 'BattleManager', '$gameParty', '$gameTroop', '$dataSkills']
let previous: unknown[]
let actor: Record<string, unknown>
let turn: number
let skills: Record<string, unknown>[]

beforeEach(() => {
  previous = keys.map((k) => world[k])
  turn = 0
  skills = []
  actor = {
    actorId: () => 1,
    name: () => 'Hero',
    hp: 100,
    mhp: 100,
    mp: 50,
    mmp: 50,
    tp: 0,
    _actionInputIndex: 0,
    canUse: () => true,
    canAttack: () => true,
    canGuard: () => true,
    skills: () => skills,
    addedSkillTypes: () => [1],
  }
  world.SceneManager = { _scene: { constructor: { name: 'Scene_Battle' } } }
  world.BattleManager = { _turnCount: 999, isInputting: () => true, actor: () => actor }
  world.$gameParty = { battleMembers: () => [actor] }
  world.$dataSkills = [null, { id: 1, mpCost: 0, tpCost: 0 }, { id: 2, mpCost: 0, tpCost: 0 }]
  world.$gameTroop = { turnCount: () => turn, members: () => [{ enemyId: () => 10, name: () => 'Slime', hp: 100, mhp: 100 }] }
})
afterEach(() =>
  keys.forEach((k, i) => {
    if (previous[i] === undefined) delete world[k]
    else world[k] = previous[i]
  })
)

const read = (encounter = 'enc-1') => readLiveBattleFrame(battleFrame().stamp, 1, encounter)!

test('does not offer a learned skill whose type has no battle command', () => {
  skills = [{ id: 10, stypeId: 1, scope: 7, mpCost: 5, tpCost: 0, damage: { type: 3 } }]
  expect(read().offers.some((offer) => offer.abilityId === 10)).toBe(true)
  actor.addedSkillTypes = () => []
  expect(read().offers.some((offer) => offer.abilityId === 10)).toBe(false)
})

test('budgets actual attack and guard costs across action slots and respects reserved MP', () => {
  world.$dataSkills = [null, { id: 1, mpCost: 30, tpCost: 0 }, { id: 2, mpCost: 2, tpCost: 5 }]
  actor.skillMpCost = (skill: { mpCost: number }) => skill.mpCost / 2
  actor.skillTpCost = (skill: { tpCost: number }) => skill.tpCost
  actor.mp = 20
  actor.tp = 10
  const intents: ActionIntent[] = []
  const { coordinator } = runningCoordinator({ onDispatchIntent: (intent) => intents.push(intent) })
  expect(read().offers.map((offer) => offer.costs)).toEqual([
    { mp: 15, tp: 0 },
    { mp: 1, tp: 5 },
  ])
  coordinator.onFrameUpdate(read())
  coordinator.onCommandCommitted(intents[0].commandId)
  actor._actionInputIndex = 1
  coordinator.onFrameUpdate(read())
  expect(intents.map((intent) => intent.actionOffer.kind)).toEqual(['attack', 'guard'])
  coordinator.onCommandCommitted(intents[1].commandId)
  actor._actionInputIndex = 2
  coordinator.addPlayerConstraint({ kind: 'reserve_mp', param: 4 })
  coordinator.onFrameUpdate(read())
  expect(intents).toHaveLength(2)
})

test('marks unavailable or invalid skill costs unknown instead of assuming free actions', () => {
  delete world.$dataSkills
  expect(read().offers.every((offer) => offer.costs.hasUnknownCost)).toBe(true)
  const frame = read()
  expect(chooseAction(frame, evaluateSituation(frame), DEFAULT_TACTIC_PLAN).kind).toBe('blocked')
  skills = [{ id: 10, stypeId: 1, scope: 7, mpCost: Number.NaN, tpCost: 0 }]
  expect(read().offers.find((offer) => offer.abilityId === 10)?.costs.hasUnknownCost).toBe(true)
})

test('uses the authoritative encounter ID, troop turn and actual input slot', () => {
  const first = read()
  expect(first.encounterId).toBe('enc-1')
  expect(first.turnCount).toBe(0)
  expect(first.opportunity?.actionSlot).toBe(0)
  actor._actionInputIndex = 1
  const second = read()
  expect(second.opportunity?.actionSlot).toBe(1)
  expect(second.opportunity?.opportunityId).not.toBe(first.opportunity?.opportunityId)
  turn++
  expect(read().opportunity?.opportunityId).not.toBe(second.opportunity?.opportunityId)
  expect(read().encounterId).toBe(first.encounterId)
  expect(read('enc-2').opportunity?.opportunityId).not.toBe(read().opportunity?.opportunityId)
  expect(read('')).toBeNull()
})

test('requires a known action slot and does not assume missing capability methods permit actions', () => {
  delete actor._actionInputIndex
  expect(read()).toBeNull()
  actor._actionInputIndex = 0
  delete actor.canAttack
  delete actor.canGuard
  expect(read().offers).toEqual([])
})

test('does not target hidden reinforcements and preserves visible enemies original troop indices', () => {
  world.$gameTroop = {
    turnCount: () => turn,
    members: () => [
      { enemyId: () => 10, hp: 1, mhp: 100, isDead: () => false, isAppeared: () => false },
      { enemyId: () => 11, hp: 100, mhp: 100, isDead: () => false, isAppeared: () => true },
      { enemyId: () => 12, hp: 1, mhp: 100, isDead: () => false, isHidden: () => true },
    ],
  }
  const frame = read()
  expect(frame.enemies).toMatchObject([{ enemyId: 11, index: 1, instanceId: 'enemy:1' }])
  expect(chooseAction(frame, evaluateSituation(frame), DEFAULT_TACTIC_PLAN)).toMatchObject({
    kind: 'action',
    intent: { target: { entityId: 11, targetIndex: 1, instanceId: 'enemy:1' } },
  })
})

test('declares HP recovery from mechanics, excludes revival scopes and does not infer effects from names', () => {
  skills = [
    { id: 10, stypeId: 1, name: 'Cure shield', scope: 7, damage: { type: 0 } },
    { id: 11, stypeId: 1, name: 'Restore', scope: 7, damage: { type: 3 } },
    { id: 12, stypeId: 1, name: 'Revive', scope: 9, damage: { type: 3 } },
    { id: 13, stypeId: 1, name: 'Restore all', scope: 8, effects: [{ code: 11, value1: 0.5, value2: 0 }] },
    { id: 14, stypeId: 1, name: 'Mana', scope: 7, damage: { type: 4 } },
  ]
  const offers = read().offers
  expect(offers.find((o) => o.abilityId === 10)?.effect.kind).toBe('other')
  expect(offers.find((o) => o.abilityId === 11)).toMatchObject({ effect: { kind: 'heal' }, targetRule: 'one_ally', skillTypeId: 1 })
  expect(offers.find((o) => o.abilityId === 12)?.targetRule).toBe('unsupported')
  expect(offers.find((o) => o.abilityId === 13)?.effect.kind).toBe('heal')
  expect(offers.find((o) => o.abilityId === 14)?.effect.kind).not.toBe('heal')
})
