import { readEventRuntime, type RuntimeHost, type RuntimeInterpreter } from '@/lib/game/events/runtime'

const command = (code: number) => ({ code, indent: 0, parameters: [] })

test('discovers called common events, map pages and parallel interpreters without changing them', () => {
  const commonList = [command(230), command(0)]
  const mapList = [command(117), command(0)]
  const child: RuntimeInterpreter = { _list: commonList, _index: 1, _waitCount: 20, _mapId: 225, _eventId: 4 }
  const main: RuntimeInterpreter = { _list: mapList, _index: 1, _mapId: 225, _eventId: 4, _childInterpreter: child }
  const root: RuntimeHost = {
    $gameMap: {
      _mapId: 225,
      _interpreter: main,
      _events: [null, { _eventId: 21, _interpreter: { _list: [command(0)], _eventId: 21 } }],
      _commonEvents: [{ _commonEventId: 1, _interpreter: { _list: commonList, _index: 0 } }],
    },
    $dataCommonEvents: [null, { id: 1, name: 'Cutscene', list: commonList }],
    $dataMap: { events: Array.from({ length: 5 }, (_, i) => (i === 4 ? { id: 4, name: 'Gate', pages: [{ list: [] }, { list: mapList }] } : null)) },
    $gameTroop: { _interpreter: { _list: [command(230)] } },
  }
  const before = JSON.stringify(root)
  const state = readEventRuntime(root)
  expect(state.entries.map((e) => e.path)).toEqual(['map', 'map/child', 'event:21', 'common:1', 'troop'])
  expect(state.entries[0]).toMatchObject({ page: 1, name: 'Gate', commonEventId: null, child: true })
  expect(state.entries[1]).toMatchObject({ commonEventId: 1, page: null, name: 'Cutscene', previousCode: 230, waitCount: 20 })
  expect(JSON.stringify(root)).toBe(before)
})

test('diagnoses orphaned scene conditions and reads movement locks from Game_Temp', () => {
  const root: RuntimeHost = {
    $gameMap: { _mapId: 225 },
    $gamePlayer: { _x: 13, _y: 24, _transparent: true },
    $gameTemp: { _stopMapPlayer: true },
    $gameScreen: { _brightness: 0 },
    $dataSystem: { switches: ['', ...Array(449).fill(''), '进入边境'] },
    $dataMap: {
      events: [
        null,
        {
          id: 4,
          name: 'Scene',
          pages: [
            {
              trigger: 3,
              list: [command(221), { code: 122, indent: 0, parameters: [295, 295, 0, 0, 1] }, { code: 201, indent: 0, parameters: [0, 200, 9, 18, 8, 0] }, command(0)],
              conditions: { switch1Valid: true, switch1Id: 450, variableValid: true, variableId: 335, variableValue: 1 },
            } as never,
          ],
        },
      ],
    },
    $gameSwitches: { _data: [] },
    $gameVariables: { _data: [] },
  }
  const result = readEventRuntime(root)
  expect(result.entries).toEqual([])
  expect(result.player).toMatchObject({ x: 13, y: 24, transparent: true })
  expect(result.movementLocks.player).toBe(true)
  expect(result.faded).toBe(true)
  expect(result.candidates[0]).toMatchObject({
    mapId: 225,
    eventId: 4,
    page: 0,
    name: 'Scene',
    trigger: 3,
    missingConditions: ['#450 进入边境', '#335 >= 1'],
    missingSwitches: [450],
    outcome: {
      variables: [{ id: 295, value: 1 }],
      transfer: { mapId: 200, x: 9, y: 18 },
    },
  })
  expect(result.pageConditions[0].pages[0]).toMatchObject({ switch1: { id: 450, value: false }, variable: { id: 335, required: 1 } })
  expect(readEventRuntime(root, false).pageConditions).toEqual([])
})

test('is self-contained for the legacy fixed read-only probe and bounds recursive traversal', () => {
  const interpreter: RuntimeInterpreter = { _list: [command(230)], _index: 0 }
  interpreter._childInterpreter = interpreter
  const root: RuntimeHost = { $gameMap: { _mapId: 1, _interpreter: interpreter } }
  const probe = new Function('globalThis', `return (${readEventRuntime.toString()})(globalThis);`)
  expect(probe(root)).toEqual(readEventRuntime(root))
  expect(readEventRuntime(root).entries).toHaveLength(1)
  let next = interpreter
  for (let i = 0; i < 120; i++) {
    next._childInterpreter = { _list: [command(0)] }
    next = next._childInterpreter
  }
  expect(readEventRuntime(root).entries).toHaveLength(100)
})

test('does not label an interpreter from the previous map or troop as a current map event', () => {
  const list = [command(230)]
  const root: RuntimeHost = {
    $gameMap: { _mapId: 2, _interpreter: { _mapId: 1, _eventId: 1, _list: list } },
    $gameTroop: { _interpreter: { _mapId: 2, _eventId: 1, _list: list } },
    $dataMap: { events: [null, { id: 1, name: 'Unrelated', pages: [{ list }] }] },
  }
  expect(readEventRuntime(root).entries.every((e) => e.page === null && e.name === '')).toBe(true)
})
