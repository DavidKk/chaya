type Ev = { x: number; y: number; trigger: number; normal: boolean; _erased?: boolean }

const ROWS = [
  '.........', //
  '..#####..',
  '..#...#..',
  '..##.##..',
  '.........',
  '.........',
]
const DOOR = { x: 4, y: 3 }
const DX: Record<number, number> = { 2: 0, 4: -1, 6: 1, 8: 0 }
const DY: Record<number, number> = { 2: 1, 4: 0, 6: 0, 8: -1 }

let events: Ev[] = []
let enabled = true
const original = jest.fn(() => 8)

function makeEvent(e: Ev) {
  return {
    ...e,
    page: () => ({}),
    isTriggerIn: (list: number[]) => list.includes(e.trigger),
    isNormalPriority: () => e.normal,
    list: () => [{ code: 201 }, { code: 0 }],
  }
}

class Game_CharacterBase {
  x = 0
  y = 0
  through = false
  canPass(x: number, y: number, d: number) {
    const nx = x + DX[d]
    const ny = y + DY[d]
    if (!map.isValid(nx, ny)) return false
    if (this.isThrough()) return true
    if (!this.isMapPassable(x, y, d)) return false
    return !this.isCollidedWithCharacters(nx, ny)
  }
  isMapPassable(x: number, y: number, d: number) {
    return ROWS[y + DY[d]]?.[x + DX[d]] === '.'
  }
  isCollidedWithCharacters(x: number, y: number) {
    return events.some((e) => e.normal && e.x === x && e.y === y)
  }
  isThrough() {
    return this.through
  }
}
class Game_Character extends Game_CharacterBase {
  findDirectionTo(x: number, y: number): number {
    return original(x, y)
  }
}
class Game_Player extends Game_Character {
  isInVehicle() {
    return false
  }
}

const map = {
  width: () => ROWS[0].length,
  height: () => ROWS.length,
  mapId: () => 1,
  isValid: (x: number, y: number) => x >= 0 && y >= 0 && x < ROWS[0].length && y < ROWS.length,
  events: () => events.map(makeEvent),
  deltaX: (a: number, b: number) => a - b,
  deltaY: (a: number, b: number) => a - b,
}

function install() {
  const g = globalThis as Record<string, unknown>
  delete g.__chayaSmartPath_v1__
  Object.assign(g, { Game_CharacterBase, Game_Character, Game_Player, $gameMap: map })
  delete (Game_Player.prototype as unknown as Record<string, unknown>).findDirectionTo
  jest.isolateModules(() => {
    const { installSmartPath } = jest.requireActual('@/plugins/src/cheat/runtime/smart-path')
    installSmartPath(() => enabled)
  })
  const player = new Game_Player()
  player.x = 4
  player.y = 5
  return player
}

function move(player: Game_Player, d: number) {
  player.x += DX[d]
  player.y += DY[d]
}

/** 像引擎一样每停一次取一步，直到返回 0、撞上或步数用完 */
function travel(player: Game_Player, goal: { x: number; y: number }, limit = 40) {
  const visited: Array<{ x: number; y: number }> = []
  for (let i = 0; i < limit; i++) {
    const d = player.findDirectionTo(goal.x, goal.y)
    if (!d || !player.canPass(player.x, player.y, d)) return { visited, last: d }
    move(player, d)
    visited.push({ x: player.x, y: player.y })
  }
  return { visited, last: -1 }
}

describe('installSmartPath', () => {
  beforeEach(() => {
    events = [{ ...DOOR, trigger: 1, normal: false }]
    enabled = true
    original.mockClear()
  })

  afterAll(() => {
    const g = globalThis as Record<string, unknown>
    for (const k of ['Game_CharacterBase', 'Game_Character', 'Game_Player', '$gameMap', '__chayaSmartPath_v1__']) delete g[k]
  })

  it('walks around the house to the tile behind it without stepping on the door', () => {
    const player = install()
    const { visited, last } = travel(player, { x: 4, y: 0 })
    expect(last).toBe(0)
    expect({ x: player.x, y: player.y }).toEqual({ x: 4, y: 0 })
    expect(visited).not.toContainEqual(DOOR)
    expect(original).not.toHaveBeenCalled()
  })

  it('enters the door when the door itself is clicked', () => {
    const player = install()
    travel(player, DOOR)
    expect({ x: player.x, y: player.y }).toEqual(DOOR)
  })

  it('reuses the planned route instead of searching every step', () => {
    const player = install()
    const passable = jest.spyOn(Game_CharacterBase.prototype, 'isMapPassable')
    move(player, player.findDirectionTo(4, 0))
    const planned = passable.mock.calls.length
    move(player, player.findDirectionTo(4, 0))
    expect(passable.mock.calls.length - planned).toBeLessThanOrEqual(1)
    passable.mockRestore()
  })

  it('drops the old route as soon as another tile is clicked', () => {
    const player = install()
    expect(player.findDirectionTo(8, 5)).toBe(6)
    move(player, 6)
    expect(player.findDirectionTo(0, 5)).toBe(4)
    const { visited } = travel(player, { x: 0, y: 5 })
    expect({ x: player.x, y: player.y }).toEqual({ x: 0, y: 5 })
    expect(visited.every(({ y }) => y === 5)).toBe(true)
  })

  it('replans when an NPC steps onto the next tile', () => {
    const player = install()
    const first = player.findDirectionTo(8, 5)
    expect(first).toBe(6)
    move(player, first)
    events.push({ x: 6, y: 5, trigger: 0, normal: true })
    const next = player.findDirectionTo(8, 5)
    expect(next).not.toBe(6)
    const { visited } = travel(player, { x: 8, y: 5 })
    expect(visited).not.toContainEqual({ x: 6, y: 5 })
    expect({ x: player.x, y: player.y }).toEqual({ x: 8, y: 5 })
  })

  it('faces an adjacent NPC goal so the engine can start its event', () => {
    events.push({ x: 4, y: 4, trigger: 0, normal: true })
    const player = install()
    expect(player.findDirectionTo(4, 4)).toBe(8)
  })

  it('stops at the nearest tile when the goal cannot be reached', () => {
    const player = install()
    const { last } = travel(player, { x: 4, y: 2 })
    expect(last).toBe(0)
    expect({ x: player.x, y: player.y }).toEqual({ x: 4, y: 4 })
  })

  it('faces an unreachable goal from the nearest tile when it is one step away', () => {
    const player = install()
    const { visited, last } = travel(player, { x: 4, y: 1 })
    expect(last).toBe(2)
    expect({ x: player.x, y: player.y }).toEqual({ x: 4, y: 0 })
    expect(visited).not.toContainEqual(DOOR)
  })

  it('falls back to the original when disabled or walking through walls', () => {
    const player = install()
    enabled = false
    expect(player.findDirectionTo(4, 0)).toBe(8)
    enabled = true
    player.through = true
    expect(player.findDirectionTo(4, 0)).toBe(8)
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('falls back to the original for fractional (pixel movement) coordinates', () => {
    const player = install()
    player.x = 4.5
    expect(player.findDirectionTo(4, 0)).toBe(8)
    expect(original).toHaveBeenCalledTimes(1)
  })

  it('replans a repeated click on an unreachable tile once the way opens', () => {
    events.push({ x: 4, y: 4, trigger: 0, normal: true }, { x: 3, y: 5, trigger: 0, normal: true }, { x: 5, y: 5, trigger: 0, normal: true })
    const player = install()
    expect(player.findDirectionTo(0, 5)).toBe(0)
    events = events.filter((e) => !(e.x === 3 && e.y === 5))
    expect(player.findDirectionTo(0, 5)).toBe(4)
  })

  it('keeps replanning toward an unreachable goal so it continues once an NPC clears the way', () => {
    for (let y = 0; y < ROWS.length; y++) events.push({ x: 1, y, trigger: 0, normal: true })
    const player = install()
    move(player, player.findDirectionTo(0, 5))
    events = events.filter((e) => !(e.x === 1 && e.y === 5))
    const { last } = travel(player, { x: 0, y: 5 })
    expect(last).toBe(0)
    expect({ x: player.x, y: player.y }).toEqual({ x: 0, y: 5 })
  })

  it('hands back to the original when a fresh route is blocked on its first step', () => {
    const player = install()
    ;(player as unknown as { isCollidedWithCharacters: (x: number, y: number) => boolean }).isCollidedWithCharacters = (x, y) => x === 5 && y === 5
    expect(player.findDirectionTo(8, 5)).toBe(8)
    expect(original).toHaveBeenCalledTimes(1)
  })

  it('replans when a touch event moves onto the planned route', () => {
    const player = install()
    expect(player.findDirectionTo(8, 5)).toBe(6)
    move(player, 6)
    events.push({ x: 6, y: 5, trigger: 2, normal: false })
    const { visited } = travel(player, { x: 8, y: 5 })
    expect(visited).not.toContainEqual({ x: 6, y: 5 })
    expect({ x: player.x, y: player.y }).toEqual({ x: 8, y: 5 })
  })

  it('faces a clerk across a counter', () => {
    const counterMap = map as typeof map & { isCounter?: (x: number, y: number) => boolean }
    counterMap.isCounter = (x, y) => x === 4 && y === 4
    events.push({ x: 4, y: 4, trigger: 0, normal: true }, { x: 4, y: 3, trigger: 0, normal: true })
    const player = install()
    expect(player.findDirectionTo(4, 3)).toBe(8)
    delete counterMap.isCounter
  })

  it('honours plugins that alias the base canPass', () => {
    const base = Game_CharacterBase.prototype.canPass
    Game_CharacterBase.prototype.canPass = function (x, y, d) {
      return !(x + DX[d] === 3 && y + DY[d] === 5) && base.call(this, x, y, d)
    }
    try {
      const player = install()
      const { visited } = travel(player, { x: 0, y: 5 })
      expect(visited).not.toContainEqual({ x: 3, y: 5 })
      expect({ x: player.x, y: player.y }).toEqual({ x: 0, y: 5 })
    } finally {
      Game_CharacterBase.prototype.canPass = base
    }
  })

  it('asks canPass per edge when a plugin overrides it', () => {
    const player = install()
    const blocked = (x: number, y: number) => x === 3 && y === 5
    ;(player as unknown as { canPass: (x: number, y: number, d: number) => boolean }).canPass = function (x, y, d) {
      return !blocked(x + DX[d], y + DY[d]) && Game_CharacterBase.prototype.canPass.call(this, x, y, d)
    }
    const { visited } = travel(player, { x: 0, y: 5 })
    expect(visited).not.toContainEqual({ x: 3, y: 5 })
    expect({ x: player.x, y: player.y }).toEqual({ x: 0, y: 5 })
  })
})
