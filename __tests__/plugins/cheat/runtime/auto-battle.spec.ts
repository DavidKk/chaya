/**
 * @jest-environment jsdom
 */
import { makeSmartAutoBattleActions } from '@/plugins/mv/src/cheat/runtime/auto-battle'
import { Cheats } from '@/plugins/mv/src/cheat/runtime/cheats'

import { installActionFixture } from './auto-battle-fixture'

afterEach(() => {
  Cheats.disposeHooks()
  for (const key of ['BattleManager', 'Scene_Battle', 'SceneManager', 'Game_Actor', 'Game_Action', '$gameParty', '$gameTroop', '$gameMessage'] as const) {
    delete (globalThis as Record<string, unknown>)[key]
  }
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

    const skill = { id: 10, scope: 1, damage: { type: 1, formula: '60' } }
    installActionFixture([skill])
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

    const healSkill = { id: 25, damage: { type: 3, formula: '60' }, stypeId: 1, scope: 7 }
    const attackSkill = { id: 11, damage: { type: 1 }, scope: 1 }
    installActionFixture([healSkill, attackSkill])
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

    const aoeSkill = { id: 30, damage: { type: 1, formula: '60' }, scope: 2 }
    const singleSkill = { id: 31, damage: { type: 1 }, scope: 1 }
    installActionFixture([aoeSkill, singleSkill])
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
})
