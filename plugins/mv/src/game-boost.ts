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
  _driving?: boolean
  _memberIndex?: number
  canMove?: () => boolean
  isInVehicle?: () => boolean
  isDashing?: () => boolean
  realMoveSpeed?: () => number
  vehicle?: () => { _driving?: boolean; _moveSpeedRate?: number } | null
  followers?: () => { forEach?: (cb: (f: SpeedActor | null) => void) => void; _data?: Array<SpeedActor | null> }
  chaseCharacter?: unknown
}

type CharacterBaseLike = {
  prototype: {
    distancePerFrame?: (this: SpeedActor) => number
  }
}

type PlayerLike = {
  prototype: {
    moveSpeedRate?: (this: SpeedActor) => number
    distancePerFrame?: (this: SpeedActor) => number
  }
}

function eachFollower(player: SpeedActor, fn: (follower: SpeedActor) => void) {
  const group = player.followers?.()
  if (!group) return
  const visit = (follower: SpeedActor | null) => {
    if (follower) fn(follower)
  }
  if (typeof group.forEach === 'function') {
    group.forEach(visit)
    return
  }
  if (Array.isArray(group._data)) group._data.forEach(visit)
}

/** 非标准游戏可能没声明这些引擎全局，裸读会 ReferenceError */
const engine = globalThis as {
  $gamePlayer?: SpeedActor | null
  ConfigManager?: { alwaysDash: boolean }
  Game_Player?: PlayerLike & (new (...args: unknown[]) => unknown)
  Game_CharacterBase?: CharacterBaseLike & (new (...args: unknown[]) => unknown)
  Game_Follower?: new (...args: unknown[]) => unknown
  Game_Vehicle?: new (...args: unknown[]) => unknown
}
function gamePlayer(): SpeedActor | null {
  return engine.$gamePlayer ?? null
}
function alwaysDash(): boolean {
  return !!engine.ConfigManager?.alwaysDash
}

type SceneManagerLike = {
  updateScene: (this: SceneManagerLike) => void
  updateInputData?: () => void
  _exiting?: boolean
  _nextScene?: unknown
}
type HighHzSceneManager = SceneManagerLike & {
  updateMain?: (this: HighHzSceneManager) => void
  _accumulator?: number
  _deltaTime?: number
  _currentTime?: number
  _getTimeInMsWithoutMobileSafari?: () => number
  tickStart?: () => void
  tickEnd?: () => void
  renderScene?: () => void
  requestUpdate?: () => void
  changeScene?: () => void
}
const sceneEngine = globalThis as { SceneManager?: SceneManagerLike }

const GAME_SPEED_MIN = 1
const GAME_SPEED_MAX = 5

let configuredWalkRate = DEFAULT_RATE
let configuredRunRate = DEFAULT_RATE
let isCalculatingDistance = false

let _origPlayerMoveSpeedRate: ((this: SpeedActor) => number) | null = null
let _origCharacterDistancePerFrame: ((this: SpeedActor) => number) | null = null
let _origPlayerDistancePerFrame: ((this: SpeedActor) => number) | null = null
let _origUpdateScene: ((this: SceneManagerLike) => void) | null = null
let _origUpdateMain: ((this: HighHzSceneManager) => void) | null = null
let gameSpeed = 1
let speedCarry = 0
const hot = globalThis as typeof globalThis & { __chayaBoostDispose?: () => void }
hot.__chayaBoostDispose?.()
hot.__chayaBoostDispose = () => {
  const g = globalThis as {
    Game_Player?: PlayerLike
    Game_CharacterBase?: CharacterBaseLike
  }
  if (typeof g.Game_Player !== 'undefined') {
    if (g.Game_Player.prototype.moveSpeedRate === chayaPlayerMoveSpeedRate) {
      if (_origPlayerMoveSpeedRate) g.Game_Player.prototype.moveSpeedRate = _origPlayerMoveSpeedRate
      else Reflect.deleteProperty(g.Game_Player.prototype, 'moveSpeedRate')
    }
    if (g.Game_Player.prototype.distancePerFrame === chayaCharacterDistancePerFrame) {
      if (_origPlayerDistancePerFrame) g.Game_Player.prototype.distancePerFrame = _origPlayerDistancePerFrame
      else Reflect.deleteProperty(g.Game_Player.prototype, 'distancePerFrame')
    }
  }
  if (typeof g.Game_CharacterBase !== 'undefined') {
    if (g.Game_CharacterBase.prototype.distancePerFrame === chayaCharacterDistancePerFrame) {
      if (_origCharacterDistancePerFrame) g.Game_CharacterBase.prototype.distancePerFrame = _origCharacterDistancePerFrame
      else Reflect.deleteProperty(g.Game_CharacterBase.prototype, 'distancePerFrame')
    }
  }
  const sm = sceneEngine.SceneManager
  if (sm && _origUpdateScene && sm.updateScene === chayaUpdateScene) sm.updateScene = _origUpdateScene
  const hsm = sm as HighHzSceneManager | undefined
  if (hsm && _origUpdateMain && hsm.updateMain === chayaUpdateMain) hsm.updateMain = _origUpdateMain
}

function chayaUpdateMain(this: HighHzSceneManager): void {
  if (typeof this._accumulator !== 'number' || typeof this._deltaTime !== 'number') {
    _origUpdateMain?.call(this)
    return
  }
  let ranFrame = false
  const Utils = (globalThis as any).Utils
  if (Utils && typeof Utils.isMobileSafari === 'function' && Utils.isMobileSafari()) {
    this.changeScene?.()
    this.updateScene()
    ranFrame = true
  } else {
    const newTime =
      typeof this._getTimeInMsWithoutMobileSafari === 'function'
        ? this._getTimeInMsWithoutMobileSafari()
        : performance.now()
    let fTime = (newTime - (this._currentTime ?? newTime)) / 1000
    if (fTime > 0.25) fTime = 0.25
    this._currentTime = newTime
    this._accumulator += fTime
    while (this._accumulator >= this._deltaTime) {
      if (!ranFrame) this.tickStart?.()
      ranFrame = true
      this.updateInputData?.()
      this.changeScene?.()
      this.updateScene()
      this._accumulator -= this._deltaTime
    }
    if (ranFrame) this.tickEnd?.()
  }
  if (ranFrame) {
    this.renderScene?.()
  }
  this.requestUpdate?.()
}

function ensureHighHzFix(): boolean {
  const sm = sceneEngine.SceneManager as HighHzSceneManager | undefined
  if (!sm || typeof sm.updateMain !== 'function') return false
  if (sm.updateMain === chayaUpdateMain) return true
  _origUpdateMain = sm.updateMain
  sm.updateMain = chayaUpdateMain
  return true
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
    log.warn('Invalid game speed', rate)
    return false
  }
  gameSpeed = Math.min(GAME_SPEED_MAX, Math.max(GAME_SPEED_MIN, r))
  speedCarry = 0
  if (gameSpeed > 1 && !ensureSceneHook()) {
    log.warn('SceneManager unavailable; game speed was not applied')
    return false
  }
  return true
}

function isPlayerCharacter(actor: SpeedActor | null | undefined): boolean {
  if (!actor) return false
  const p = gamePlayer()
  if (actor === p) return true
  const g = globalThis as { Game_Player?: unknown }
  return typeof g.Game_Player === 'function' && actor instanceof (g.Game_Player as new (...args: unknown[]) => unknown)
}

function isFollowerCharacter(actor: SpeedActor | null | undefined): boolean {
  if (!actor) return false
  const g = globalThis as { Game_Follower?: unknown }
  if (typeof g.Game_Follower === 'function' && actor instanceof (g.Game_Follower as new (...args: unknown[]) => unknown)) return true
  return typeof actor._memberIndex === 'number' && typeof actor.chaseCharacter === 'function'
}

function isDrivingVehicle(actor: SpeedActor | null | undefined): boolean {
  if (!actor) return false
  const g = globalThis as { Game_Vehicle?: unknown }
  if (typeof g.Game_Vehicle === 'function' && actor instanceof (g.Game_Vehicle as new (...args: unknown[]) => unknown)) {
    return Boolean(actor._driving)
  }
  return Boolean(actor._driving)
}

function getCharacterRate(actor: SpeedActor): number {
  const player = gamePlayer()

  if (isPlayerCharacter(actor)) {
    if (typeof actor.vehicle === 'function') {
      const v = actor.vehicle()
      if (v && v._driving) {
        return Number(v._moveSpeedRate ?? actor._moveSpeedRate ?? configuredWalkRate) || 1
      }
    }
    const dashing = typeof actor.isDashing === 'function' && actor.isDashing()
    if (dashing) {
      return Number(actor._runSpeedRate ?? configuredRunRate) || 1
    }
    return Number(actor._walkSpeedRate ?? actor._moveSpeedRate ?? configuredWalkRate) || 1
  }

  if (isFollowerCharacter(actor)) {
    const playerDashing = Boolean(player && typeof player.isDashing === 'function' && player.isDashing())
    if (playerDashing) {
      return Number(actor._runSpeedRate ?? player?._runSpeedRate ?? actor._moveSpeedRate ?? player?._moveSpeedRate ?? configuredRunRate) || 1
    }
    return Number(actor._walkSpeedRate ?? player?._walkSpeedRate ?? actor._moveSpeedRate ?? player?._moveSpeedRate ?? configuredWalkRate) || 1
  }

  if (isDrivingVehicle(actor)) {
    return Number(actor._moveSpeedRate ?? player?._moveSpeedRate ?? player?._walkSpeedRate ?? configuredWalkRate) || 1
  }

  return 1
}

function chayaPlayerMoveSpeedRate(this: SpeedActor): number {
  if (isCalculatingDistance) return 1
  return getCharacterRate(this)
}

function chayaCharacterDistancePerFrame(this: SpeedActor): number {
  if (isCalculatingDistance) {
    return Math.pow(2, typeof this.realMoveSpeed === 'function' ? this.realMoveSpeed() : 4) / 256
  }
  const orig = _origCharacterDistancePerFrame ?? _origPlayerDistancePerFrame
  let base: number
  isCalculatingDistance = true
  try {
    base = orig ? orig.call(this) : Math.pow(2, typeof this.realMoveSpeed === 'function' ? this.realMoveSpeed() : 4) / 256
  } finally {
    isCalculatingDistance = false
  }
  if (!Number.isFinite(base) || base <= 0) {
    base = Math.pow(2, typeof this.realMoveSpeed === 'function' ? this.realMoveSpeed() : 4) / 256
  }
  const rate = getCharacterRate(this)
  return rate > 0 ? base * rate : base
}

/** Hook both moveSpeedRate (for fixtures / custom plugins) and distancePerFrame (for native MV/MZ engines) */
function ensureWalkRunHook(): void {
  const g = globalThis as {
    Game_Player?: PlayerLike
    Game_CharacterBase?: CharacterBaseLike
  }

  if (typeof g.Game_Player !== 'undefined') {
    if (g.Game_Player.prototype.moveSpeedRate !== chayaPlayerMoveSpeedRate) {
      _origPlayerMoveSpeedRate = g.Game_Player.prototype.moveSpeedRate ?? null
      g.Game_Player.prototype.moveSpeedRate = chayaPlayerMoveSpeedRate
    }
  }

  if (typeof g.Game_CharacterBase !== 'undefined') {
    if (g.Game_CharacterBase.prototype.distancePerFrame !== chayaCharacterDistancePerFrame) {
      _origCharacterDistancePerFrame = g.Game_CharacterBase.prototype.distancePerFrame ?? null
      g.Game_CharacterBase.prototype.distancePerFrame = chayaCharacterDistancePerFrame
    }
  } else if (typeof g.Game_Player !== 'undefined') {
    if (g.Game_Player.prototype.distancePerFrame !== chayaCharacterDistancePerFrame) {
      _origPlayerDistancePerFrame = g.Game_Player.prototype.distancePerFrame ?? null
      g.Game_Player.prototype.distancePerFrame = chayaCharacterDistancePerFrame
    }
  }
}

function clampRate(rate: number): number | null {
  const r = Number(rate)
  if (!(r > 0) || !isFinite(r)) return null
  return Math.min(12, Math.max(0.25, r))
}

function applyRates(walk: number, run: number): boolean {
  const w = clampRate(walk)
  const r = clampRate(run)
  if (w == null || r == null) {
    log.warn('Invalid rate', { walk, run })
    return false
  }
  configuredWalkRate = w
  configuredRunRate = r
  ensureWalkRunHook()

  const player = gamePlayer()
  if (player) {
    player._walkSpeedRate = w
    player._runSpeedRate = r
    player._moveSpeedRate = w
    eachFollower(player, (follower) => {
      follower._walkSpeedRate = w
      follower._runSpeedRate = r
      follower._moveSpeedRate = w
    })
  }
  return true
}

function applyMoveRate(rate: number): boolean {
  const r = clampRate(rate)
  if (r == null) {
    log.warn('Invalid rate', rate)
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
    walk: p?._walkSpeedRate ?? configuredWalkRate,
    run: p?._runSpeedRate ?? configuredRunRate,
    moveRate: p?._moveSpeedRate ?? configuredWalkRate,
    gameSpeed,
    alwaysDash: alwaysDash(),
  }
}

const ChayaBoost = {
  on(rate?: number) {
    const r = rate == null ? BOOST_RATE : rate
    applyMoveRate(r)
    setAlwaysDash(true)
    log.ok(`Enabled: movement x${r}, always dash enabled`)
    return this.status()
  },
  off() {
    applyRates(DEFAULT_RATE, DEFAULT_RATE)
    setAlwaysDash(false)
    log.ok(`Disabled: walk/run x${DEFAULT_RATE}, dash disabled`)
    return this.status()
  },
  rate(n: number) {
    applyMoveRate(n)
    log.ok(`Movement rate -> ${n}`)
    return this.status()
  },
  /** Walk multiplier (no Shift / not dashing) */
  walkRate(n?: number) {
    if (n == null) return currentRates().walk
    const cur = currentRates()
    applyRates(n, cur.run)
    log.ok(`Walk rate -> ${n}`)
    return this.status()
  },
  /** Run multiplier (while dashing) */
  runRate(n?: number) {
    if (n == null) return currentRates().run
    const cur = currentRates()
    applyRates(cur.walk, n)
    log.ok(`Run rate -> ${n}`)
    return this.status()
  },
  rates(opts?: { walk?: number; run?: number }) {
    if (!opts) return currentRates()
    const cur = currentRates()
    applyRates(opts.walk != null ? opts.walk : cur.walk, opts.run != null ? opts.run : cur.run)
    log.ok('Rates', currentRates())
    return this.status()
  },
  /** Whole-game update speed (1–5); 1 = normal */
  speed(n?: number) {
    if (n == null) return gameSpeed
    applyGameSpeed(n)
    log.ok(`Game speed -> ${gameSpeed}`)
    return this.status()
  },
  dash(on?: boolean) {
    setAlwaysDash(on !== false)
    log.ok(`Always dash -> ${alwaysDash()}`)
    return this.status()
  },
  status() {
    return currentRates()
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

ensureWalkRunHook()
ensureHighHzFix()

log.ok(`Registered: ${PLUGIN_BOOST_NAME}.on()/off()/walkRate()/runRate()/rates()/speed()`)
