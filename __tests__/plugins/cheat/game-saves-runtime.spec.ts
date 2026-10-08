import { checkSaveSafety, isInGame, playerFingerprint } from '@/plugins/src/cheat/game-saves/safety'
import { captureSave, currentEngine, restoreSave, SaveRestoreRolledBackError } from '@/plugins/src/cheat/game-saves/serialize'

class Scene_Map {
  update = jest.fn()
  isBusy = () => true
  _menuCalling = false
}
class Scene_Title {}

const g = globalThis as Record<string, unknown>
const KEYS = [
  'Scene_Map',
  'Scene_Title',
  'SceneManager',
  '$gameParty',
  '$gameMap',
  '$gameMessage',
  '$gamePlayer',
  '$gameSystem',
  '$gameTemp',
  'DataManager',
  'JsonEx',
  'Graphics',
  'Utils',
  'AudioManager',
  '$dataSystem',
]

let flags: Record<string, boolean>
let scene: Scene_Map

beforeEach(() => {
  flags = { battle: false, event: false, message: false, transfer: false, moving: false, changing: false }
  scene = new Scene_Map()
  Object.assign(g, {
    Scene_Map,
    Scene_Title,
    SceneManager: { _scene: scene, _nextScene: null, isSceneChanging: () => flags.changing, goto: jest.fn(), snap: () => null },
    $gameParty: { inBattle: () => flags.battle, members: () => [{ name: () => '里德' }, { name: () => '' }] },
    $gameMap: { isEventRunning: () => flags.event, mapId: () => 3, displayName: () => '村庄' },
    $gameMessage: { isBusy: () => flags.message },
    $gamePlayer: { isTransferring: () => flags.transfer, isMoving: () => flags.moving, x: 4, y: 7, direction: () => 2, reserveTransfer: jest.fn(), requestMapReload: jest.fn() },
  })
})

afterEach(() => {
  for (const k of KEYS) delete g[k]
})

describe('checkSaveSafety', () => {
  it('reports the first unsafe reason in priority order', () => {
    expect(checkSaveSafety()).toEqual({ ok: true })
    const cases: Array<[string, string]> = [
      ['moving', 'moving'],
      ['transfer', 'transfer'],
      ['message', 'message'],
      ['event', 'event'],
      ['battle', 'battle'],
      ['changing', 'notMap'],
    ]
    for (const [flag, reason] of cases) {
      flags[flag] = true
      expect(checkSaveSafety()).toEqual({ ok: false, reason })
    }
  })

  it('waits while a menu is being called or another scene is up', () => {
    scene._menuCalling = true
    expect(checkSaveSafety()).toEqual({ ok: false, reason: 'menu' })
    ;(g.SceneManager as { _scene: unknown })._scene = new Scene_Title()
    expect(checkSaveSafety()).toEqual({ ok: false, reason: 'notMap' })
  })

  it('knows whether the player is in game and fingerprints the position', () => {
    expect(isInGame()).toBe(true)
    expect(playerFingerprint()).toBe('3:4:7')
    ;(g.SceneManager as { _scene: unknown })._scene = new Scene_Title()
    expect(isInGame()).toBe(false)
  })
})

const SAVE_B = JSON.stringify({ system: {}, actors: {}, party: {}, map: {}, player: {} })

describe('captureSave / restoreSave', () => {
  beforeEach(() => {
    Object.assign(g, {
      $gameSystem: {
        _saveCount: 5,
        onBeforeSave() {
          this._saveCount++
        },
        onAfterLoad: jest.fn(),
        versionId: () => 1,
      },
      DataManager: { makeSaveContents: () => ({ state: 'A' }), createGameObjects: jest.fn(), extractSaveContents: jest.fn(), correctDataErrors: jest.fn() },
      JsonEx: { stringify: JSON.stringify, parse: JSON.parse },
      Graphics: { frameCount: 600 },
      Utils: { RPGMAKER_NAME: 'MZ' },
      AudioManager: { stopMe: jest.fn(), stopSe: jest.fn() },
      $dataSystem: { versionId: 1 },
    })
  })

  it('captures the save without bumping the game save count', () => {
    const { json, meta } = captureSave()
    expect(JSON.parse(json)).toEqual({ state: 'A' })
    expect((g.$gameSystem as { _saveCount: number })._saveCount).toBe(5)
    expect(meta).toEqual({ playtimeFrames: 600, mapId: 3, mapName: '村庄', partyNames: ['里德'], versionId: 1, engine: 'mz' })
    expect(currentEngine()).toBe('mz')
  })

  it('writes the onBeforeSave fields into the save only, leaving the live system untouched', () => {
    const system = g.$gameSystem as Record<string, unknown>
    Object.assign(system, {
      _framesOnSave: 10,
      _bgmOnSave: { name: 'old' },
      _versionId: 0,
      onBeforeSave() {
        this._saveCount = (this._saveCount as number) + 1
        this._framesOnSave = 600
        this._bgmOnSave = { name: 'now' }
        this._versionId = 1
        this._pluginStamp = 'x'
      },
    })
    ;(g.DataManager as { makeSaveContents: () => unknown }).makeSaveContents = () => ({ system: { ...system } })
    const saved = JSON.parse(captureSave().json).system
    expect(saved).toMatchObject({ _saveCount: 6, _framesOnSave: 600, _bgmOnSave: { name: 'now' }, _versionId: 1, _pluginStamp: 'x' })
    expect(system).toMatchObject({ _saveCount: 5, _framesOnSave: 10, _bgmOnSave: { name: 'old' }, _versionId: 0 })
    expect(system).not.toHaveProperty('_pluginStamp')
  })

  it('restores the live system even when building the save fails', () => {
    const system = g.$gameSystem as Record<string, unknown>
    ;(g.DataManager as { makeSaveContents: () => unknown }).makeSaveContents = () => {
      throw new Error('broken')
    }
    expect(() => captureSave()).toThrow('broken')
    expect(system._saveCount).toBe(5)
  })

  it('restores like Scene_Load and freezes the old scene', () => {
    restoreSave(SAVE_B)
    const dm = g.DataManager as Record<string, jest.Mock>
    expect(dm.createGameObjects).toHaveBeenCalled()
    expect(dm.extractSaveContents).toHaveBeenCalledWith(JSON.parse(SAVE_B))
    expect(scene.isBusy()).toBe(false)
    expect((g.SceneManager as { goto: jest.Mock }).goto).toHaveBeenCalledWith(Scene_Map)
    expect((g.$gameSystem as { onAfterLoad: jest.Mock }).onAfterLoad).toHaveBeenCalled()
    expect((g.$gamePlayer as { reserveTransfer: jest.Mock }).reserveTransfer).not.toHaveBeenCalled()
  })

  it('reloads the map when the save comes from another game version', () => {
    ;(g.$dataSystem as { versionId: number }).versionId = 2
    restoreSave(SAVE_B)
    const player = g.$gamePlayer as { reserveTransfer: jest.Mock; requestMapReload: jest.Mock }
    expect(player.reserveTransfer).toHaveBeenCalledWith(3, 4, 7, 2, 0)
    expect(player.requestMapReload).toHaveBeenCalled()
  })

  it('rejects invalid content before touching the game', () => {
    expect(() => restoreSave('null')).toThrow(SaveRestoreRolledBackError)
    expect(() => restoreSave('[]')).toThrow(SaveRestoreRolledBackError)
    expect(() => restoreSave('{broken')).toThrow(SaveRestoreRolledBackError)
    expect((g.DataManager as Record<string, jest.Mock>).createGameObjects).not.toHaveBeenCalled()
    delete g.DataManager
    expect(() => captureSave()).toThrow()
  })

  it('puts the previous game objects back when extracting fails, even on the title screen', () => {
    const party = g.$gameParty
    const dm = g.DataManager as Record<string, jest.Mock>
    dm.createGameObjects.mockImplementation(() => {
      g.$gameParty = { replaced: true }
      g.$gameTemp = { replaced: true }
    })
    dm.extractSaveContents.mockImplementation(() => {
      throw new Error('broken')
    })
    expect(() => restoreSave(SAVE_B)).toThrow(new SaveRestoreRolledBackError('broken'))
    expect(g.$gameParty).toBe(party)
    expect(g.$gameTemp).toBeUndefined()
    expect((g.SceneManager as { goto: jest.Mock }).goto).not.toHaveBeenCalled()
  })
})
