/**
 * @jest-environment jsdom
 */
import { estimateHpRecovery, estimateMpRecovery, makeSmartAutoBattleActions, selectBestAction } from '@/plugins/mv/src/cheat/runtime/auto-battle'

import { installActionFixture } from './auto-battle-fixture'

function scenario(skills: any[], items: any[] = [], overrides: Record<string, unknown> = {}) {
  const actor = {
    hp: 100,
    mhp: 100,
    mp: 100,
    mmp: 100,
    tp: 100,
    index: () => 0,
    canAttack: () => true,
    canGuard: () => true,
    canUse: () => true,
    usableSkills: () => skills,
    skills: () => skills,
    ...overrides,
  }
  const enemy = { hp: 500, index: () => 2 }
  installActionFixture(skills, items)
  Object.assign(globalThis, {
    $gameParty: { aliveMembers: () => [actor], deadMembers: () => [], items: () => items, numItems: () => 5 },
    $gameTroop: { aliveMembers: () => [enemy] },
  })
  return actor
}

afterEach(() => {
  for (const key of ['Game_Action', '$gameParty', '$gameTroop'] as const) delete (globalThis as any)[key]
})

it('prefers a useful skill across skill menu types even when its damage is below basic attack', () => {
  const skill = { id: 10, stypeId: 7, scope: 1, mpCost: 5, damage: { type: 1, formula: '10' } }
  const actor = scenario([skill])
  const action = selectBestAction(actor, 100, 100)
  expect(action._skillId).toBe(10)
  expect(action._targetIndex).toBe(2)
})

it('uses basic attack to finish a target without spending MP', () => {
  const skill = { id: 10, scope: 1, mpCost: 5, damage: { type: 1, formula: '100' } }
  const actor = scenario([skill])
  Object.assign(globalThis, { $gameTroop: { aliveMembers: () => [{ hp: 10, index: () => 2 }] } })
  expect(selectBestAction(actor, 100, 100)._actionType).toBe('attack')
})

it('rechecks canUse even when a plugin includes a sealed skill in usableSkills', () => {
  const skill = { id: 10, scope: 1, damage: { type: 1, formula: '100' } }
  const actor = scenario([skill], [], { canUse: () => false })
  expect(selectBestAction(actor, 100, 100)._actionType).toBe('attack')
})

it.each([0, 8])('does not treat a scope %s skill with an empty effect list as an enemy attack', (scope) => {
  const skill = { id: 10, scope, damage: { type: 0 }, effects: [] }
  const actor = scenario([skill])
  Object.assign(globalThis, { $gameTroop: { aliveMembers: () => [{ hp: 100 }, { hp: 100 }] } })
  expect(selectBestAction(actor, 100, 100)._actionType).toBe('attack')
})

it('ignores an empty AoE action and selects a useful single-target skill', () => {
  const empty = { id: 10, scope: 2, damage: { type: 0 }, effects: [] }
  const useful = { id: 11, scope: 1, damage: { type: 1, formula: '50' } }
  const actor = scenario([empty, useful])
  Object.assign(globalThis, { $gameTroop: { aliveMembers: () => [{ hp: 100 }, { hp: 100 }] } })
  expect(selectBestAction(actor, 100, 100)._skillId).toBe(11)
})

it('skips an AoE formula that needs execution context instead of wasting a turn', () => {
  const skill = { id: 10, scope: 2, damage: { type: 1, formula: 'missingContext' }, effects: [] }
  const actor = scenario([skill])
  Object.assign(globalThis, { $gameTroop: { aliveMembers: () => [{ hp: 100 }, { hp: 100 }] } })
  expect(selectBestAction(actor, 100, 100)._actionType).toBe('attack')
})

it('targets an ally who can still receive a buff instead of the already capped caster', () => {
  const skill = { id: 10, scope: 7, effects: [{ code: 31, dataId: 6 }] }
  const actor = scenario([skill], [], { isMaxBuffAffected: () => true })
  const ally = { hp: 100, mhp: 100, index: () => 3, isMaxBuffAffected: () => false }
  Object.assign(globalThis, { $gameParty: { aliveMembers: () => [actor, ally], deadMembers: () => [] } })
  const action = selectBestAction(actor, 100, 100)
  expect(action._skillId).toBe(10)
  expect(action._targetIndex).toBe(3)
})

it.each([
  { scope: 11, effects: [{ code: 31, dataId: 6 }], isMaxBuffAffected: () => true },
  { scope: 11, effects: [{ code: 21, dataId: 7, value1: 1 }], isStateAffected: () => true },
  { scope: 7, effects: [{ code: 11, value1: 0, value2: 100 }] },
])('does not spam an ineffective ally skill when disarmed: %j', ({ scope, effects, ...flags }) => {
  const skill = { id: 10, scope, effects }
  const actor = scenario([skill], [], { canAttack: () => false, ...flags })
  expect(selectBestAction(actor, 100, 100)._actionType).toBe('guard')
})

it.each([{ isStateAffected: () => true }, { isStateResist: () => true }, { stateRate: () => 0 }])(
  'skips a control skill when the enemy already has or is immune to its effect: %j',
  (flags) => {
    const skill = { id: 10, scope: 1, effects: [{ code: 21, dataId: 7, value1: 1 }] }
    const actor = scenario([skill], [], { canAttack: () => false })
    Object.assign(globalThis, { $gameTroop: { aliveMembers: () => [{ hp: 100, ...flags }] } })
    expect(selectBestAction(actor, 100, 100)._actionType).toBe('guard')
  }
)

it('uses control on the enemy who does not have the state yet', () => {
  const skill = { id: 10, scope: 1, effects: [{ code: 21, dataId: 7, value1: 1 }] }
  const actor = scenario([skill])
  Object.assign(globalThis, {
    $gameTroop: {
      aliveMembers: () => [
        { hp: 100, index: () => 0, isStateAffected: () => true },
        { hp: 200, index: () => 1, isStateAffected: () => false },
      ],
    },
  })
  const action = selectBestAction(actor, 100, 100)
  expect(action._skillId).toBe(10)
  expect(action._targetIndex).toBe(1)
})

it('treats MV negative HP/MP recovery formula damage as positive recovery', () => {
  const heal = { id: 10, stypeId: 1, scope: 7, damage: { type: 3, formula: '200' } }
  const ether = { id: 11, scope: 7, damage: { type: 4, formula: '50' } }
  const actor = scenario([heal], [ether])
  expect(estimateHpRecovery(heal, actor, actor)).toBe(200)
  expect(estimateMpRecovery(ether, actor, actor)).toBe(50)
})

it('does not choose a broken healing formula over a working healing item', () => {
  const heal = { id: 10, stypeId: 1, scope: 7, damage: { type: 3, formula: 'missingContext' } }
  const potion = { id: 11, scope: 7, effects: [{ code: 11, value1: 0, value2: 100 }] }
  const actor = scenario([heal], [potion], { hp: 10 })
  expect(selectBestAction(actor, 100, 100)._itemId).toBe(11)
})

it('does not use an MP recovery skill that costs more MP than it restores', () => {
  const mpSkill = { id: 10, stypeId: 1, scope: 11, mpCost: 10, damage: { type: 4, formula: '5' } }
  const ether = { id: 11, scope: 7, effects: [{ code: 12, value1: 0, value2: 90 }] }
  const actor = scenario([mpSkill], [ether], { mp: 10 })
  expect(selectBestAction(actor, 10, 100)._itemId).toBe(11)
})

it('accounts for restored MP so multiple slots do not consume another ether immediately', () => {
  const skill = { id: 10, scope: 1, mpCost: 5, damage: { type: 1, formula: '50' } }
  const ether = { id: 11, scope: 7, effects: [{ code: 12, value1: 0, value2: 100 }] }
  const setAction = jest.fn()
  const actor = scenario([skill], [ether], { mp: 10, numActions: () => 2, setAction })
  makeSmartAutoBattleActions(actor)
  expect(setAction.mock.calls[0][1]._itemId).toBe(11)
  expect(setAction.mock.calls[1][1]._skillId).toBe(10)
})

it('reserves TP across action slots and falls back when the remaining budget is too small', () => {
  const skill = { id: 10, scope: 1, tpCost: 60, damage: { type: 1, formula: '50' } }
  const setAction = jest.fn()
  const actor = scenario([skill], [], { tp: 100, numActions: () => 2, setAction })
  makeSmartAutoBattleActions(actor)
  expect(setAction.mock.calls[0][1]._skillId).toBe(10)
  expect(setAction.mock.calls[1][1]._actionType).toBe('attack')
})

it('allows repeated use of a nonconsumable throwing item', () => {
  const bomb = { id: 10, scope: 4, consumable: false, damage: { type: 1, formula: '50' } }
  const setAction = jest.fn()
  const actor = scenario([], [bomb], { canAttack: () => false, numActions: () => 2, setAction })
  Object.assign(globalThis, { $gameParty: { items: () => [bomb], numItems: () => 1 } })
  makeSmartAutoBattleActions(actor)
  expect(setAction.mock.calls.map(([, action]) => action._itemId)).toEqual([10, 10])
})

it('does not submit a sealed guard or attack when neither is usable', () => {
  const actor = scenario([], [], { canAttack: () => false, canGuard: () => false })
  expect(selectBestAction(actor, 100, 100)._actionType).toBe('none')
})

it.each(['missingContext', '0'])('does not waste a throwing item with ineffective formula %s', (formula) => {
  const bomb = { id: 10, scope: 1, damage: { type: 1, formula } }
  const actor = scenario([], [bomb], { canAttack: () => false })
  expect(selectBestAction(actor, 100, 100)._actionType).toBe('guard')
})

it('throws at a vulnerable enemy instead of an immune focus target', () => {
  const bomb = { id: 10, scope: 1, damage: { type: 1, formula: '50' } }
  const actor = scenario([], [bomb], { canAttack: () => false })
  Object.assign(globalThis, {
    $gameTroop: {
      aliveMembers: () => [
        { hp: 10, index: () => 0, damageRate: 0 },
        { hp: 100, index: () => 1 },
      ],
    },
  })
  const action = selectBestAction(actor, 100, 100)
  expect(action._itemId).toBe(10)
  expect(action._targetIndex).toBe(1)
})

it('includes recovery and pharmacology modifiers when matching the real HP gap', () => {
  const small = { id: 10, scope: 7, effects: [{ code: 11, value1: 0, value2: 50 }] }
  const large = { id: 11, scope: 7, effects: [{ code: 11, value1: 0, value2: 200 }] }
  const actor = scenario([], [small, large], { hp: 100, mhp: 300, rec: 2, pha: 2 })
  expect(estimateHpRecovery(small, actor, actor)).toBe(200)
  expect(selectBestAction(actor, 100, 100)._itemId).toBe(10)
})
