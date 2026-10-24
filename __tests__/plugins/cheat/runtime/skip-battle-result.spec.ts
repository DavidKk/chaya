/**
 * @jest-environment jsdom
 */
import { getSkipBattleResult, isBattleResultContext, setSkipBattleResult } from '@/plugins/mv/src/cheat/runtime/skip-battle-result'

afterEach(() => {
  setSkipBattleResult(false)
  for (const key of ['BattleManager', 'SceneManager', 'Scene_Battle', 'Input', '$gameMessage', '$gameTemp'] as const) {
    delete (globalThis as Record<string, unknown>)[key]
  }
})

it('synthesizes OK while a victory scene is active', () => {
  class Scene_Victory {}
  const isTriggered = jest.fn(() => false)
  Object.assign(globalThis, {
    Scene_Victory,
    SceneManager: { _scene: new Scene_Victory() },
    Input: { isTriggered },
    $gameTemp: {},
  })

  setSkipBattleResult(true)
  expect(getSkipBattleResult()).toBe(true)
  expect(isBattleResultContext()).toBe(true)
  expect(Input.isTriggered!('ok')).toBe(true)
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
