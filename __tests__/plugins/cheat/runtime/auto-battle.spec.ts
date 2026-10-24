/**
 * @jest-environment jsdom
 */
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
  for (const key of ['BattleManager', 'Scene_Battle', 'SceneManager', 'Game_Actor', '$gameParty', '$gameTroop', '$gameMessage'] as const) {
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
