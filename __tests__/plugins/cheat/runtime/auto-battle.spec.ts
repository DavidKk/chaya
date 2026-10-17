/**
 * @jest-environment jsdom
 */
import { Cheats } from '@/plugins/src/cheat/runtime/cheats'

class Scene_Battle {}

afterEach(() => {
  Cheats.disposeHooks()
  for (const key of ['BattleManager', 'Scene_Battle', 'SceneManager', '$gameParty', '$gameTroop'] as const) {
    delete (globalThis as Record<string, unknown>)[key]
  }
})

it('picks an action and starts the turn once per input phase', () => {
  const actor = { canInput: () => true, makeAutoBattleActions: jest.fn() }
  const startTurn = jest.fn()
  const command = { deactivate: jest.fn(), close: jest.fn(), hide: jest.fn() }
  const scene = new Scene_Battle()
  Object.assign(scene, { _actorCommandWindow: command })
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: scene },
    BattleManager: { _phase: 'input', startTurn },
    $gameParty: { battleMembers: () => [actor, { canInput: () => false, makeAutoBattleActions: jest.fn() }] },
    $gameTroop: { isEventRunning: () => false },
  })

  Cheats.setAutoBattle(true)
  expect(actor.makeAutoBattleActions).toHaveBeenCalledTimes(1)
  expect(startTurn).toHaveBeenCalledTimes(1)
  expect(command.close).toHaveBeenCalled()

  Cheats.setAutoBattle(true)
  expect(startTurn).toHaveBeenCalledTimes(1)

  ;(globalThis as { BattleManager: { _phase: string } }).BattleManager._phase = 'turn'
  Cheats.setAutoBattle(true)
  ;(globalThis as { BattleManager: { _phase: string } }).BattleManager._phase = 'input'
  Cheats.setAutoBattle(true)
  expect(startTurn).toHaveBeenCalledTimes(2)
})
