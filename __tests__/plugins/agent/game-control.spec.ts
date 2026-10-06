/** @jest-environment jsdom */
import { movePlayer, quitGame, tapScreen } from '@/plugins/src/agent/game-control'

type Globals = Record<string, unknown>

const g = globalThis as unknown as Globals

class Scene_Map {}

const player = {
  x: 0,
  y: 0,
  moving: false,
  isMoving: () => player.moving,
  findDirectionTo: (_x: number, _y: number) => 6,
  moveStraight: (direction: number) => {
    if (direction === 6) player.x++
  },
}
const temp = { _destinationX: null as number | null, _destinationY: null as number | null, isDestinationValid: () => temp._destinationX != null }
const events: Array<{ _x: number; _y: number; _eventId: number; _trigger: number; isStarting?: () => boolean }> = []
const map = { id: 1, mapId: () => map.id, events: () => events }
let step: () => void = () => {}

beforeEach(() => {
  jest.useFakeTimers()
  Object.assign(player, { x: 0, y: 0, moving: false })
  Object.assign(temp, { _destinationX: null, _destinationY: null })
  map.id = 1
  events.length = 0
  step = () => {}
  Object.assign(g, { Scene_Map, SceneManager: { _scene: new Scene_Map() }, $gamePlayer: player, $gameTemp: temp, $gameMap: map })
})

afterEach(() => {
  jest.useRealTimers()
  for (const key of ['Scene_Map', 'SceneManager', '$gamePlayer', '$gameTemp', '$gameMap', '$gameMessage', 'Graphics', 'TouchInput']) delete g[key]
})

/** Advance fake time in 100ms polls, running one game step per poll */
async function run<T>(promise: Promise<T>, polls = 200): Promise<T> {
  let done = false
  const finish = () => {
    done = true
  }
  promise.then(finish, finish)
  for (let i = 0; i < polls && !done; i++) {
    step()
    await jest.advanceTimersByTimeAsync(100)
  }
  return promise
}

describe('movePlayer', () => {
  it('walks to the target and reports arrival', async () => {
    step = () => {
      if (temp._destinationX != null && player.x < temp._destinationX) player.x += 1
      if (player.x === temp._destinationX) temp._destinationX = null
    }
    expect(await run(movePlayer({ x: 3, y: 0 }))).toEqual({ arrived: true, mapId: 1, position: { x: 3, y: 0 }, target: { x: 3, y: 0 } })
  })

  it('stops when a transfer tile changes the map', async () => {
    step = () => {
      if (map.id !== 1) return
      player.x += 1
      if (player.x === 2) {
        map.id = 2
        Object.assign(player, { x: 1, y: 6 })
      }
    }
    const result = await run(movePlayer({ x: 16, y: 6 }))
    expect(result).toEqual({ arrived: false, transferred: true, mapId: 2, position: { x: 1, y: 6 }, target: { x: 16, y: 6 } })
    expect(temp._destinationX).toBeNull()
  })

  it('gives up at the timeout and clears the destination', async () => {
    player.moving = true
    const result = await run(movePlayer({ x: 5, y: 5, timeoutMs: 1000 }))
    expect(result).toMatchObject({ arrived: false, position: { x: 0, y: 0 } })
    expect(result).not.toHaveProperty('transferred')
    expect(temp).toMatchObject({ _destinationX: null, _destinationY: null })
  })

  it('only works on the map scene', async () => {
    g.SceneManager = { _scene: {} }
    await expect(movePlayer({ x: 1, y: 1 })).rejects.toThrow('地图')
  })

  it('takes only one step toward a distant target', async () => {
    expect(await movePlayer({ x: 5, y: 0, stepwise: true })).toMatchObject({ moved: true, arrived: false, position: { x: 1, y: 0 } })
  })

  it('does not step onto another touch event', async () => {
    events.push({ _x: 1, _y: 0, _eventId: 7, _trigger: 1 })
    expect(await movePlayer({ x: 5, y: 0, stepwise: true, guard: { controlToken: 'test', allowedEffects: ['navigate'], targetEventId: 3 } })).toMatchObject({
      blockedEventId: 7,
      position: { x: 0, y: 0 },
    })
  })

  it('only reports the target touch event when activation is observed', async () => {
    let started = false
    events.push({ _x: 1, _y: 0, _eventId: 3, _trigger: 1, isStarting: () => started })
    const guard = { controlToken: 'test', allowedEffects: ['navigate' as const], targetEventId: 3 }
    expect(await movePlayer({ x: 1, y: 0, stepwise: true, guard })).not.toHaveProperty('triggeredEventId')
    player.x = 0
    started = true
    expect(await movePlayer({ x: 1, y: 0, stepwise: true, guard })).toMatchObject({ triggeredEventId: 3 })
  })

  it('does not move while a dialogue is already open', async () => {
    g.$gameMessage = { isBusy: () => true }
    expect(await movePlayer({ x: 5, y: 0, stepwise: true })).toMatchObject({ interrupted: true, position: { x: 0, y: 0 } })
  })
})

describe('tapScreen / quitGame', () => {
  it('clamps the tap into the screen and releases after the frames', async () => {
    const touch = { _onTrigger: jest.fn(), _onRelease: jest.fn() }
    Object.assign(g, { TouchInput: touch, Graphics: { width: 816, height: 624 } })
    const result = await run(tapScreen({ x: 900, y: -5, frames: 3 }))
    expect(result).toEqual({ tapped: { x: 815, y: 0 }, frames: 3 })
    expect(touch._onTrigger).toHaveBeenCalledWith(815, 0)
    expect(touch._onRelease).toHaveBeenCalledWith(815, 0)
  })

  it('replies before exiting', () => {
    const exit = jest.fn()
    g.SceneManager = { exit }
    expect(quitGame()).toEqual({ quit: true })
    expect(exit).not.toHaveBeenCalled()
    jest.advanceTimersByTime(200)
    expect(exit).toHaveBeenCalled()
  })
})
