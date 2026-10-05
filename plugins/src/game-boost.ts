/**
 * ChayaBoost — move speed multipliers (walk / run separate) + whole-game speed + always dash
 */

import { PLUGIN_BOOST_NAME } from '@/constants/brand'
import { BOOST_DEFAULT_RATE as BOOST_RATE } from '@/lib/runtime/plugin-tool-catalog'

import { createLogger } from './helpers'
import { declarePluginTools, toolNum } from './helpers/plugin-tools'

const log = createLogger(PLUGIN_BOOST_NAME)

const DEFAULT_RATE = 1

type SpeedActor = {
  _moveSpeedRate?: number
  _walkSpeedRate?: number
  _runSpeedRate?: number
  _dashing?: boolean
  canMove?: () => boolean
  isInVehicle?: () => boolean
  isDashing?: () => boolean
  vehicle?: () => { _driving?: boolean; _moveSpeedRate?: number } | null
  followers?: () => Array<SpeedActor | null>
}

/** 非标准游戏可能没声明这些引擎全局，裸读会 ReferenceError */
const engine = globalThis as { $gamePlayer?: SpeedActor | null; ConfigManager?: { alwaysDash: boolean } }
function gamePlayer(): SpeedActor | null {
  return engine.$gamePlayer ?? null
}
function alwaysDash(): boolean {
  return !!engine.ConfigManager?.alwaysDash
}
declare const Game_Player: {
  prototype: {
    moveSpeedRate: (this: SpeedActor) => number
  }
}

type SceneManagerLike = {
  updateScene: (this: SceneManagerLike) => void
  updateInputData?: () => void
  _exiting?: boolean
  _nextScene?: unknown
}
const sceneEngine = globalThis as { SceneManager?: SceneManagerLike }

const GAME_SPEED_MIN = 1
const GAME_SPEED_MAX = 5

let _origPlayerMoveSpeedRate: ((this: SpeedActor) => number) | null = null
let _origUpdateScene: ((this: SceneManagerLike) => void) | null = null
let gameSpeed = 1
let speedCarry = 0
const hot = globalThis as typeof globalThis & { __chayaBoostDispose?: () => void }
hot.__chayaBoostDispose?.()
hot.__chayaBoostDispose = () => {
  if (typeof Game_Player !== 'undefined' && Game_Player.prototype.moveSpeedRate === chayaPlayerMoveSpeedRate) {
    if (_origPlayerMoveSpeedRate) Game_Player.prototype.moveSpeedRate = _origPlayerMoveSpeedRate
    else Reflect.deleteProperty(Game_Player.prototype, 'moveSpeedRate')
  }
  const sm = sceneEngine.SceneManager
  if (sm && _origUpdateScene && sm.updateScene === chayaUpdateScene) sm.updateScene = _origUpdateScene
}

/** Extra scene updates per frame; input is refreshed between them so triggers fire once */
function chayaUpdateScene(this: SceneManagerLike): void {
  const orig = _origUpdateScene
  if (!orig) return
  orig.call(this)
  if (gameSpeed <= 1) return
  speedCarry += gameSpeed - 1
  while (speedCarry >= 1) {
    speedCarry -= 1
    if (this._exiting || this._nextScene) {
      speedCarry = 0
      break
    }
    this.updateInputData?.()
    orig.call(this)
  }
}

function ensureSceneHook(): boolean {
  const sm = sceneEngine.SceneManager
  if (!sm || typeof sm.updateScene !== 'function') return false
  if (sm.updateScene !== chayaUpdateScene) {
    _origUpdateScene = sm.updateScene
    sm.updateScene = chayaUpdateScene
  }
  return true
}

function applyGameSpeed(rate: number): boolean {
  const r = Number(rate)
  if (!isFinite(r)) {
    log.warn('运行倍速无效', rate)
    return false
  }
  gameSpeed = Math.min(GAME_SPEED_MAX, Math.max(GAME_SPEED_MIN, r))
  speedCarry = 0
  if (gameSpeed > 1 && !ensureSceneHook()) {
    log.warn('SceneManager 不存在，运行倍速未生效')
    return false
  }
  return true
}

function chayaPlayerMoveSpeedRate(this: SpeedActor): number {
  if (typeof this.vehicle === 'function') {
    const v = this.vehicle()
    if (v && v._driving) {
      return Number(v._moveSpeedRate) || 1
    }
  }
  const dashing = typeof this.isDashing === 'function' && this.isDashing()
  if (dashing) {
    if (this._runSpeedRate != null) return Number(this._runSpeedRate) || 1
  } else if (this._walkSpeedRate != null) {
    return Number(this._walkSpeedRate) || 1
  }
  if (_origPlayerMoveSpeedRate) {
    return Number(_origPlayerMoveSpeedRate.call(this)) || 1
  }
  return Number(this._moveSpeedRate) || 1
}

/** MT_ChangeMoveSpeed may load later and overwrite the prototype; re-hook before each set */
function ensureWalkRunHook(): void {
  if (typeof Game_Player === 'undefined') return
  if (Game_Player.prototype.moveSpeedRate !== chayaPlayerMoveSpeedRate) {
    _origPlayerMoveSpeedRate = Game_Player.prototype.moveSpeedRate
    Game_Player.prototype.moveSpeedRate = chayaPlayerMoveSpeedRate
  }
}

function clampRate(rate: number): number | null {
  const r = Number(rate)
  if (!(r > 0) || !isFinite(r)) return null
  return Math.min(12, Math.max(0.25, r))
}

function applyRates(walk: number, run: number): boolean {
  const player = gamePlayer()
  if (!player) {
    log.warn('还没进地图，$gamePlayer 不存在')
    return false
  }
  const w = clampRate(walk)
  const r = clampRate(run)
  if (w == null || r == null) {
    log.warn('倍率无效', { walk, run })
    return false
  }
  ensureWalkRunHook()
  player._walkSpeedRate = w
  player._runSpeedRate = r
  player._moveSpeedRate = w
  if (player.followers) {
    player.followers().forEach((f) => {
      if (!f) return
      f._walkSpeedRate = w
      f._runSpeedRate = r
      f._moveSpeedRate = w
    })
  }
  return true
}

function applyMoveRate(rate: number): boolean {
  const r = clampRate(rate)
  if (r == null) {
    log.warn('倍率无效', rate)
    return false
  }
  return applyRates(r, r)
}

function setAlwaysDash(on: boolean): boolean {
  if (engine.ConfigManager) engine.ConfigManager.alwaysDash = !!on
  const player = gamePlayer()
  if (player) {
    player._dashing = !!on && !!player.canMove?.() && !player.isInVehicle?.()
  }
  return alwaysDash()
}

function currentRates() {
  const p = gamePlayer()
  return {
    walk: p?._walkSpeedRate ?? p?._moveSpeedRate ?? DEFAULT_RATE,
    run: p?._runSpeedRate ?? p?._moveSpeedRate ?? DEFAULT_RATE,
    moveRate: p?._moveSpeedRate ?? null,
    gameSpeed,
    alwaysDash: alwaysDash(),
  }
}

const ChayaBoost = {
  on(rate?: number) {
    const r = rate == null ? BOOST_RATE : rate
    applyMoveRate(r)
    setAlwaysDash(true)
    log.ok(`开启：移动×${r}，一直疾跑`)
    return this.status()
  },
  off() {
    applyRates(DEFAULT_RATE, DEFAULT_RATE)
    setAlwaysDash(false)
    log.ok(`关闭：行走/跑步×${DEFAULT_RATE}，疾跑关闭`)
    return this.status()
  },
  rate(n: number) {
    applyMoveRate(n)
    log.ok(`移动倍率 → ${n}`)
    return this.status()
  },
  /** Walk multiplier (no Shift / not dashing) */
  walkRate(n?: number) {
    if (n == null) return currentRates().walk
    const cur = currentRates()
    applyRates(n, cur.run)
    log.ok(`行走倍率 → ${n}`)
    return this.status()
  },
  /** Run multiplier (while dashing) */
  runRate(n?: number) {
    if (n == null) return currentRates().run
    const cur = currentRates()
    applyRates(cur.walk, n)
    log.ok(`跑步倍率 → ${n}`)
    return this.status()
  },
  rates(opts?: { walk?: number; run?: number }) {
    if (!opts) return currentRates()
    const cur = currentRates()
    applyRates(opts.walk != null ? opts.walk : cur.walk, opts.run != null ? opts.run : cur.run)
    log.ok('倍率', currentRates())
    return this.status()
  },
  /** Whole-game update speed (1–5); 1 = normal */
  speed(n?: number) {
    if (n == null) return gameSpeed
    applyGameSpeed(n)
    log.ok(`运行倍速 → ${gameSpeed}`)
    return this.status()
  },
  dash(on?: boolean) {
    setAlwaysDash(on !== false)
    log.ok(`一直疾跑 → ${alwaysDash()}`)
    return this.status()
  },
  status() {
    const info = currentRates()
    log.info('status', info)
    return info
  },
}

const w = window as Window & {
  ChayaBoost: typeof ChayaBoost
  boostOn: (rate?: number) => ReturnType<typeof ChayaBoost.on>
  boostOff: () => ReturnType<typeof ChayaBoost.off>
}
w.ChayaBoost = ChayaBoost
w.boostOn = (rate?: number) => ChayaBoost.on(rate)
w.boostOff = () => ChayaBoost.off()

declarePluginTools('ChayaBoost', {
  on: (input) => ChayaBoost.on(input.rate === undefined ? undefined : toolNum(input, 'rate')),
  off: () => ChayaBoost.off(),
  status: () => ChayaBoost.status(),
})

log.ok(`已注册：${PLUGIN_BOOST_NAME}.on()/off()/walkRate()/runRate()/rates()/speed()`)
