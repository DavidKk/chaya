import { battleFrame } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { readLiveBattleFrame } from '@/plugins/mv/src/agent/runtime/companion-core/battle-adapter'

const world = globalThis as unknown as Record<string, unknown>
const keys = ['SceneManager', 'Scene_Battle', 'BattleManager', '$gameParty', '$gameTroop']
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
  }
  world.SceneManager = { _scene: { constructor: { name: 'Scene_Battle' } } }
  world.BattleManager = { _turnCount: 999, isInputting: () => true, actor: () => actor }
  world.$gameParty = { battleMembers: () => [actor] }
  world.$gameTroop = { turnCount: () => turn, members: () => [{ enemyId: () => 10, name: () => 'Slime', hp: 100, mhp: 100 }] }
})
afterEach(() =>
  keys.forEach((k, i) => {
    if (previous[i] === undefined) delete world[k]
    else world[k] = previous[i]
  })
)

const read = (encounter = 'enc-1') => readLiveBattleFrame(battleFrame().stamp, 1, encounter)!

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
