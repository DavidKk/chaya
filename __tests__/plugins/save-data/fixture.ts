/** Fake RPG Maker globals for the save data service */
type Rec = Record<string, unknown>

export type World = ReturnType<typeof installWorld>

export function installWorld() {
  class Scene_Map {}
  const g = globalThis as Rec
  const items = [null, { id: 1, name: 'Potion' }, { id: 2, name: 'Ether' }]
  const world = {
    SceneManager: { _scene: new Scene_Map() },
    $gameSystem: { _saveCount: 3 },
    $gameScreen: {},
    $gameTimer: { _frames: 0 },
    $gameSwitches: {
      _data: [null, false, true] as unknown[],
      setValue: jest.fn(function (this: { _data: unknown[] }, id: number, v: unknown) {
        this._data[id] = v
      }),
      onChange: jest.fn(),
    },
    $gameVariables: {
      _data: [null, 5, 'hi'] as unknown[],
      setValue: jest.fn(function (this: { _data: unknown[] }, id: number, v: unknown) {
        this._data[id] = v
      }),
    },
    $gameSelfSwitches: {
      _data: { '1,1,A': true } as Rec,
      setValue: jest.fn(function (this: { _data: Rec }, key: unknown[], v: boolean) {
        const k = key.join(',')
        if (v) this._data[k] = true
        else delete this._data[k]
      }),
    },
    $gameActors: { _data: [null, { _name: 'Hero', _hp: 10, _mp: 5, _level: 1, refresh: jest.fn() }] as unknown[] },
    $gameParty: {
      _gold: 100,
      _steps: 0,
      _items: { 1: 3 } as Record<string, number>,
      _weapons: {},
      _armors: {},
      _actors: [1] as unknown[],
      gainItem(item: { id: number }, n: number) {
        const k = String(item.id)
        const next = (this._items[k] || 0) + n
        if (next > 0) this._items[k] = next
        else delete this._items[k]
      },
      numItems(item: { id: number }) {
        return this._items[String(item.id)] || 0
      },
    },
    $gameMap: { _mapId: 1, mapId: () => 1, requestRefresh: jest.fn(), _events: [null, { _eventId: 1, _mapId: 1, _x: 3 }] as unknown[] },
    $gamePlayer: { _x: 1, _y: 2, _encounterCount: 0, refresh: jest.fn() },
    ConfigManager: {
      bgmVolume: 100,
      makeData() {
        return { bgmVolume: this.bgmVolume }
      },
      save: jest.fn(),
    },
    $dataSystem: { switches: ['', 'Door', 'Boss'], variables: ['', 'Count', 'Name'] },
    $dataActors: [null, { name: 'Hero' }],
    $dataItems: items,
    $dataWeapons: [null],
    $dataArmors: [null],
    $dataMapInfos: [null, { name: 'Town' }],
    $dataMap: { events: [null, { name: 'Chest' }] },
    JsonEx: { makeDeepCopy: (v: unknown) => JSON.parse(JSON.stringify(v)) },
  }
  for (const [k, v] of Object.entries(world)) g[k] = v
  return world
}

export function removeWorld(world: World) {
  const g = globalThis as Rec
  for (const k of Object.keys(world)) delete g[k]
}
