/**
 * 增强寻路：接管 Game_Player.findDirectionTo，用整图 A* 替代引擎 12 步的搜索，并绕开会触发的事件格
 */

import { gameMap } from './game-globals'
import { type Direction, findPath, type PathGrid, stepX, stepY } from './pathfinding'

type FindDirection = (this: any, x: number, y: number) => number
type Log = { warn: (...args: unknown[]) => void }
type Hook = { enabled: () => boolean; log?: Log }

type Route = {
  mapId: number
  goalX: number
  goalY: number
  steps: Direction[]
  cursor: number
  /** false：目标走不到，路线只通往最近可达格，环境可能变化（NPC 让开通道），每步都重新规划 */
  reached: boolean
  /** 下一步出发时玩家应在的格 */
  atX: number
  atY: number
}

const INSTALL_KEY = '__chayaSmartPath_v1__'
/** 单次规划最多展开的格数，约为 180×180 的地图；超出按走不到处理，避免一步卡顿过久 */
const MAX_EXPAND = 32768
const BUDGET_MS = 6

let route: Route | null = null

function bool(owner: any, name: string) {
  return typeof owner?.[name] === 'function' && !!owner[name]()
}

function liveEvents(map: any): any[] {
  const list = typeof map.events === 'function' ? map.events() : []
  return Array.isArray(list) ? list.filter((e) => e && !e._erased) : []
}

/** 接触 / 事件接触触发、不挡路且有内容的事件；普通优先级的会挡路，交给 canPass */
function isTouchTrigger(event: any) {
  if (typeof event.page === 'function' && !event.page()) return false
  if (typeof event.isTriggerIn !== 'function' || !event.isTriggerIn([1, 2])) return false
  if (typeof event.isNormalPriority === 'function' && event.isNormalPriority()) return false
  const list = typeof event.list === 'function' ? event.list() : null
  return Array.isArray(list) && list.length > 1
}

function hasTouchTrigger(map: any, x: number, y: number) {
  return liveEvents(map).some((e) => e.x === x && e.y === y && isTouchTrigger(e))
}

/**
 * 通行逐边走 player.canPass，其他插件对 canPass / isMapPassable 的改写都生效。
 * 引擎的碰撞判定每次遍历全部事件，规划期间在实例上临时替换为「格上有事件或载具才判定」
 */
function withGrid<T>(player: any, map: any, run: (grid: PathGrid) => T): T {
  const width = Number(map.width())
  const height = Number(map.height())
  const key = (x: number, y: number) => y * width + x
  const avoid = new Set<number>()
  const occupied = new Set<number>()
  for (const event of liveEvents(map)) {
    const at = key(event.x, event.y)
    occupied.add(at)
    if (isTouchTrigger(event)) avoid.add(at)
  }
  for (const name of ['boat', 'ship', 'airship']) {
    const vehicle = typeof map[name] === 'function' ? map[name]() : null
    if (vehicle && Number.isFinite(vehicle.x)) occupied.add(key(vehicle.x, vehicle.y))
  }
  const hadOwn = Object.prototype.hasOwnProperty.call(player, 'isCollidedWithCharacters')
  const ownCollide = hadOwn ? player.isCollidedWithCharacters : undefined
  const collide = player.isCollidedWithCharacters
  if (typeof collide === 'function') {
    player.isCollidedWithCharacters = function (x: number, y: number) {
      return occupied.has(key(x, y)) && !!collide.call(this, x, y)
    }
  }
  try {
    return run({
      width,
      height,
      loopX: bool(map, 'isLoopHorizontally'),
      loopY: bool(map, 'isLoopVertically'),
      avoid: (x, y) => avoid.has(key(x, y)),
      canStep: (x, y, d) => !!player.canPass(x, y, d),
    })
  } finally {
    if (hadOwn) player.isCollidedWithCharacters = ownCollide
    else delete player.isCollidedWithCharacters
  }
}

function delta(map: any, axis: 'X' | 'Y', to: number, from: number) {
  const fn = map[`delta${axis}`]
  return typeof fn === 'function' ? fn.call(map, to, from) : to - from
}

function directionOf(dx: number, dy: number): Direction {
  return dx > 0 ? 6 : dx < 0 ? 4 : dy > 0 ? 2 : 8
}

/** 目标在正前方，或隔着柜台在前方第二格时，转向目标，引擎随后按 triggerTouchAction 启动事件 */
function faceGoal(player: any, map: any, goalX: number, goalY: number): number {
  const dx = delta(map, 'X', goalX, player.x)
  const dy = delta(map, 'Y', goalY, player.y)
  const dist = Math.abs(dx) + Math.abs(dy)
  if (dist === 1) return directionOf(dx, dy)
  if (dist !== 2 || (dx !== 0 && dy !== 0) || typeof map.isCounter !== 'function') return 0
  const d = directionOf(dx, dy)
  const midX = stepX(player.x, d, map.width(), bool(map, 'isLoopHorizontally'))
  const midY = stepY(player.y, d, map.height(), bool(map, 'isLoopVertically'))
  return map.isCounter(midX, midY) ? d : 0
}

function plan(player: any, map: any, goalX: number, goalY: number): Route | null {
  const result = withGrid(player, map, (grid) => findPath(grid, { x: player.x, y: player.y }, { x: goalX, y: goalY }, { maxExpand: MAX_EXPAND, budgetMs: BUDGET_MS }))
  if (!result) return null
  return { mapId: Number(map.mapId()), goalX, goalY, steps: result.steps, cursor: 0, reached: result.reached, atX: player.x, atY: player.y }
}

/**
 * 走不到的目标：停在最近格后朝目标所在的主方向转身，同引擎原版停下时的朝向。
 * 只在那一边走不通时返回方向（引擎据此只转身不迈步），走得通说明那格是要绕开的触发格，返回 0
 */
function turnToward(player: any, map: any, goalX: number, goalY: number): number {
  const dx = delta(map, 'X', goalX, player.x)
  const dy = delta(map, 'Y', goalY, player.y)
  const d = Math.abs(dx) >= Math.abs(dy) ? directionOf(dx, 0) : directionOf(0, dy)
  return player.canPass(player.x, player.y, d) ? 0 : d
}

/** 返回下一步方向；路线走完返回朝向或 0 并丢弃路线；下一步走不通返回 null */
function followRoute(player: any, map: any, r: Route): number | null {
  if (r.cursor >= r.steps.length) {
    route = null
    if (player.x === r.goalX && player.y === r.goalY) return 0
    return faceGoal(player, map, r.goalX, r.goalY) || (r.reached ? 0 : turnToward(player, map, r.goalX, r.goalY))
  }
  const d = r.steps[r.cursor]
  const nx = stepX(player.x, d, map.width(), bool(map, 'isLoopHorizontally'))
  const ny = stepY(player.y, d, map.height(), bool(map, 'isLoopVertically'))
  if (!player.canPass(player.x, player.y, d)) return null
  if ((nx !== r.goalX || ny !== r.goalY) && hasTouchTrigger(map, nx, ny)) return null
  r.cursor++
  r.atX = nx
  r.atY = ny
  return d
}

function smartDirection(player: any, goalX: number, goalY: number): number | null {
  const map = gameMap()
  if (!map || typeof map.width !== 'function' || typeof player.canPass !== 'function') return null
  if (!Number.isInteger(player.x) || !Number.isInteger(player.y)) return null
  if (bool(player, 'isThrough') || bool(player, 'isDebugThrough') || bool(player, 'isInVehicle')) return null
  const mapId = Number(map.mapId?.())
  const r = route
  if (r && r.reached && r.mapId === mapId && r.goalX === goalX && r.goalY === goalY && r.atX === player.x && r.atY === player.y) {
    const d = followRoute(player, map, r)
    if (d !== null) return d
  }
  route = plan(player, map, goalX, goalY)
  if (!route) return null
  // 新路线首步就走不通：规划时的占位判断与真实碰撞不一致（如插件把事件碰撞改成多格），交还原函数
  const d = followRoute(player, map, route)
  if (d === null) route = null
  return d
}

const engineChecked = new WeakMap<FindDirection, boolean>()

/** 引擎原版的 findDirectionTo 按 searchLimit 截断；源码里没有它，说明已被寻路 / 像素移动插件替换，交给那个插件 */
function isEngineFinder(fn: FindDirection | undefined, log: Log | undefined): boolean {
  if (typeof fn !== 'function') return false
  let ok = engineChecked.get(fn)
  if (ok === undefined) {
    ok = /searchLimit/.test(Function.prototype.toString.call(fn))
    engineChecked.set(fn, ok)
    if (!ok) log?.warn('检测到其他插件已接管点击寻路（findDirectionTo），增强寻路不生效，沿用该插件')
  }
  return ok
}

/**
 * 只装一次钩子；再次调用（插件热替换）只更新开关与日志，不叠加包装。
 * enabled 为 false、穿墙、载具、坐标非整数、地图超限或寻路已被其他插件接管时走原函数
 */
export function installSmartPath(enabled: () => boolean, log?: Log) {
  const g = globalThis as Record<string, any>
  const proto = g.Game_Player?.prototype
  if (!proto) return
  const installed = g[INSTALL_KEY] as Hook | true | undefined
  if (installed && installed !== true) {
    installed.enabled = enabled
    installed.log = log
    return
  }
  if (installed) return
  const hook: Hook = { enabled, log }
  g[INSTALL_KEY] = hook
  const own: FindDirection | null = Object.prototype.hasOwnProperty.call(proto, 'findDirectionTo') ? proto.findDirectionTo : null
  const original = (): FindDirection | undefined => own ?? Object.getPrototypeOf(proto)?.findDirectionTo
  const fallback = function (this: any, x: number, y: number): number {
    const fn = original()
    return typeof fn === 'function' ? fn.call(this, x, y) : 0
  }
  proto.findDirectionTo = function (this: any, x: number, y: number) {
    if (!hook.enabled() || !isEngineFinder(original(), hook.log)) return fallback.call(this, x, y)
    let d: number | null = null
    try {
      d = smartDirection(this, Math.floor(x), Math.floor(y))
    } catch {
      route = null
    }
    return d === null ? fallback.call(this, x, y) : d
  }
}
