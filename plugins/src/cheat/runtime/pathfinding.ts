/** 四方向 A*：通行按边判断（RPG Maker 的 isPassable(x, y, d)），由 PathGrid 提供 */

export type Direction = 2 | 4 | 6 | 8
export type Point = { x: number; y: number }

export type PathGrid = {
  width: number
  height: number
  loopX: boolean
  loopY: boolean
  /** 从 (x, y) 朝 d 走一步是否可行 */
  canStep(x: number, y: number, d: Direction): boolean
  /** 会触发的格：除目标外不进入 */
  avoid(x: number, y: number): boolean
}

export type PathResult = {
  steps: Direction[]
  /** 路线终点：reached 时为目标，否则为离目标最近的可达格 */
  end: Point
  reached: boolean
}

export const MAX_PATH_CELLS = 1 << 20

const DIRECTIONS: readonly Direction[] = [2, 4, 6, 8]

export function stepX(x: number, d: Direction, width: number, loop: boolean) {
  const n = x + (d === 6 ? 1 : d === 4 ? -1 : 0)
  return loop ? (n + width) % width : n
}

export function stepY(y: number, d: Direction, height: number, loop: boolean) {
  const n = y + (d === 2 ? 1 : d === 8 ? -1 : 0)
  return loop ? (n + height) % height : n
}

function axisDistance(a: number, b: number, size: number, loop: boolean) {
  const d = Math.abs(a - b)
  return loop ? Math.min(d, size - d) : d
}

/** 节点为 Int32，键为 f；同 f 时 h 小者优先 */
class MinHeap {
  private nodes: Int32Array
  private f: Float64Array
  private h: Float64Array
  size = 0

  constructor(capacity: number) {
    this.nodes = new Int32Array(capacity)
    this.f = new Float64Array(capacity)
    this.h = new Float64Array(capacity)
  }

  private less(i: number, j: number) {
    return this.f[i] < this.f[j] || (this.f[i] === this.f[j] && this.h[i] < this.h[j])
  }

  private swap(i: number, j: number) {
    const n = this.nodes[i]
    this.nodes[i] = this.nodes[j]
    this.nodes[j] = n
    const f = this.f[i]
    this.f[i] = this.f[j]
    this.f[j] = f
    const h = this.h[i]
    this.h[i] = this.h[j]
    this.h[j] = h
  }

  push(node: number, f: number, h: number) {
    if (this.size === this.nodes.length) this.grow()
    let i = this.size++
    this.nodes[i] = node
    this.f[i] = f
    this.h[i] = h
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(i, parent)) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop() {
    const top = this.nodes[0]
    const last = --this.size
    if (last > 0) {
      this.nodes[0] = this.nodes[last]
      this.f[0] = this.f[last]
      this.h[0] = this.h[last]
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < last && this.less(l, m)) m = l
        if (r < last && this.less(r, m)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private grow() {
    const size = this.nodes.length * 2
    const nodes = new Int32Array(size)
    const f = new Float64Array(size)
    const h = new Float64Array(size)
    nodes.set(this.nodes)
    f.set(this.f)
    h.set(this.h)
    this.nodes = nodes
    this.f = f
    this.h = h
  }
}

/** 地图超过 MAX_PATH_CELLS、起点越界或不是整数时返回 null；展开 maxExpand 个节点仍未到达时按走不到处理 */
export function findPath(grid: PathGrid, start: Point, goal: Point, maxExpand = Infinity): PathResult | null {
  const { width, height, loopX, loopY } = grid
  const cells = width * height
  if (!(width > 0 && height > 0) || cells > MAX_PATH_CELLS) return null
  if (![start.x, start.y, goal.x, goal.y].every(Number.isInteger)) return null
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return null

  const index = (x: number, y: number) => y * width + x
  const heuristic = (x: number, y: number) => axisDistance(x, goal.x, width, loopX) + axisDistance(y, goal.y, height, loopY)
  const goalIndex = goal.x >= 0 && goal.y >= 0 && goal.x < width && goal.y < height ? index(goal.x, goal.y) : -1

  const g = new Int32Array(cells).fill(-1)
  const parent = new Int32Array(cells).fill(-1)
  const via = new Uint8Array(cells)
  const closed = new Uint8Array(cells)
  const open = new MinHeap(Math.min(cells, 1024))

  const startIndex = index(start.x, start.y)
  g[startIndex] = 0
  let best = startIndex
  let bestH = heuristic(start.x, start.y)
  open.push(startIndex, bestH, bestH)

  let expanded = 0
  while (open.size > 0 && expanded < maxExpand) {
    const current = open.pop()
    if (closed[current]) continue
    closed[current] = 1
    expanded++
    if (current === goalIndex) {
      best = current
      bestH = 0
      break
    }
    const cx = current % width
    const cy = (current - cx) / width
    const ch = heuristic(cx, cy)
    if (ch < bestH || (ch === bestH && g[current] < g[best])) {
      best = current
      bestH = ch
    }
    for (const d of DIRECTIONS) {
      const nx = stepX(cx, d, width, loopX)
      const ny = stepY(cy, d, height, loopY)
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = index(nx, ny)
      if (closed[next]) continue
      if (next !== goalIndex && grid.avoid(nx, ny)) continue
      if (!grid.canStep(cx, cy, d)) continue
      const ng = g[current] + 1
      if (g[next] >= 0 && ng >= g[next]) continue
      g[next] = ng
      parent[next] = current
      via[next] = d
      const nh = heuristic(nx, ny)
      open.push(next, ng + nh, nh)
    }
  }

  const steps: Direction[] = []
  for (let node = best; node !== startIndex; node = parent[node]) steps.push(via[node] as Direction)
  steps.reverse()
  const ex = best % width
  return { steps, end: { x: ex, y: (best - ex) / width }, reached: best === goalIndex }
}
