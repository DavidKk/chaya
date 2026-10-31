/**
 * @jest-environment jsdom
 */
import { getSkipBattleResult, isBattleResultContext, setSkipBattleResult, trySkipBattleResult } from '@/plugins/mv/src/cheat/runtime/skip-battle-result'

afterEach(() => {
  setSkipBattleResult(false)
  for (const key of ['BattleManager', 'SceneManager', 'Scene_Battle', 'Input', '$gameMessage', '$gameTemp'] as const) {
    delete (globalThis as Record<string, unknown>)[key]
  }
})

it('synthesizes OK while a victory scene is active', () => {
  class Scene_Victory {}
  const isTriggered = jest.fn(() => false)
  const isPressed = jest.fn(() => false)
  Object.assign(globalThis, {
    Scene_Victory,
    SceneManager: { _scene: new Scene_Victory() },
    Input: { isTriggered, isPressed },
    $gameTemp: {},
  })

  setSkipBattleResult(true)
  expect(getSkipBattleResult()).toBe(true)
  expect(isBattleResultContext()).toBe(true)
  expect(Input.isTriggered!('ok')).toBe(true)
  expect(Input.isPressed!('ok')).toBe(true)
  // Within the confirm gap, fall through to the real input (still false).
  expect(Input.isTriggered!('ok')).toBe(false)
  expect(isTriggered).toHaveBeenCalled()
})

it('does not mash OK on the map', () => {
  class Scene_Map {}
  const isTriggered = jest.fn((key: string) => key === 'ok')
  Object.assign(globalThis, {
    Scene_Map,
    SceneManager: { _scene: new Scene_Map() },
    Input: { isTriggered },
    $gameTemp: {},
    BattleManager: { _phase: '' },
  })

  setSkipBattleResult(true)
  expect(isBattleResultContext()).toBe(false)
  expect(Input.isTriggered!('ok')).toBe(true)
  expect(isTriggered).toHaveBeenCalledWith('ok')
})

it('keeps working after the module is hot-reloaded', async () => {
  class Scene_Victory {}
  const isTriggered = jest.fn(() => false)
  Object.assign(globalThis, {
    Scene_Victory,
    SceneManager: { _scene: new Scene_Victory() },
    Input: { isTriggered },
    $gameTemp: {},
  })

  setSkipBattleResult(true)

  jest.resetModules()
  const reloaded = await import('@/plugins/mv/src/cheat/runtime/skip-battle-result')
  expect(reloaded.getSkipBattleResult()).toBe(true)
  expect(Input.isTriggered!('ok')).toBe(true)
})

it('reinstalls the input hook after the game replaces Input', () => {
  class Scene_Victory {}
  Object.assign(globalThis, {
    Scene_Victory,
    SceneManager: { _scene: new Scene_Victory() },
    Input: { isTriggered: jest.fn(() => false) },
    $gameTemp: {},
  })

  setSkipBattleResult(true)
  expect(globalThis.Input!.isTriggered!('ok')).toBe(true)

  Object.assign(globalThis, { Input: { isTriggered: jest.fn(() => false) } })
  setSkipBattleResult(true)
  expect(globalThis.Input!.isTriggered!('ok')).toBe(true)
})

it('confirms the stock MV message window and Olivia result windows via isRepeated', () => {
  class Scene_Battle {}
  const processVictory = jest.fn()
  const input = { isRepeated: jest.fn(() => false), isTriggered: jest.fn(() => false) }
  Object.assign(globalThis, {
    Scene_Battle,
    SceneManager: { _scene: new Scene_Battle() },
    BattleManager: { _phase: 'turn', processVictory },
    Input: input,
    $gameTemp: {},
    $gameMessage: { isBusy: () => true, numChoices: () => 0 },
  })
  setSkipBattleResult(true)
  expect(input.isRepeated('ok')).toBe(false)
  ;(globalThis as unknown as { BattleManager: { processVictory: () => void } }).BattleManager.processVictory()
  expect(processVictory).toHaveBeenCalledTimes(1)
  expect(input.isRepeated('ok')).toBe(true)
  expect(input.isRepeated('cancel')).toBe(false)
})

it('does not carry a finished battle into map dialogue or the next battle', () => {
  class Scene_Battle {}
  const manager = { _phase: 'battleEnd', processVictory: () => {} }
  const input = { isRepeated: () => false }
  const scenes: { _scene: object } = { _scene: new Scene_Battle() }
  Object.assign(globalThis, { Scene_Battle, SceneManager: scenes, BattleManager: manager, Input: input, $gameTemp: {} })
  setSkipBattleResult(true)
  manager.processVictory()
  scenes._scene = {}
  expect(isBattleResultContext()).toBe(false)
  trySkipBattleResult()
  manager._phase = 'turn'
  scenes._scene = new Scene_Battle()
  expect(input.isRepeated('ok')).toBe(false)
})

it('preserves choices and installs hooks once even after repeated toggles and late plugin overrides', () => {
  class Scene_Victory {}
  const input = { isRepeated: () => false }
  Object.assign(globalThis, { SceneManager: { _scene: new Scene_Victory() }, Input: input, $gameMessage: { numChoices: () => 2 } })
  setSkipBattleResult(true)
  const installed = input.isRepeated
  setSkipBattleResult(false)
  setSkipBattleResult(true)
  trySkipBattleResult()
  expect(input.isRepeated).toBe(installed)
  expect(input.isRepeated('ok')).toBe(false)
  Object.assign(globalThis, { $gameMessage: { numChoices: () => 0 } })
  input.isRepeated = () => false
  trySkipBattleResult()
  expect(input.isRepeated('ok')).toBe(true)
})
