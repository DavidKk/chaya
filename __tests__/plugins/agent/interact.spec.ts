import { interactEvent } from '@/plugins/src/agent/interact'

jest.mock('@/plugins/src/agent/game-control', () => ({
  movePlayer: jest.fn(async ({ x, y }: { x: number; y: number }) => {
    const g = globalThis as unknown as { $gamePlayer: { x: number; y: number } }
    g.$gamePlayer.x = x
    g.$gamePlayer.y = y
    return { arrived: true, mapId: 1, position: { x, y }, target: { x, y } }
  }),
}))

class Scene_Map {}

type Message = { busy: boolean; speaker: string | null; text: string | null; choices: string[] | null }

function setup({ normalPriority = true, lines = ['Hello'], choices = null as string[] | null } = {}) {
  const event = { _x: 3, _y: 3, _pageIndex: 1, event: () => ({ name: 'Boris' }), isNormalPriority: () => normalPriority, isStarting: () => false }
  const player = { x: 0, y: 3, direction: 2, isMoving: () => false, setDirection: jest.fn((d: number) => (player.direction = d)), isCollidedWithCharacters: () => false }
  const queue = [...lines]
  let message: Message = { busy: false, speaker: null, text: null, choices: null }
  let gold = 0
  Object.assign(globalThis, {
    Scene_Map,
    SceneManager: { _scene: new Scene_Map() },
    $gameMap: { mapId: () => 1, event: () => event, isValid: () => true, isPassable: () => true, isEventRunning: () => message.busy },
    $gamePlayer: player,
    $gameMessage: {},
  })
  const press = jest.fn(async () => {
    if (message.busy) {
      const next = queue.shift()
      message = next ? { busy: true, speaker: 'Boris', text: next, choices: null } : { busy: false, speaker: null, text: null, choices: null }
      if (!next) gold += 10
      return
    }
    const facing = player.direction === 6 && player.x === 2 && player.y === 3
    const onTile = !normalPriority && player.x === 3 && player.y === 3
    if (facing || onTile) message = { busy: true, speaker: 'Boris', text: queue.shift() ?? null, choices: queue.length ? null : choices }
  })
  const readState = () => ({ scene: 'Scene_Map', gold, map: { id: 1 }, inventory: { items: [], weapons: [], armors: [] }, message })
  return { press, readState, player }
}

describe('interactEvent', () => {
  it('walks beside a blocking event, faces it and reads its dialogue', async () => {
    const game = setup({ lines: ['Hello', 'Take this'] })
    const result = await interactEvent({ eventId: 5 }, { press: game.press, readState: game.readState, interrupted: () => false })
    expect(game.player).toMatchObject({ x: 2, y: 3, direction: 6 })
    expect(result).toMatchObject({ eventId: 5, name: 'Boris', outcome: 'done', goldChange: 10, messages: [{ text: 'Hello' }, { text: 'Take this' }] })
  })

  it('stands on events below the player', async () => {
    const game = setup({ normalPriority: false })
    const result = await interactEvent({ eventId: 5 }, { press: game.press, readState: game.readState, interrupted: () => false })
    expect(game.player).toMatchObject({ x: 3, y: 3 })
    expect(result).toMatchObject({ outcome: 'done' })
  })

  it('does not walk to events whose current page has nothing to run', async () => {
    const game = setup()
    const event = (globalThis as unknown as { $gameMap: { event: () => Record<string, unknown> } }).$gameMap.event()
    event.list = () => [{ code: 0 }]
    const result = await interactEvent({ eventId: 5 }, { press: game.press, readState: game.readState, interrupted: () => false })
    expect(result).toMatchObject({ outcome: 'nothing_to_run' })
    expect(game.player).toMatchObject({ x: 0, y: 3 })
  })

  it('opens a closed touch door on the way and then reaches the target', async () => {
    const door = { _x: 2, _y: 0, _pageIndex: 0, _trigger: 1, eventId: () => 2, event: () => ({ name: 'Door' }), isNormalPriority: () => true, isStarting: () => false }
    const chest = { _x: 4, _y: 0, _pageIndex: 0, _trigger: 0, eventId: () => 5, event: () => ({ name: 'Chest' }), isNormalPriority: () => true, isStarting: () => false }
    const player = { x: 0, y: 0, direction: 2, isMoving: () => false, setDirection: (d: number) => (player.direction = d), isMapPassable: () => true }
    let gold = 0
    Object.assign(globalThis, {
      Scene_Map,
      SceneManager: { _scene: new Scene_Map() },
      $gameMap: {
        mapId: () => 1,
        width: () => 6,
        height: () => 1,
        event: (id: number) => (id === 2 ? door : chest),
        eventsXy: (x: number) => [door, chest].filter((event) => event._x === x && !(event === door && door._pageIndex > 0)),
        isValid: (x: number, y: number) => x >= 0 && x < 6 && y === 0,
        isPassable: () => true,
        isEventRunning: () => false,
      },
      $gamePlayer: player,
      $gameMessage: {},
    })
    const { movePlayer } = jest.requireMock('@/plugins/src/agent/game-control') as { movePlayer: jest.Mock }
    const original = movePlayer.getMockImplementation()
    movePlayer.mockImplementation(async ({ x, y }: { x: number; y: number }) => {
      if (Math.max(x, player.x) > 2 && Math.min(x, player.x) < 2 && door._pageIndex === 0) return { arrived: false }
      player.x = x
      player.y = y
      return { arrived: true }
    })
    const press = jest.fn(async () => {
      if (player.x === 1 && player.direction === 6) {
        door._pageIndex = 1
        player.x = 3
      } else if (player.x === 3 && player.direction === 6) gold += 10
    })
    const readState = () => ({
      gold,
      inventory: { items: [], weapons: [], armors: [] },
      message: { busy: false, speaker: null, text: null, choices: null },
      nearbyEvents: [
        { id: 2, trigger: 'player_touch', effects: [] },
        { id: 5, trigger: 'action', effects: ['gold'] },
      ],
    })
    try {
      const result = await interactEvent({ eventId: 5 }, { press, readState, interrupted: () => false })
      expect(result).toMatchObject({ outcome: 'done', goldChange: 10, position: { x: 3, y: 0 } })
      expect(door._pageIndex).toBe(1)
    } finally {
      movePlayer.mockImplementation(original)
    }
  })

  it('returns choices to the caller instead of picking one', async () => {
    const game = setup({ lines: ['Enter?'], choices: ['Yes', 'No'] })
    const result = await interactEvent({ eventId: 5 }, { press: game.press, readState: game.readState, interrupted: () => false })
    expect(result).toMatchObject({ outcome: 'choice', choices: ['Yes', 'No'], messages: [{ text: 'Enter?' }] })
  })
})
