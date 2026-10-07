/** @jest-environment jsdom */
import { Cheats } from '@/plugins/src/cheat/runtime/cheats'

jest.mock('@/plugins/src/cheat/runtime/cheats-run', () => ({ RunCheats: { ensureHooks: () => {}, disposeHooks: () => {} } }))

class Scene_Battle {}
class Scene_Map {}

const g = globalThis as Record<string, any>
let troopEvent = false
let enemies: Array<{ hp: number; setHp: (n: number) => void; isDead: () => boolean }> = []

function enemy() {
  const e = {
    hp: 10,
    setHp(n: number) {
      e.hp = n
    },
    isDead: () => e.hp <= 0,
  }
  return e
}

function startBattle(phase = 'input') {
  enemies = [enemy(), enemy()]
  g.SceneManager._scene = new Scene_Battle()
  g.BattleManager._phase = phase
}

beforeEach(() => {
  jest.useFakeTimers()
  troopEvent = false
  Object.assign(g, {
    Scene_Battle,
    SceneManager: { _scene: new Scene_Map() },
    BattleManager: {
      _phase: 'init',
      isBattle: () => g.SceneManager._scene instanceof Scene_Battle,
      processVictory: jest.fn(() => {
        g.BattleManager._phase = 'battleEnd'
      }),
    },
    $gameParty: { inBattle: () => g.SceneManager._scene instanceof Scene_Battle, members: () => [] },
    $gameTroop: { members: () => enemies, isEventRunning: () => troopEvent },
  })
})

afterEach(() => {
  Cheats.disposeHooks()
  jest.useRealTimers()
  for (const key of ['Scene_Battle', 'SceneManager', 'BattleManager', '$gameParty', '$gameTroop']) delete g[key]
})

const tick = () => jest.advanceTimersByTime(200)

it('wins every battle once it reaches the command phase, until switched off', () => {
  Cheats.setAutoWin(true)
  tick()
  expect(g.BattleManager.processVictory).not.toHaveBeenCalled()

  startBattle()
  tick()
  expect(g.BattleManager.processVictory).toHaveBeenCalledTimes(1)
  expect(enemies.every((e) => e.isDead())).toBe(true)
  tick()
  expect(g.BattleManager.processVictory).toHaveBeenCalledTimes(1)

  startBattle()
  tick()
  expect(g.BattleManager.processVictory).toHaveBeenCalledTimes(2)

  Cheats.setAutoWin(false)
  startBattle()
  tick()
  expect(g.BattleManager.processVictory).toHaveBeenCalledTimes(2)
})

it('waits for the battle intro and troop events before winning', () => {
  Cheats.setAutoWin(true)
  startBattle('start')
  tick()
  expect(g.BattleManager.processVictory).not.toHaveBeenCalled()
  g.BattleManager._phase = 'turn'
  troopEvent = true
  tick()
  expect(g.BattleManager.processVictory).not.toHaveBeenCalled()
  troopEvent = false
  tick()
  expect(g.BattleManager.processVictory).toHaveBeenCalledTimes(1)
})

it('wins each battle once even when a plugin keeps the phase after processVictory', () => {
  g.BattleManager.processVictory = jest.fn()
  Cheats.setAutoWin(true)
  startBattle('turn')
  tick()
  tick()
  tick()
  expect(g.BattleManager.processVictory).toHaveBeenCalledTimes(1)
  startBattle('turn')
  tick()
  expect(g.BattleManager.processVictory).toHaveBeenCalledTimes(2)
})

it('does not retry every tick when processVictory throws', () => {
  g.BattleManager.processVictory = jest.fn(() => {
    throw new Error('plugin bug')
  })
  Cheats.setAutoWin(true)
  startBattle()
  tick()
  tick()
  expect(g.BattleManager.processVictory).toHaveBeenCalledTimes(1)
})

it('reports the switch state', () => {
  expect(Cheats.getAutoWin()).toBe(false)
  expect(Cheats.setAutoWin(true)).toBe(true)
  expect(Cheats.getAutoWin()).toBe(true)
})
