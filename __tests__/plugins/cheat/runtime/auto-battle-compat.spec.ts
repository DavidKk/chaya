/**
 * @jest-environment jsdom
 */
import { ensureAutoBattleActorHook, tryAutoBattle } from '@/plugins/mv/src/cheat/runtime/auto-battle'
import { Cheats } from '@/plugins/mv/src/cheat/runtime/cheats'
import { restoreBattleInputWindows } from '@/plugins/mv/src/cheat/session/battle-windows'

afterEach(() => {
  Cheats.disposeHooks()
  for (const key of ['BattleManager', 'Scene_Battle', 'SceneManager', 'Game_Actor', '$gameParty', '$gameTemp', '$gameTroop', '$gameMessage'] as const) {
    delete (globalThis as Record<string, unknown>)[key]
  }
})

it('reads the current runtime flag after a plugin reload replaces the flag provider', () => {
  const originalMake = jest.fn()
  const proto = {
    isAutoBattle: () => false,
    makeAutoBattleActions: originalMake,
  }
  Object.assign(globalThis, { Game_Actor: { prototype: proto } })
  ensureAutoBattleActorHook(() => false)
  let enabled = true
  ensureAutoBattleActorHook(() => enabled)

  expect(proto.isAutoBattle()).toBe(true)
  const actor = Object.assign(Object.create(proto), {
    numActions: () => 0,
    setActionState: jest.fn(),
  })
  actor.makeAutoBattleActions()
  expect(originalMake).not.toHaveBeenCalled()
  expect(actor.setActionState).toHaveBeenCalledWith('waiting')

  enabled = false
  expect(proto.isAutoBattle()).toBe(false)
  actor.makeAutoBattleActions()
  expect(originalMake).toHaveBeenCalledTimes(1)
})

it('submits only the active STB actor without resetting the round or another actor actions', () => {
  class Scene_Battle {}
  const actor = { canMove: () => true, makeAutoBattleActions: jest.fn() }
  const other = { canMove: () => true, makeAutoBattleActions: jest.fn() }
  const startTurn = jest.fn()
  const battleManager = {
    _phase: 'input',
    isSTB: () => true,
    actor: () => actor,
    startTurn,
    selectNextCommand: jest.fn(() => {
      battleManager._phase = 'action'
    }),
  }
  const scene = new Scene_Battle()
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: scene },
    BattleManager: battleManager,
    $gameParty: { battleMembers: () => [actor, other] },
  })

  expect(tryAutoBattle(true, false, null)).toBe(scene)
  expect(actor.makeAutoBattleActions).toHaveBeenCalledTimes(1)
  expect(other.makeAutoBattleActions).not.toHaveBeenCalled()
  expect(battleManager.selectNextCommand).toHaveBeenCalledTimes(1)
  expect(startTurn).not.toHaveBeenCalled()
})

it('lets STB restore its subject when automation starts from the party command', () => {
  class Scene_Battle {}
  const battleManager = {
    _phase: 'input',
    isSTB: () => true,
    actor: () => null,
    selectNextCommand: jest.fn(),
    startTurn: jest.fn(),
  }
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: new Scene_Battle() },
    BattleManager: battleManager,
    $gameParty: { battleMembers: () => [] },
  })

  expect(tryAutoBattle(true, false, null)).toBeNull()
  expect(battleManager.selectNextCommand).toHaveBeenCalledTimes(1)
  expect(battleManager.startTurn).not.toHaveBeenCalled()
})

it('restores actor command window and MOG refresh flag when auto battle is cancelled in input phase', () => {
  class Scene_Battle {}
  const actor = { index: () => 0 }
  const actorWin = {
    setup: jest.fn(() => actorWin.battle_commands_initialize()),
    open: jest.fn(),
    activate: jest.fn(),
    show: jest.fn(),
    battle_commands_initialize: jest.fn(),
    visible: false,
  }
  const partyWin = {
    show: jest.fn(),
    visible: false,
  }
  const scene = Object.assign(new Scene_Battle(), {
    _actorCommandWindow: actorWin,
    _partyCommandWindow: partyWin,
    startActorCommandSelection: jest.fn(() => {
      actorWin.setup(actor)
      actorWin.open()
      actorWin.activate()
    }),
  })
  const gameTemp = { _bcom_need_refresh: false }
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: scene },
    BattleManager: {
      _phase: 'input',
      isInputting: () => true,
      actor: () => actor,
    },
    $gameTemp: gameTemp,
  })

  restoreBattleInputWindows()

  expect(partyWin.show).toHaveBeenCalled()
  expect(actorWin.show).toHaveBeenCalled()
  expect(partyWin.visible).toBe(true)
  expect(actorWin.visible).toBe(true)
  expect(gameTemp._bcom_need_refresh).toBe(true)
  expect(scene.startActorCommandSelection).toHaveBeenCalled()
  expect(actorWin.setup).toHaveBeenCalledWith(actor)
  expect(actorWin.open).toHaveBeenCalled()
  expect(actorWin.activate).toHaveBeenCalled()
  expect(actorWin.battle_commands_initialize).toHaveBeenCalledTimes(1)
})

it('restores party command window when cancelled before an actor is selected', () => {
  class Scene_Battle {}
  const partyWin = {
    open: jest.fn(),
    activate: jest.fn(),
    show: jest.fn(),
    visible: false,
  }
  const actorWin = {
    show: jest.fn(),
    visible: false,
  }
  const scene = Object.assign(new Scene_Battle(), {
    _actorCommandWindow: actorWin,
    _partyCommandWindow: partyWin,
    startPartyCommandSelection: jest.fn(() => {
      partyWin.open()
      partyWin.activate()
    }),
  })
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: scene },
    BattleManager: {
      _phase: 'input',
      isInputting: () => true,
      actor: () => null,
    },
  })

  restoreBattleInputWindows()

  expect(scene.startPartyCommandSelection).toHaveBeenCalled()
  expect(partyWin.open).toHaveBeenCalled()
  expect(partyWin.activate).toHaveBeenCalled()
  expect(partyWin.visible).toBe(true)
})

it.each(['turn', 'action', 'battleEnd'])('does not open command windows while cancelling in phase %s', (_phase) => {
  class Scene_Battle {}
  const window = { show: jest.fn(), open: jest.fn(), activate: jest.fn() }
  const scene = Object.assign(new Scene_Battle(), { _actorCommandWindow: window, startActorCommandSelection: jest.fn() })
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: scene },
    BattleManager: { _phase, actor: () => ({}) },
  })
  restoreBattleInputWindows()
  expect(window.show).not.toHaveBeenCalled()
  expect(scene.startActorCommandSelection).not.toHaveBeenCalled()
})

it('preserves an open skill picker when automation was cancelled while waiting for a message', () => {
  class Scene_Battle {}
  const picker = { active: true, visible: true, hide: jest.fn() }
  const scene = Object.assign(new Scene_Battle(), { _skillWindow: picker, startActorCommandSelection: jest.fn() })
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: scene },
    BattleManager: { _phase: 'input', actor: () => ({}) },
  })
  restoreBattleInputWindows()
  expect(picker.hide).not.toHaveBeenCalled()
  expect(scene.startActorCommandSelection).not.toHaveBeenCalled()
})

it('reads the live disabled flag after disposeHooks, including after a runtime tick', () => {
  class Scene_Battle {}
  const proto = { isAutoBattle: () => false, makeAutoBattleActions: jest.fn() }
  const actor = Object.assign(Object.create(proto), { canMove: () => true })
  Object.assign(globalThis, {
    Game_Actor: { prototype: proto },
    Scene_Battle,
    SceneManager: { _scene: new Scene_Battle() },
    $gameParty: { battleMembers: () => [actor] },
    BattleManager: {
      _phase: 'input',
      startTurn() {
        this._phase = 'turn'
      },
    },
  })
  Cheats.setAutoBattle(true)
  expect(proto.isAutoBattle()).toBe(true)
  Cheats.disposeHooks()
  expect(proto.isAutoBattle()).toBe(false)
})

it('closes an inactive visible skill list and help window when taking over enemy selection', () => {
  class Scene_Battle {}
  const skillWindow = { active: false, visible: true, hide: jest.fn() }
  const helpWindow = { visible: true, hide: jest.fn() }
  const scene = Object.assign(new Scene_Battle(), { _skillWindow: skillWindow, _helpWindow: helpWindow })
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: scene },
    $gameParty: { battleMembers: () => [{ makeAutoBattleActions: jest.fn() }] },
    BattleManager: {
      _phase: 'input',
      startTurn() {
        this._phase = 'turn'
      },
    },
  })
  tryAutoBattle(true, false, null)
  expect(skillWindow.hide).toHaveBeenCalled()
  expect(helpWindow.hide).toHaveBeenCalled()
})
