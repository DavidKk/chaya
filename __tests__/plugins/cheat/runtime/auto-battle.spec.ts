/**
 * @jest-environment jsdom
 */
import { makeSmartAutoBattleActions, matchBestHealingItem } from '@/plugins/mv/src/cheat/runtime/auto-battle'
import { Cheats } from '@/plugins/mv/src/cheat/runtime/cheats'

class Scene_Battle {}

function actorProto() {
  return {
    isAutoBattle() {
      return false
    },
  }
}

afterEach(() => {
  Cheats.disposeHooks()
  for (const key of ['BattleManager', 'Scene_Battle', 'SceneManager', 'Game_Actor', 'Game_Action', '$gameParty', '$gameTroop', '$gameMessage'] as const) {
    delete (globalThis as Record<string, unknown>)[key]
  }
})

it('forces Game_Actor.isAutoBattle while the run flag is on', () => {
  const proto = actorProto()
  Object.assign(globalThis, { Game_Actor: { prototype: proto }, $gameParty: { members: () => [] } })
  Cheats.setAutoBattle(true)
  expect(proto.isAutoBattle()).toBe(true)
  Cheats.setAutoBattle(false)
  expect(proto.isAutoBattle()).toBe(false)
})

it('fills actions for movable actors and starts the turn once per input phase', () => {
  const proto = actorProto()
  const actor = { canMove: () => true, canInput: () => false, makeAutoBattleActions: jest.fn() }
  const startTurn = jest.fn(function (this: { _phase: string }) {
    this._phase = 'turn'
  })
  const command = { deactivate: jest.fn(), close: jest.fn(), hide: jest.fn() }
  const scene = new Scene_Battle()
  Object.assign(scene, { _actorCommandWindow: command })
  const battleManager = { _phase: 'input', startTurn }
  Object.assign(globalThis, {
    Game_Actor: { prototype: proto },
    Scene_Battle,
    SceneManager: { _scene: scene },
    BattleManager: battleManager,
    $gameParty: { battleMembers: () => [actor, { canMove: () => false, makeAutoBattleActions: jest.fn() }] },
    $gameTroop: { isEventRunning: () => false },
    $gameMessage: { isBusy: () => false },
  })

  Cheats.setAutoBattle(true)
  expect(actor.makeAutoBattleActions).toHaveBeenCalledTimes(1)
  expect(startTurn).toHaveBeenCalledTimes(1)
  expect(command.close).toHaveBeenCalled()
  expect(battleManager._phase).toBe('turn')

  Cheats.setAutoBattle(true)
  expect(startTurn).toHaveBeenCalledTimes(1)

  battleManager._phase = 'input'
  Cheats.setAutoBattle(true)
  expect(startTurn).toHaveBeenCalledTimes(2)
})

it('waits for battle messages before starting the turn', () => {
  const proto = actorProto()
  const actor = { canMove: () => true, makeAutoBattleActions: jest.fn() }
  const startTurn = jest.fn()
  Object.assign(globalThis, {
    Game_Actor: { prototype: proto },
    Scene_Battle,
    SceneManager: { _scene: new Scene_Battle() },
    BattleManager: { _phase: 'input', startTurn },
    $gameParty: { battleMembers: () => [actor] },
    $gameTroop: { isEventRunning: () => false },
    $gameMessage: { isBusy: () => true },
  })

  Cheats.setAutoBattle(true)
  expect(actor.makeAutoBattleActions).not.toHaveBeenCalled()
  expect(startTurn).not.toHaveBeenCalled()
})

it('retries when startTurn leaves the battle stuck in input', () => {
  const proto = actorProto()
  const actor = { canMove: () => true, makeAutoBattleActions: jest.fn() }
  const startTurn = jest.fn()
  Object.assign(globalThis, {
    Game_Actor: { prototype: proto },
    Scene_Battle,
    SceneManager: { _scene: new Scene_Battle() },
    BattleManager: { _phase: 'input', startTurn },
    $gameParty: { battleMembers: () => [actor] },
    $gameTroop: { isEventRunning: () => false },
    $gameMessage: { isBusy: () => false },
  })

  Cheats.setAutoBattle(true)
  expect(startTurn).toHaveBeenCalledTimes(1)
  Cheats.setAutoBattle(true)
  expect(startTurn).toHaveBeenCalledTimes(2)
})

describe('smart contextual battle tactics', () => {
  it('chooses guard when actor is disarmed and has no usable skills', () => {
    const setAction = jest.fn()
    const setActionState = jest.fn()
    const actor = {
      canAttack: () => false,
      canGuard: () => true,
      usableSkills: () => [],
      numActions: () => 1,
      setAction,
      setActionState,
    }
    makeSmartAutoBattleActions(actor)

    expect(setAction).toHaveBeenCalledTimes(1)
    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('guard')
    expect(setActionState).toHaveBeenCalledWith('waiting')
  })

  it('chooses usable skill when actor is disarmed but has offensive skill', () => {
    const setAction = jest.fn()
    const enemy = { hp: 100, index: () => 0 }
    Object.assign(globalThis, {
      $gameTroop: { aliveMembers: () => [enemy] },
      $gameParty: { aliveMembers: () => [], deadMembers: () => [] },
    })

    const skill = { id: 10, damage: { type: 1 } }
    const actor = {
      canAttack: () => false,
      canGuard: () => true,
      usableSkills: () => [skill],
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    expect(setAction).toHaveBeenCalledTimes(1)
    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('skill')
    expect(action._skillId).toBe(10)
  })

  it('prioritizes revive when dead allies exist', () => {
    const deadAlly = { index: () => 2 }
    const enemy = { hp: 100, index: () => 0 }
    Object.assign(globalThis, {
      $gameParty: { aliveMembers: [], deadMembers: () => [deadAlly] },
      $gameTroop: { aliveMembers: () => [enemy] },
    })

    const reviveSkill = { id: 50, scope: 9 }
    const attackSkill = { id: 11, damage: { type: 1 }, scope: 1 }
    const setAction = jest.fn()
    const actor = {
      canAttack: () => true,
      usableSkills: () => [attackSkill, reviveSkill],
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('skill')
    expect(action._skillId).toBe(50)
    expect(action._targetIndex).toBe(2)
  })

  it('prioritizes healing when an ally has critically low HP (<40%)', () => {
    const healthyAlly = { hp: 90, mhp: 100, index: () => 0 }
    const dyingAlly = { hp: 20, mhp: 100, index: () => 1 }
    const enemy = { hp: 200, index: () => 0 }
    Object.assign(globalThis, {
      $gameParty: { aliveMembers: () => [healthyAlly, dyingAlly], deadMembers: () => [] },
      $gameTroop: { aliveMembers: () => [enemy] },
    })

    const healSkill = { id: 25, damage: { type: 3 }, scope: 7 }
    const attackSkill = { id: 11, damage: { type: 1 }, scope: 1 }
    const setAction = jest.fn()
    const actor = {
      canAttack: () => true,
      usableSkills: () => [attackSkill, healSkill],
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('skill')
    expect(action._skillId).toBe(25)
    expect(action._targetIndex).toBe(1)
  })

  it('prioritizes AoE skill against 2 or more enemies', () => {
    const enemy1 = { hp: 100, index: () => 0 }
    const enemy2 = { hp: 100, index: () => 1 }
    Object.assign(globalThis, {
      $gameParty: { aliveMembers: () => [], deadMembers: () => [] },
      $gameTroop: { aliveMembers: () => [enemy1, enemy2] },
    })

    const aoeSkill = { id: 30, damage: { type: 1 }, scope: 2 }
    const singleSkill = { id: 31, damage: { type: 1 }, scope: 1 }
    const setAction = jest.fn()
    const actor = {
      canAttack: () => true,
      usableSkills: () => [singleSkill, aoeSkill],
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('skill')
    expect(action._skillId).toBe(30)
  })

  it('tracks virtual MP across multi-action slots', () => {
    const enemy = { hp: 200, index: () => 0 }
    Object.assign(globalThis, {
      $gameParty: { aliveMembers: () => [], deadMembers: () => [] },
      $gameTroop: { aliveMembers: () => [enemy] },
    })

    // Expensive skill costs 20 MP, actor has 30 MP.
    // Slot 1 should pick skill (30 - 20 = 10 left).
    // Slot 2 cannot afford skill (needs 20, has 10), so it should fallback to normal attack.
    const expensiveSkill = { id: 99, damage: { type: 1 }, mpCost: 20 }
    class MockGameAction {
      _targetIndex = -1
      _actionType = 'none'
      _skillId = 0
      _item = { isSkill: () => false }
      setAttack() {
        this._actionType = 'attack'
        this._item = { isSkill: () => false }
      }
      setGuard() {
        this._actionType = 'guard'
        this._item = { isSkill: () => false }
      }
      setSkill(id: number) {
        this._actionType = 'skill'
        this._skillId = id
        this._item = { isSkill: () => true }
      }
      setTarget(i: number) {
        this._targetIndex = i
      }
      makeDamageValue() {
        return this._actionType === 'skill' ? 150 : 80
      }
      item() {
        return this._item.isSkill() ? expensiveSkill : null
      }
    }
    Object.assign(globalThis, { Game_Action: MockGameAction })

    const setAction = jest.fn()
    const actor = {
      canAttack: () => true,
      mp: 30,
      tp: 0,
      skillMpCost: (s: any) => s.mpCost || 0,
      skillTpCost: () => 0,
      usableSkills: () => [expensiveSkill],
      numActions: () => 2,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    expect(setAction).toHaveBeenCalledTimes(2)
    const actionSlot0 = setAction.mock.calls[0][1]
    const actionSlot1 = setAction.mock.calls[1][1]
    expect(actionSlot0._actionType).toBe('skill')
    expect(actionSlot0._skillId).toBe(99)
    expect(actionSlot1._actionType).toBe('attack')
  })

  it('defers to makeConfusionActions when confused', () => {
    const makeConfusionActions = jest.fn()
    const setAction = jest.fn()
    const actor = {
      isConfusion: () => true,
      makeConfusionActions,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    expect(makeConfusionActions).toHaveBeenCalledTimes(1)
    expect(setAction).not.toHaveBeenCalled()
  })

  it('safely handles skill damage formula evaluation errors without crashing', () => {
    const enemy = { hp: 100, index: () => 0 }
    Object.assign(globalThis, {
      $gameParty: { aliveMembers: () => [], deadMembers: () => [] },
      $gameTroop: { aliveMembers: () => [enemy] },
    })

    const faultySkill = { id: 77, damage: { type: 1 } }
    class MockGameAction {
      _targetIndex = -1
      _actionType = 'none'
      setAttack() {
        this._actionType = 'attack'
      }
      setGuard() {
        this._actionType = 'guard'
      }
      setSkill(id: number) {
        this._actionType = 'skill'
        this._skillId = id
      }
      setTarget(i: number) {
        this._targetIndex = i
      }
      makeDamageValue() {
        throw new Error('eval error from third-party plugin')
      }
      item() {
        return null
      }
    }
    Object.assign(globalThis, { Game_Action: MockGameAction })

    const setAction = jest.fn()
    const actor = {
      canAttack: () => true,
      usableSkills: () => [faultySkill],
      numActions: () => 1,
      setAction,
    }

    expect(() => makeSmartAutoBattleActions(actor)).not.toThrow()
    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('attack')
  })

  it('uses a one-argument damage estimate and removes variance from the comparison', () => {
    const enemy = { hp: 200, index: () => 0 }
    const skill = { id: 88, scope: 1, damage: { type: 1, variance: 20 } }
    const originalVariance = skill.damage.variance
    Object.assign(globalThis, {
      $gameParty: { aliveMembers: () => [], deadMembers: () => [] },
      $gameTroop: { aliveMembers: () => [enemy] },
    })

    class StrictGameAction {
      _actionType = 'none'
      _item: any = null
      _targetIndex = -1
      setAttack() {
        this._actionType = 'attack'
        this._item = null
      }
      setGuard() {
        this._actionType = 'guard'
        this._item = null
      }
      setSkill(id: number) {
        this._actionType = 'skill'
        this._skillId = id
        this._item = skill
      }
      setTarget(index: number) {
        this._targetIndex = index
      }
      item() {
        return this._item
      }
      makeDamageValue() {
        if (arguments.length !== 1) throw new Error('expected one argument')
        return this._actionType === 'skill' ? (skill.damage.variance === 0 ? 120 : 55) : 50
      }
    }
    Object.assign(globalThis, { Game_Action: StrictGameAction })

    const setAction = jest.fn()
    const actor = {
      canAttack: () => true,
      usableSkills: () => [skill],
      numActions: () => 1,
      setAction,
    }
    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('skill')
    expect(skill.damage.variance).toBe(originalVariance)
  })

  it('hooks prototype.makeAutoBattleActions when autoBattle is enabled and restores when disabled', () => {
    const origMake = jest.fn()
    const proto = {
      isAutoBattle() {
        return false
      },
      makeAutoBattleActions: origMake,
    }
    Object.assign(globalThis, {
      Game_Actor: { prototype: proto },
      $gameParty: { members: () => [] },
    })

    Cheats.setAutoBattle(true)
    const actor = {
      canAttack: () => false,
      canGuard: () => true,
      usableSkills: () => [],
      setAction: jest.fn(),
      setActionState: jest.fn(),
    }
    proto.makeAutoBattleActions.call(actor)
    expect(actor.setAction).toHaveBeenCalled()
    expect(actor.setAction.mock.calls[0][1]._actionType).toBe('guard')
    expect(origMake).not.toHaveBeenCalled()

    Cheats.setAutoBattle(false)
    proto.makeAutoBattleActions.call(actor)
    expect(origMake).toHaveBeenCalled()
  })

  it('matches healing item to damaged HP gap (e.g. 200 HP deficit picks 200 HP item)', () => {
    const ally = { hp: 300, mhp: 500, index: () => 0 } // deficit = 200
    const smallHerb = { id: 1, scope: 7, effects: [{ code: 11, value1: 0, value2: 50 }] }
    const matchPotion = { id: 2, scope: 7, effects: [{ code: 11, value1: 0, value2: 200 }] }
    const megaElixir = { id: 3, scope: 7, effects: [{ code: 11, value1: 0, value2: 2000 }] }

    const best = matchBestHealingItem([smallHerb, matchPotion, megaElixir], null, ally)
    expect(best).toBe(matchPotion)
  })

  it('filters out obsolete early-game items in late-game high HP pool scenarios', () => {
    // Late-game ally: 4500 MHP, damaged by 2800 HP.
    const lateGameAlly = { hp: 1700, mhp: 4500, index: () => 0 }
    // 50 HP recovery is < 8% of 4500 (360) and < 20% of 2800 (560).
    const smallHerb = { id: 1, scope: 7, effects: [{ code: 11, value1: 0, value2: 50 }] }

    const best = matchBestHealingItem([smallHerb], null, lateGameAlly)
    expect(best).toBeNull() // Filtered out as obsolete, doesn't waste a turn
  })

  it('uses healing item when ally is low HP and actor has no healing skill', () => {
    const dyingAlly = { hp: 50, mhp: 200, index: () => 1 }
    const potion = { id: 5, scope: 7, effects: [{ code: 11, value1: 0, value2: 150 }] }
    Object.assign(globalThis, {
      $gameParty: {
        aliveMembers: () => [dyingAlly],
        deadMembers: () => [],
        items: () => [potion],
        numItems: () => 1,
      },
      $gameTroop: { aliveMembers: () => [{ hp: 100, index: () => 0 }] },
    })

    const setAction = jest.fn()
    const actor = {
      canAttack: () => true,
      usableSkills: () => [], // No healing skill
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('item')
    expect(action._itemId).toBe(5)
    expect(action._targetIndex).toBe(1)
  })

  it('monitors low MP and uses MP recovery item when peaceful', () => {
    const ether = { id: 8, scope: 7, effects: [{ code: 12, value1: 0, value2: 50 }] }
    const healthyAlly = { hp: 100, mhp: 100, index: () => 0 }
    Object.assign(globalThis, {
      $gameParty: {
        aliveMembers: () => [healthyAlly],
        deadMembers: () => [],
        items: () => [ether],
        numItems: () => 1,
      },
      $gameTroop: { aliveMembers: () => [{ hp: 200, index: () => 0 }] },
    })

    const setAction = jest.fn()
    const actor = {
      index: () => 0,
      canAttack: () => true,
      mp: 10,
      mmp: 100, // 10% MP, below 25% threshold
      usableSkills: () => [{ id: 40, damage: { type: 1 } }],
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('item')
    expect(action._itemId).toBe(8)
  })

  it('uses throwable damage item when disarmed and no skills available', () => {
    const bomb = { id: 15, scope: 1, damage: { type: 1 } }
    const enemy = { hp: 80, index: () => 0 }
    Object.assign(globalThis, {
      $gameParty: {
        aliveMembers: () => [],
        deadMembers: () => [],
        items: () => [bomb],
        numItems: () => 1,
      },
      $gameTroop: { aliveMembers: () => [enemy] },
    })

    const setAction = jest.fn()
    const actor = {
      canAttack: () => false, // Disarmed!
      usableSkills: () => [], // No skills
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('item')
    expect(action._itemId).toBe(15)
  })

  it('tracks virtual consumable item quantities across multi-action slots', () => {
    const dyingAlly = { hp: 50, mhp: 200, index: () => 1 }
    const potion = { id: 5, scope: 7, effects: [{ code: 11, value1: 0, value2: 150 }] }
    Object.assign(globalThis, {
      $gameParty: {
        aliveMembers: () => [dyingAlly],
        deadMembers: () => [],
        items: () => [potion],
        numItems: () => 1, // Only 1 potion in party inventory!
      },
      $gameTroop: { aliveMembers: () => [{ hp: 100, index: () => 0 }] },
    })

    const setAction = jest.fn()
    const actor = {
      canAttack: () => true,
      usableSkills: () => [],
      numActions: () => 2, // 2 action slots
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    expect(setAction).toHaveBeenCalledTimes(2)
    const slot0 = setAction.mock.calls[0][1]
    const slot1 = setAction.mock.calls[1][1]
    expect(slot0._actionType).toBe('item')
    expect(slot0._itemId).toBe(5)
    // Slot 1 cannot use potion again because inventory was 1; falls back to attack
    expect(slot1._actionType).toBe('attack')
  })

  it('uses MP item when MP is 0 and actor has learned MP skills even if usableSkills is empty', () => {
    const ether = { id: 8, scope: 7, effects: [{ code: 12, value1: 0, value2: 50 }] }
    const healthyAlly = { hp: 100, mhp: 100, index: () => 0 }
    Object.assign(globalThis, {
      $gameParty: {
        aliveMembers: () => [healthyAlly],
        deadMembers: () => [],
        items: () => [ether],
        numItems: () => 1,
      },
      $gameTroop: { aliveMembers: () => [{ hp: 200, index: () => 0 }] },
    })

    const setAction = jest.fn()
    const actor = {
      index: () => 0,
      canAttack: () => true,
      mp: 0, // 0 MP!
      mmp: 100,
      usableSkills: () => [], // Cannot afford any skill, so usableSkills returns empty!
      skills: () => [{ id: 40, mpCost: 15 }], // Learned skill that needs MP
      skillMpCost: (s: any) => s.mpCost || 0,
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('item')
    expect(action._itemId).toBe(8)
  })

  it('does not use user-only (scope 11) skill or item to heal other allies', () => {
    const dyingOtherAlly = { hp: 10, mhp: 100, index: () => 1 } // Another ally is dying
    const selfOnlyHerb = { id: 9, scope: 11, effects: [{ code: 11, value1: 0, value2: 50 }] }
    Object.assign(globalThis, {
      $gameParty: {
        aliveMembers: () => [dyingOtherAlly],
        deadMembers: () => [],
        items: () => [selfOnlyHerb],
        numItems: () => 1,
      },
      $gameTroop: { aliveMembers: () => [{ hp: 100, index: () => 0 }] },
    })

    const setAction = jest.fn()
    const actor = {
      index: () => 0, // Actor is index 0
      canAttack: () => true,
      usableSkills: () => [],
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    // Scope 11 item should NOT be used on another ally; falls back to attack
    expect(action._actionType).toBe('attack')
  })
})
