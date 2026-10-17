/** @jest-environment jsdom */
import { currentVisibleBounds, movePlayer, quitGame, tapScreen } from '@/plugins/src/agent/game-control'

type Globals = Record<string, unknown>

const g = globalThis as unknown as Globals

class Scene_Map {}

const player = {
  x: 0,
  y: 0,
  moving: false,
  canMove: () => true,
  isMoving: () => player.moving,
  findDirectionTo: (_x: number, _y: number) => 6,
  moveStraight: (direction: number) => {
    if (direction === 6) player.x++
    if (direction === 4) player.x--
    if (direction === 2) player.y++
    if (direction === 8) player.y--
  },
}
const temp = { _destinationX: null as number | null, _destinationY: null as number | null, isDestinationValid: () => temp._destinationX != null }
const events: Array<{ _x: number; _y: number; _eventId: number; _trigger: number; isStarting?: () => boolean }> = []
const map = { id: 1, mapId: () => map.id, events: () => events, tileWidth: () => 48, tileHeight: () => 48 }
let step: () => void = () => {}
let canvas: HTMLCanvasElement
const mouseDown = (event: MouseEvent) => {
  const touch = g.TouchInput as { _onTrigger: (x: number, y: number) => void; pressed?: boolean }
  const graphics = g.Graphics as { width: number; height: number; pageToCanvasX?: (x: number) => number; pageToCanvasY?: (y: number) => number }
  const rect = canvas.getBoundingClientRect()
  touch.pressed = true
  touch._onTrigger(
    graphics.pageToCanvasX?.(event.pageX) ?? ((event.clientX - rect.left) / rect.width) * graphics.width,
    graphics.pageToCanvasY?.(event.pageY) ?? ((event.clientY - rect.top) / rect.height) * graphics.height
  )
}
const mouseUp = (event: MouseEvent) => {
  const touch = g.TouchInput as { _onRelease: (x: number, y: number) => void; pressed?: boolean }
  const graphics = g.Graphics as { width: number; height: number; pageToCanvasX?: (x: number) => number; pageToCanvasY?: (y: number) => number }
  const rect = canvas.getBoundingClientRect()
  touch.pressed = false
  touch._onRelease(((event.clientX - rect.left) / rect.width) * graphics.width, ((event.clientY - rect.top) / rect.height) * graphics.height)
}

beforeEach(() => {
  jest.useFakeTimers()
  canvas = document.createElement('canvas')
  canvas.id = 'GameCanvas'
  document.body.appendChild(canvas)
  jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 408, height: 312 } as DOMRect)
  document.addEventListener('mousedown', mouseDown)
  document.addEventListener('mouseup', mouseUp)
  Object.assign(player, { x: 0, y: 0, moving: false })
  Object.assign(temp, { _destinationX: null, _destinationY: null })
  map.id = 1
  events.length = 0
  step = () => {
    if (player.moving || !player.canMove() || (g.$gameMessage as { isBusy?: () => boolean } | undefined)?.isBusy?.()) return
    if (temp._destinationX != null) {
      if (player.x !== temp._destinationX) player.x += Math.sign(temp._destinationX - player.x)
      else if (temp._destinationY != null && player.y !== temp._destinationY) player.y += Math.sign(temp._destinationY - player.y)
    }
  }
  Object.assign(g, {
    Scene_Map,
    SceneManager: { _scene: new Scene_Map() },
    $gamePlayer: player,
    $gameTemp: temp,
    $gameMap: map,
    Graphics: { width: 816, height: 624 },
    TouchInput: {
      _onMouseDown: mouseDown,
      _onMouseUp: mouseUp,
      _onTrigger: (x: number, y: number) => {
        // The map requires both trigger and pressed state, like RPG Maker's processMapTouch.
        if (!(g.TouchInput as { pressed?: boolean }).pressed) return
        temp._destinationX = Math.floor(x / 48)
        temp._destinationY = Math.floor(y / 48)
      },
      _onRelease: () => {},
    },
  })
})

afterEach(() => {
  document.removeEventListener('mousedown', mouseDown)
  document.removeEventListener('mouseup', mouseUp)
  canvas.remove()
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
    expect(await run(movePlayer({ x: 3, y: 0 }))).toMatchObject({ arrived: true, mapId: 1, position: { x: 3, y: 0 }, target: { x: 3, y: 0 } })
  })

  it('stops when a transfer tile changes the map', async () => {
    step = () => {
      if (map.id !== 1) return
      player.x += 1
      if (player.x >= 2) {
        map.id = 2
        Object.assign(player, { x: 1, y: 6 })
      }
    }
    const result = await run(movePlayer({ x: 16, y: 6 }))
    expect(result).toMatchObject({ arrived: false, transferred: true, mapId: 2, position: { x: 1, y: 6 }, target: { x: 16, y: 6 } })
    expect(temp._destinationX).toBeNull()
  })

  it('gives up at the timeout and clears the destination', async () => {
    const move = jest.spyOn(player, 'moveStraight').mockImplementation(() => {})
    const result = await run(movePlayer({ x: 5, y: 5, timeoutMs: 1000 }))
    expect(result).toMatchObject({ arrived: false, position: { x: 0, y: 0 } })
    expect(result).not.toHaveProperty('transferred')
    expect(temp).toMatchObject({ _destinationX: null, _destinationY: null })
    move.mockRestore()
  })

  it('only works on the map scene', async () => {
    g.SceneManager = { _scene: {} }
    await expect(movePlayer({ x: 1, y: 1 })).rejects.toThrow('地图')
  })

  it('takes only one step toward a distant target', async () => {
    expect(await run(movePlayer({ x: 5, y: 0, stepwise: true }))).toMatchObject({ moved: true, arrived: false, position: { x: 1, y: 0 } })
  })

  it('plans around another touch event instead of stepping onto it', async () => {
    events.push({ _x: 1, _y: 0, _eventId: 7, _trigger: 1 })
    expect(await run(movePlayer({ x: 5, y: 0, stepwise: true, guard: { controlToken: 'test', allowedEffects: ['navigate'], targetEventId: 3 } }))).toMatchObject({
      navigation: { status: 'reachable', eventBoundaryIds: [] },
      position: { x: 0, y: 1 },
    })
  })

  it('only reports the target touch event when activation is observed', async () => {
    let started = false
    events.push({ _x: 1, _y: 0, _eventId: 3, _trigger: 1, isStarting: () => started })
    const guard = { controlToken: 'test', allowedEffects: ['navigate' as const], targetEventId: 3 }
    expect(await run(movePlayer({ x: 1, y: 0, stepwise: true, guard }))).not.toHaveProperty('triggeredEventId')
    player.x = 0
    started = true
    expect(await run(movePlayer({ x: 1, y: 0, stepwise: true, guard }))).toMatchObject({ interrupted: true, position: { x: 0, y: 0 } })
  })

  it.each([false, true])('does not move while a dialogue is already open (stepwise=%s)', async (stepwise) => {
    g.$gameMessage = { isBusy: () => true }
    expect(await run(movePlayer({ x: 5, y: 0, stepwise }))).toMatchObject({ interrupted: true, position: { x: 0, y: 0 } })
  })

  it('uses tile screen coordinates for real map clicks', async () => {
    const tileMap = { ...map, tileWidth: () => 48, tileHeight: () => 48, displayX: () => 0, displayY: () => 0 }
    const touch = {
      _onTrigger: jest.fn((x: number, y: number) => {
        temp._destinationX = Math.floor(x / 48)
        temp._destinationY = Math.floor(y / 48)
      }),
      _onRelease: jest.fn(),
    }
    Object.assign(g, { $gameMap: tileMap, TouchInput: Object.assign(touch, { _onMouseDown: mouseDown, _onMouseUp: mouseUp }), Graphics: { width: 816, height: 624 } })
    await run(tapScreen({ x: 72, y: 24, frames: 2 }))
    expect(touch._onTrigger).toHaveBeenCalledWith(72, 24)
    expect(touch._onRelease).toHaveBeenCalledWith(72, 24)
    expect((g.TouchInput as { pressed?: boolean }).pressed).toBe(false)
  })

  it('does not cross below-player or through touch entrances while seeking another target', async () => {
    const entrance = { _x: 1, _y: 0, _eventId: 8, _trigger: 1, isNormalPriority: () => false, isThrough: () => true }
    const corridor = { ...map, width: () => 4, height: () => 1, events: () => [entrance], isPassable: () => true }
    g.$gameMap = corridor
    expect(await run(movePlayer({ x: 3, y: 0 }))).toMatchObject({ blocked: true, blockedReason: 'event_boundary', position: { x: 0, y: 0 } })
    expect(temp._destinationX).toBeNull()
  })
  it('respects the engine movement lock without issuing a click', async () => {
    const original = player.canMove
    player.canMove = () => false
    const touch = { _onTrigger: jest.fn(), _onRelease: jest.fn() }
    g.TouchInput = Object.assign(touch, { _onMouseDown: mouseDown, _onMouseUp: mouseUp })
    try {
      expect(await run(movePlayer({ x: 5, y: 0 }))).toMatchObject({ interrupted: true, position: { x: 0, y: 0 } })
      expect(touch._onTrigger).not.toHaveBeenCalled()
      expect(temp._destinationX).toBeNull()
    } finally {
      player.canMove = original
    }
  })

  it('stops and clears queued movement when dialogue opens during the walk', async () => {
    step = () => {
      if (player.x === 1) g.$gameMessage = { isBusy: () => true }
    }
    expect(await run(movePlayer({ x: 5, y: 0 }))).toMatchObject({ interrupted: true, position: { x: 1, y: 0 } })
    expect(temp._destinationX).toBeNull()
  })

  it('calls normal mouse handlers with scaled press and release events', async () => {
    const downs: MouseEvent[] = []
    const ups: MouseEvent[] = []
    Object.assign(g.TouchInput as object, {
      _onMouseDown: (event: MouseEvent) => {
        downs.push(event)
        mouseDown(event)
      },
      _onMouseUp: (event: MouseEvent) => {
        ups.push(event)
        mouseUp(event)
      },
    })
    await run(tapScreen({ x: 72, y: 24, frames: 2 }))
    expect(downs[0]).toMatchObject({ clientX: 46, clientY: 32, buttons: 1, button: 0 })
    expect(ups[0]).toMatchObject({ clientX: 46, clientY: 32, buttons: 0, button: 0 })
  })

  it('uses the engine coordinate conversion when canvas display scaling differs', async () => {
    Object.assign(g.Graphics as object, { pageToCanvasX: (x: number) => Math.round((x - 30) / 3), pageToCanvasY: (y: number) => Math.round((y - 40) / 3) })
    const trigger = jest.spyOn(g.TouchInput as { _onTrigger: (x: number, y: number) => void }, '_onTrigger')
    await run(tapScreen({ x: 72, y: 24, frames: 2 }))
    expect(trigger).toHaveBeenCalledWith(72, 24)
  })
  it('fails without mouse input rather than directly setting a destination', async () => {
    delete g.TouchInput
    await expect(tapScreen({ x: 72, y: 24 })).rejects.toThrow('鼠标输入未就绪')
    expect(temp._destinationX).toBeNull()
    expect(player.x).toBe(0)
  })

  it('does not start walking while an event interpreter is running', async () => {
    g.$gameMap = { ...map, isEventRunning: () => true }
    const move = jest.spyOn(player, 'moveStraight')
    try {
      expect(await run(movePlayer({ x: 5, y: 0 }))).toMatchObject({ interrupted: true, position: { x: 0, y: 0 } })
      expect(move).not.toHaveBeenCalled()
    } finally {
      move.mockRestore()
    }
  })

  it('stops before the next step if an event starts during the walk', async () => {
    const move = jest.spyOn(player, 'moveStraight')
    const original = move.getMockImplementation()!
    move.mockImplementation((direction) => {
      original(direction)
      g.$gameMap = { ...map, isEventRunning: () => true }
    })
    try {
      expect(await run(movePlayer({ x: 5, y: 0 }))).toMatchObject({ interrupted: true, position: { x: 1, y: 0 } })
      expect(move).toHaveBeenCalledTimes(1)
    } finally {
      move.mockRestore()
    }
  })

  it('does not change player coordinates when the engine stops producing frames', async () => {
    Object.assign(g.Graphics as object, { frameCount: 10 })
    const move = jest.spyOn(player, 'moveStraight')
    try {
      expect(await run(movePlayer({ x: 5, y: 0 }))).toMatchObject({ interrupted: true, blockedReason: 'game_not_updating', position: { x: 0, y: 0 } })
      expect(move).not.toHaveBeenCalled()
    } finally {
      move.mockRestore()
    }
  })

  it('does not walk while the game loop is paused', async () => {
    g.SceneManager = { _scene: new Scene_Map(), _stopped: true }
    expect(await run(movePlayer({ x: 5, y: 0 }))).toMatchObject({ interrupted: true, blockedReason: 'game_paused', position: { x: 0, y: 0 } })
  })
  it('uses guarded engine steps after the player movement lock is checked', async () => {
    const move = jest.spyOn(player, 'moveStraight')
    try {
      expect(await run(movePlayer({ x: 1, y: 0, stepwise: true }))).toMatchObject({ arrived: true })
      expect(move).toHaveBeenCalledWith(6)
    } finally {
      move.mockRestore()
    }
  })
})

describe('currentVisibleBounds', () => {
  it('falls back when map.width throws because $dataMap is missing', () => {
    Object.assign(player, { x: 12, y: 8 })
    g.$gameMap = {
      ...map,
      width: () => {
        throw new TypeError("Cannot read properties of null (reading 'width')")
      },
      height: () => 20,
    }
    expect(currentVisibleBounds()).toEqual({ minX: 0, minY: 0, maxX: 76, maxY: 72 })
  })
})

describe('tapScreen / quitGame', () => {
  it('clamps the tap into the screen and releases after the frames', async () => {
    const touch = { _onTrigger: jest.fn(), _onRelease: jest.fn() }
    Object.assign(g, { TouchInput: Object.assign(touch, { _onMouseDown: mouseDown, _onMouseUp: mouseUp }), Graphics: { width: 816, height: 624 } })
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
