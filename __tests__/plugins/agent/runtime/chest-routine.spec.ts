import { runChestRoutine } from '@/plugins/src/agent/runtime/chest-routine'

class Scene_Base {}
class Scene_Map extends Scene_Base {}
class Scene_Battle extends Scene_Base {}
class Scene_Gameover extends Scene_Base {}
class Scene_MenuBase extends Scene_Base {}

const routine = { kind: 'chest' as const, mapId: 2, eventId: 3, x: 5, y: 1 }

function setupGame() {
  const chest = { _erased: false, _pageIndex: 0, isStarting: () => false }
  const game = {
    scene: new Scene_Map() as Scene_Base,
    mapId: 2,
    eventRunning: false,
    interpreterEvent: 0,
    messageBusy: false,
    player: { x: 1, y: 1, direction: 2, isMoving: () => false, setDirection: (direction: number) => (game.player.direction = direction) },
    temp: { _destinationX: null as number | null, _destinationY: null as number | null, isDestinationValid: () => game.temp._destinationX !== null },
    chest,
  }
  Object.assign(globalThis, {
    Scene_Map,
    Scene_Battle,
    Scene_Gameover,
    Scene_MenuBase,
    SceneManager: {
      get _scene() {
        return game.scene
      },
    },
    $gameMap: {
      mapId: () => game.mapId,
      event: (id: number) => (id === 3 ? chest : undefined),
      isEventRunning: () => game.eventRunning,
      _interpreter: { eventId: () => game.interpreterEvent },
    },
    $gamePlayer: game.player,
    $gameMessage: { isBusy: () => game.messageBusy },
    $gameTemp: game.temp,
  })
  return game
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('marks the chest, keeps going through a battle and dialogue, then opens it', async () => {
  const game = setupGame()
  const reports: string[] = []
  const presses: string[] = []
  const press = jest.fn(async (key: 'ok' | 'cancel') => {
    presses.push(`${game.scene.constructor.name}:${key}`)
    if (game.scene instanceof Scene_Battle && presses.length >= 2) {
      game.scene = new Scene_Map()
      game.temp._destinationX = null
      game.temp._destinationY = null
    } else if (game.scene instanceof Scene_Map && !game.messageBusy && !game.eventRunning) {
      game.eventRunning = true
      game.interpreterEvent = 3
      game.messageBusy = true
    } else if (game.messageBusy) {
      game.messageBusy = false
      game.eventRunning = false
      game.chest._pageIndex = 1
    }
  })
  const result = runChestRoutine(routine, { signal: new AbortController().signal, locale: 'zh', press, report: (text) => reports.push(text) })
  expect(game.temp._destinationX).toBe(5)
  expect(game.temp._destinationY).toBe(1)

  game.scene = new Scene_Battle()
  await jest.advanceTimersByTimeAsync(600)
  expect(game.scene).toBeInstanceOf(Scene_Map)
  expect(game.temp._destinationX).toBe(5)
  Object.assign(game.player, { x: 4, y: 1 })
  await jest.advanceTimersByTimeAsync(1_000)

  await expect(result).resolves.toBe('宝箱拿到啦！')
  expect(presses).toEqual(['Scene_Battle:ok', 'Scene_Battle:ok', 'Scene_Map:ok', 'Scene_Map:ok'])
  expect(game.player.direction).toBe(6)
  expect(reports).toEqual(['已标记宝箱位置（5, 1），正在过去', '遇到战斗，自动战斗中，结束后继续去拿宝箱', '继续前往宝箱', '到了，正在打开宝箱'])
  expect(game.temp._destinationX).toBeNull()
})

test('ends when the player leaves the chest map', async () => {
  const game = setupGame()
  const result = runChestRoutine(routine, { signal: new AbortController().signal, locale: 'zh', press: jest.fn(), report: jest.fn() })
  const settled = expect(result).rejects.toThrow('已离开宝箱所在的地图')
  game.mapId = 9
  await jest.advanceTimersByTimeAsync(200)
  await settled
})

test('recognizes an already opened chest before pressing it', async () => {
  const game = setupGame()
  game.chest._pageIndex = 1
  ;(game.chest as { _direction?: number })._direction = 8
  const press = jest.fn()
  await expect(runChestRoutine(routine, { signal: new AbortController().signal, locale: 'zh', press, report: jest.fn() })).resolves.toBe('这个宝箱已经打开了，托管结束')
  expect(press).not.toHaveBeenCalled()
})

test('stops as soon as the task is aborted', async () => {
  setupGame()
  const abort = new AbortController()
  const result = runChestRoutine(routine, { signal: abort.signal, locale: 'zh', press: jest.fn(), report: jest.fn() })
  const settled = expect(result).rejects.toThrow('Stopped')
  abort.abort(new DOMException('Stopped', 'AbortError'))
  await jest.advanceTimersByTimeAsync(0)
  await settled
})
