import { type Direction, findPath, type PathGrid, type Point, stepX, stepY } from '@/plugins/src/cheat/runtime/pathfinding'

/** # 墙 · D 会触发的格（可走）· . 空地 */
function grid(rows: string[], opts: Partial<Pick<PathGrid, 'loopX' | 'loopY' | 'canStep'>> = {}): PathGrid {
  const width = rows[0].length
  const height = rows.length
  const loopX = !!opts.loopX
  const loopY = !!opts.loopY
  const at = (x: number, y: number) => rows[y]?.[x]
  return {
    width,
    height,
    loopX,
    loopY,
    avoid: (x, y) => at(x, y) === 'D',
    canStep:
      opts.canStep ??
      ((x, y, d) => {
        const c = at(stepX(x, d, width, loopX), stepY(y, d, height, loopY))
        return c !== undefined && c !== '#'
      }),
  }
}

function walk(g: PathGrid, start: Point, steps: Direction[]) {
  const cells: Point[] = []
  let { x, y } = start
  for (const d of steps) {
    x = stepX(x, d, g.width, g.loopX)
    y = stepY(y, d, g.height, g.loopY)
    cells.push({ x, y })
  }
  return cells
}

describe('findPath', () => {
  it('walks a straight line on open ground', () => {
    const g = grid(['.....', '.....', '.....'])
    const r = findPath(g, { x: 0, y: 1 }, { x: 4, y: 1 })!
    expect(r).toMatchObject({ reached: true, end: { x: 4, y: 1 } })
    expect(r.steps).toEqual([6, 6, 6, 6])
  })

  it('detours around a long wall the engine 12-step search cannot see past', () => {
    const rows = ['....................', '.##################.', '....................']
    const g = grid(rows)
    const r = findPath(g, { x: 10, y: 2 }, { x: 10, y: 0 })!
    expect(r.reached).toBe(true)
    expect(r.steps).toHaveLength(20)
    expect(walk(g, { x: 10, y: 2 }, r.steps).every(({ x, y }) => rows[y][x] !== '#')).toBe(true)
  })

  it('goes around a house instead of through its door', () => {
    const rows = [
      '.........', //
      '..#####..',
      '..#...#..',
      '..##D##..',
      '.........',
      '.........',
    ]
    const g = grid(rows)
    const behind = findPath(g, { x: 4, y: 5 }, { x: 4, y: 0 })!
    expect(behind.reached).toBe(true)
    expect(walk(g, { x: 4, y: 5 }, behind.steps)).not.toContainEqual({ x: 4, y: 3 })

    const door = findPath(g, { x: 4, y: 5 }, { x: 4, y: 3 })!
    expect(door).toMatchObject({ reached: true, steps: [8, 8] })
  })

  it('stops at the nearest reachable tile without passing the door when the goal is inside', () => {
    const rows = ['..#####..', '..#...#..', '..##D##..', '.........']
    const g = grid(rows)
    const r = findPath(g, { x: 0, y: 3 }, { x: 4, y: 1 })!
    expect(r.reached).toBe(false)
    expect(walk(g, { x: 0, y: 3 }, r.steps)).not.toContainEqual({ x: 4, y: 2 })
    expect(r.end).toEqual({ x: 4, y: 3 })
  })

  it('prefers the shorter of equally near tiles when the goal is unreachable', () => {
    const g = grid(['...#.', '...#.', '...#.'])
    const r = findPath(g, { x: 2, y: 1 }, { x: 4, y: 1 })!
    expect(r).toMatchObject({ reached: false, end: { x: 2, y: 1 }, steps: [] })
  })

  it('respects per-direction passability (one-way ledge)', () => {
    const base = grid(['...', '...', '...'])
    const g: PathGrid = {
      ...base,
      canStep: (x, y, d) => base.canStep(x, y, d) && !(y === 1 && d === 8) && !(y === 2 && d === 8 && x !== 2),
    }
    const r = findPath(g, { x: 0, y: 2 }, { x: 0, y: 0 })!
    expect(r.reached).toBe(false)
    const down = findPath(g, { x: 0, y: 0 }, { x: 0, y: 2 })!
    expect(down).toMatchObject({ reached: true, steps: [2, 2] })
  })

  it('wraps around loop maps by the shorter side', () => {
    const g = grid(['..........'], { loopX: true })
    const r = findPath(g, { x: 1, y: 0 }, { x: 8, y: 0 })!
    expect(r).toMatchObject({ reached: true, steps: [4, 4, 4] })
  })

  it('floods a 256x256 map when the goal is walled off', () => {
    const size = 256
    const g: PathGrid = {
      width: size,
      height: size,
      loopX: false,
      loopY: false,
      avoid: () => false,
      canStep: (x, y, d) => {
        const nx = stepX(x, d, size, false)
        const ny = stepY(y, d, size, false)
        return nx >= 0 && ny >= 0 && nx < size && ny < size && nx !== 200
      },
    }
    const r = findPath(g, { x: 0, y: 0 }, { x: 250, y: 250 })!
    expect(r.reached).toBe(false)
    expect(r.end).toEqual({ x: 199, y: 250 })
  })

  it('gives up after the expansion budget and heads for the nearest tile found so far', () => {
    const g = grid(['....................'])
    const r = findPath(g, { x: 0, y: 0 }, { x: 19, y: 0 }, 5)!
    expect(r.reached).toBe(false)
    expect(r.steps).toEqual([6, 6, 6, 6])
  })

  it('returns null for oversized maps, a start outside the map or fractional coordinates', () => {
    const g = grid(['...'])
    expect(findPath({ ...g, width: 2048, height: 2048 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull()
    expect(findPath(g, { x: 5, y: 0 }, { x: 1, y: 0 })).toBeNull()
    expect(findPath(g, { x: 0.5, y: 0 }, { x: 2, y: 0 })).toBeNull()
  })
})
