import type { CurrentEvent, RuntimeHost, RuntimeInterpreter } from '@/lib/game/events/runtime'
import { RunCheats } from '@/plugins/mv/src/cheat/runtime/cheats-run'
import { controlCurrentEvent, installEventControlTracking, readEventActivity } from '@/plugins/mv/src/cheat/session/event-control'

const list = [
  { code: 230, indent: 0, parameters: [60] },
  { code: 125, indent: 0, parameters: [] },
]

class Interpreter implements RuntimeInterpreter {
  _list: RuntimeInterpreter['_list'] = list
  _index = 1
  _eventId = 4
  _mapId = 225
  _waitMode = ''
  _waitCount = 60
  _childInterpreter: RuntimeInterpreter | null = null
  _character: RuntimeInterpreter['_character']
  setup = jest.fn((commands: NonNullable<RuntimeInterpreter['_list']>, eventId: number) => {
    this._list = commands
    this._eventId = eventId
    this._index = 0
    this._waitCount = 0
    this._waitMode = ''
  })
  terminate = jest.fn(() => {
    this._list = null
  })
}

const globals = globalThis as unknown as RuntimeHost & { Game_Interpreter?: unknown }
let main: Interpreter

beforeEach(() => {
  main = new Interpreter()
  globals.$gameMap = { _mapId: 225, _interpreter: main }
  globals.$dataCommonEvents = [null, { id: 1, name: 'Cutscene', list }]
  globals.$gameMessage = { _texts: [], _choices: [] }
})

afterEach(() => {
  for (const key of ['$gameMap', '$dataCommonEvents', '$gameMessage', 'Game_Interpreter'] as const) delete globals[key]
})

function current(path = 'map'): CurrentEvent {
  return readEventActivity().entries.find((entry) => entry.path === path)!
}

test('skip ends only the selected child; the caller remains at its next command', () => {
  const child = new Interpreter()
  main._childInterpreter = child
  const parentIndex = main._index
  controlCurrentEvent('skip', current('map/child'))
  expect(child.terminate).toHaveBeenCalledTimes(1)
  expect(child._waitCount).toBe(0)
  expect(main.terminate).not.toHaveBeenCalled()
  expect(main._list).toBe(list)
  expect(main._index).toBe(parentIndex)
})

test('restart preserves the caller and restarts the same list and event context', () => {
  const child = new Interpreter()
  main._childInterpreter = child
  controlCurrentEvent('restart', current('map/child'))
  expect(child.setup).toHaveBeenCalledWith(list, 4)
  expect(child._index).toBe(0)
  expect(main._childInterpreter).toBe(child)
  expect(main._index).toBe(1)
})

test('route cleanup restores only the awaited character before ending the event', () => {
  const character = { _moveRouteForcing: true, restoreMoveRoute: jest.fn() }
  const unrelated = { _moveRouteForcing: true, restoreMoveRoute: jest.fn() }
  main._list = [{ code: 205, indent: 0, parameters: [] }, list[1]]
  main._character = character
  main._waitMode = 'route'
  globals.$gameMap!._events = [{ _eventId: 2, _interpreter: Object.assign(new Interpreter(), { _character: unrelated }) }]
  controlCurrentEvent('skip', current())
  expect(character._moveRouteForcing).toBe(false)
  expect(character.restoreMoveRoute).toHaveBeenCalledTimes(1)
  expect(unrelated._moveRouteForcing).toBe(true)
  expect(unrelated.restoreMoveRoute).not.toHaveBeenCalled()
})

test.each(['message', 'battle', 'transfer', 'animation', 'pluginWait'])('rejects external wait %s without mutating the event', (mode) => {
  main._waitMode = mode
  const target = current()
  expect(target.skipBlocked).not.toBeNull()
  expect(() => controlCurrentEvent('skip', target)).toThrow('unavailable')
  expect(() => controlCurrentEvent('restart', target)).toThrow('unavailable')
  expect(main.terminate).not.toHaveBeenCalled()
  expect(main.setup).not.toHaveBeenCalled()
})

test('rejects a parent with a running child and rejects global choices', () => {
  main._childInterpreter = new Interpreter()
  expect(current().skipBlocked).toBe('child')
  expect(() => controlCurrentEvent('skip', current())).toThrow('child')
  main._childInterpreter = null
  globals.$gameMessage = { _choices: ['Yes', 'No'] }
  expect(current().restartBlocked).toBe('message')
  expect(() => controlCurrentEvent('restart', current())).toThrow('message')
})

test('rejects stale positions, completed waits and duplicate requests', () => {
  const target = current()
  main._index++
  expect(() => controlCurrentEvent('skip', target)).toThrow('changed')
  main._index--
  main._waitCount = 0
  expect(() => controlCurrentEvent('skip', target)).toThrow('changed')
  const next = current()
  controlCurrentEvent('restart', next)
  expect(() => controlCurrentEvent('restart', next)).toThrow('changed')
  expect(main.setup).toHaveBeenCalledTimes(1)
})

test('setup invalidates the token even if an automatic event reuses the same list and index', () => {
  class Tracked extends Interpreter {}
  const setup = jest.fn(function (this: Tracked, commands: typeof list) {
    this._list = commands
  })
  // Engine setup is a prototype method, unlike the convenient per-instance test mock.
  Tracked.prototype.setup = setup
  const tracked = new Tracked()
  delete (tracked as Partial<Tracked>).setup
  globals.Game_Interpreter = Tracked
  globals.$gameMap!._interpreter = tracked
  const dispose = installEventControlTracking()
  try {
    const target = current()
    tracked.setup(list, 4)
    expect(() => controlCurrentEvent('skip', target)).toThrow('changed')
    expect(current().token).not.toBe(target.token)
  } finally {
    dispose()
  }
  expect(Tracked.prototype.setup).toBe(setup)
})

test('readEventActivity exposes candidates and faded screen state for softlock recovery', () => {
  globals.$gameScreen = { _brightness: 0 }
  globals.$dataSystem = { switches: ['', ...Array(449).fill(''), '进门'] }
  globals.$dataMap = {
    events: [
      null,
      {
        id: 4,
        name: 'Scene',
        pages: [
          {
            trigger: 3,
            list: [
              { code: 221, indent: 0, parameters: [] },
              { code: 0, indent: 0, parameters: [] },
            ],
            conditions: { switch1Valid: true, switch1Id: 450 },
          },
        ],
      },
    ],
  }
  main._list = null
  const activity = readEventActivity()
  expect(activity.faded).toBe(true)
  expect(activity.candidates).toHaveLength(1)
  expect(activity.candidates[0]).toMatchObject({ mapId: 225, eventId: 4, trigger: 3, missingConditions: ['#450 进门'] })
})

test('RunCheats.unstuck restores screen brightness, reveals player and releases movement locks', () => {
  const startFadeIn = jest.fn()
  const restoreMoveRoute = jest.fn()
  globals.$gameScreen = { startFadeIn }
  globals.$gamePlayer = { _transparent: true, _moveRouteForcing: true, restoreMoveRoute }
  globals.$gameTemp = { _stopMapPlayer: true, _stopMapEvents: true }
  const result = RunCheats.unstuck()
  expect(result).toBe(true)
  expect(startFadeIn).toHaveBeenCalledWith(24)
  expect(globals.$gamePlayer._transparent).toBe(false)
  expect(globals.$gamePlayer._moveRouteForcing).toBe(false)
  expect(restoreMoveRoute).toHaveBeenCalledTimes(1)
  expect(globals.$gameTemp._stopMapPlayer).toBe(false)
  expect(globals.$gameTemp._stopMapEvents).toBe(false)
})

test('advance applies remaining variables, player transfer, ends interpreter and calls unstuck', () => {
  const advanceList = [
    { code: 230, indent: 0, parameters: [20] },
    { code: 122, indent: 0, parameters: [295, 295, 0, 0, 1] },
    { code: 201, indent: 0, parameters: [0, 200, 9, 18, 8, 0] },
  ]
  main._list = advanceList
  main._index = 0
  main._waitCount = 20
  const setVariable = jest.fn()
  const reserveTransfer = jest.fn()
  const startFadeIn = jest.fn()
  const restoreMoveRoute = jest.fn()
  globals.$gameVariables = { setValue: setVariable }
  globals.$gamePlayer = { reserveTransfer, _transparent: true, _moveRouteForcing: true, restoreMoveRoute }
  globals.$gameScreen = { startFadeIn }
  globals.$gameTemp = { _stopMapPlayer: true, _stopMapEvents: true }

  const target = current()
  expect(target.advanceBlocked).toBeNull()
  controlCurrentEvent('advance', target)

  expect(setVariable).toHaveBeenCalledWith(295, 1)
  expect(reserveTransfer).toHaveBeenCalledWith(200, 9, 18, 8, 0)
  expect(main.terminate).toHaveBeenCalledTimes(1)
  expect(startFadeIn).toHaveBeenCalledWith(24)
  expect(globals.$gamePlayer._transparent).toBe(false)
  expect(globals.$gameTemp._stopMapPlayer).toBe(false)
})

test('RunCheats.advanceCutscene auto-discovers candidate cutscenes and applies variable, switch and transfer outcomes', () => {
  const setSwitch = jest.fn()
  const setVariable = jest.fn()
  const reserveTransfer = jest.fn()
  const startFadeIn = jest.fn()
  const restoreMoveRoute = jest.fn()

  globals.$gameMap = { _mapId: 225, mapId: () => 225, _interpreter: { _list: null } }
  globals.$gameSwitches = { setValue: setSwitch, _data: [] }
  globals.$gameVariables = { setValue: setVariable }
  globals.$gamePlayer = { reserveTransfer, _transparent: true, _moveRouteForcing: true, restoreMoveRoute }
  globals.$gameScreen = { startFadeIn }
  globals.$gameTemp = { _stopMapPlayer: true, _stopMapEvents: true }
  globals.$dataMap = {
    events: [
      null,
      {
        id: 4,
        name: 'EV004 Cutscene',
        pages: [
          {
            trigger: 4,
            conditions: { switch1Valid: true, switch1Id: 450 },
            list: [
              { code: 121, indent: 0, parameters: [450, 450, 0] },
              { code: 122, indent: 0, parameters: [295, 295, 0, 0, 1] },
              { code: 201, indent: 0, parameters: [0, 200, 9, 18, 8, 0] },
              { code: 0, indent: 0, parameters: [] },
            ],
          },
        ],
      },
    ],
  }

  const advanced = RunCheats.advanceCutscene()
  expect(advanced).toBe(true)
  expect(setSwitch).toHaveBeenCalledWith(450, true)
  expect(setVariable).toHaveBeenCalledWith(295, 1)
  expect(reserveTransfer).toHaveBeenCalledWith(200, 9, 18, 8, 0)
  expect(startFadeIn).toHaveBeenCalledWith(24)
  expect(globals.$gamePlayer._transparent).toBe(false)
  expect(globals.$gameTemp._stopMapPlayer).toBe(false)
})

test('RunCheats.returnPrevMap safely returns to previous map and unfreezes player', () => {
  const reserveTransfer = jest.fn()
  const startFadeIn = jest.fn()
  const restoreMoveRoute = jest.fn()

  globals.$gameMap = { _mapId: 225, mapId: () => 225 }
  globals.$gamePlayer = { reserveTransfer, _transparent: true, _moveRouteForcing: true, restoreMoveRoute }
  globals.$gameScreen = { startFadeIn }
  globals.$gameTemp = { _stopMapPlayer: true, _stopMapEvents: true }

  RunCheats.returnPrevMap()
  expect(reserveTransfer).toHaveBeenCalled()
  expect(startFadeIn).toHaveBeenCalledWith(24)
  expect(globals.$gamePlayer._transparent).toBe(false)
})
