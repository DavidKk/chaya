/**
 * @jest-environment jsdom
 */
import { makeSmartAutoBattleActions, matchBestHealingItem } from '@/plugins/mv/src/cheat/runtime/auto-battle'
import { Cheats } from '@/plugins/mv/src/cheat/runtime/cheats'

afterEach(() => {
  Cheats.disposeHooks()
  for (const key of ['BattleManager', 'Scene_Battle', 'SceneManager', 'Game_Actor', 'Game_Action', '$gameParty', '$gameTroop', '$gameMessage'] as const) {
    delete (globalThis as Record<string, unknown>)[key]
  }
})

describe('contextual item and support tactics', () => {
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
      mmp: 100, // 10% MP, below 35% threshold
      usableSkills: () => [{ id: 40, mpCost: 5, damage: { type: 1 } }],
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

  it('uses buff skill (such as AGI buff / Thief sigil) when available and not in crisis', () => {
    const enemy = { hp: 500, index: () => 0 }
    Object.assign(globalThis, {
      $gameParty: {
        aliveMembers: () => [],
        deadMembers: () => [],
        items: () => [],
        numItems: () => 0,
      },
      $gameTroop: { aliveMembers: () => [enemy] },
    })

    const buffSkill = { id: 69, scope: 11, effects: [{ code: 31, dataId: 6, value1: 6 }] }
    const setAction = jest.fn()
    const actor = {
      index: () => 0,
      canAttack: () => false,
      canGuard: () => true,
      usableSkills: () => [buffSkill],
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('skill')
    expect(action._skillId).toBe(69)
  })

  it('uses throwable offensive item when disarmed', () => {
    const enemy = { hp: 300, index: () => 0 }
    const bombItem = { id: 15, scope: 1, damage: { type: 1, formula: '150' } }
    Object.assign(globalThis, {
      $gameParty: {
        aliveMembers: () => [],
        deadMembers: () => [],
        items: () => [bombItem],
        numItems: () => 3,
      },
      $gameTroop: { aliveMembers: () => [enemy] },
    })

    const setAction = jest.fn()
    const actor = {
      index: () => 0,
      canAttack: () => false,
      canGuard: () => true,
      usableSkills: () => [],
      numActions: () => 1,
      setAction,
    }

    makeSmartAutoBattleActions(actor)

    const action = setAction.mock.calls[0][1]
    expect(action._actionType).toBe('item')
    expect(action._itemId).toBe(15)
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
