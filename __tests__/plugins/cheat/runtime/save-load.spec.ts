/** @jest-environment jsdom */
import { Cheats } from '@/plugins/src/cheat/runtime/cheats'

jest.mock('@/plugins/src/cheat/runtime/cheats-run', () => ({ RunCheats: { ensureHooks: () => {}, disposeHooks: () => {} } }))

const g = globalThis as Record<string, unknown>

afterEach(() => {
  delete g.DataManager
  delete g.StorageManager
  delete g.SceneManager
  delete g.Scene_Map
})

test('native save waits for the engine promise and verifies the slot exists', async () => {
  const saveGame = jest.fn(async () => true)
  g.DataManager = { saveGame, isThisGameFile: jest.fn(() => true) }

  await expect(Cheats.saveGame(2)).resolves.toBe(true)
  expect(saveGame).toHaveBeenCalledWith(2)
})

test('native save maps visible files past YEP autosave slots', async () => {
  const saveGame = jest.fn(async () => true)
  g.StorageManager = { isAutosave: (id: number) => id <= 2 }
  g.DataManager = { saveGame, isThisGameFile: jest.fn((id: number) => id === 3) }

  await expect(Cheats.saveGame(1)).resolves.toBe(true)
  expect(saveGame).toHaveBeenCalledWith(3)
})

test('native save never turns a rejected or unverified promise into success', async () => {
  g.DataManager = { saveGame: jest.fn(async () => false), isThisGameFile: jest.fn(() => false) }
  await expect(Cheats.saveGame(1)).resolves.toBe(false)

  g.DataManager = { saveGame: jest.fn(async () => true), isThisGameFile: jest.fn(() => false), loadSavefileInfo: jest.fn(() => null) }
  await expect(Cheats.saveGame(1)).rejects.toThrow('尚未出现在存档列表')

  g.DataManager = { saveGame: jest.fn(async () => Promise.reject(new Error('disk full'))) }
  await expect(Cheats.saveGame(1)).rejects.toThrow('disk full')
})

test('native load checks the slot, waits for loading, then enters the map', async () => {
  class SceneMap {}
  const goto = jest.fn()
  const loadGame = jest.fn(async () => true)
  g.Scene_Map = SceneMap
  g.SceneManager = { goto }
  g.DataManager = { loadGame, isThisGameFile: jest.fn(() => true) }

  await expect(Cheats.loadGame(3)).resolves.toBe(true)
  expect(loadGame).toHaveBeenCalledWith(3)
  expect(goto).toHaveBeenCalledWith(SceneMap)
})

test('native load maps visible files past YEP autosave slots', async () => {
  class SceneMap {}
  const goto = jest.fn()
  const loadGame = jest.fn(async () => true)
  g.StorageManager = { isAutosave: (id: number) => id <= 2 }
  g.Scene_Map = SceneMap
  g.SceneManager = { goto }
  g.DataManager = { loadGame, isThisGameFile: jest.fn((id: number) => id === 3) }

  await expect(Cheats.loadGame(1)).resolves.toBe(true)
  expect(loadGame).toHaveBeenCalledWith(3)
})

test('native load does not call the engine for an empty slot', async () => {
  const loadGame = jest.fn(async () => true)
  g.DataManager = { loadGame, isThisGameFile: jest.fn(() => false), loadSavefileInfo: jest.fn(() => null) }

  await expect(Cheats.loadGame(4)).resolves.toBe(false)
  expect(loadGame).not.toHaveBeenCalled()
})
