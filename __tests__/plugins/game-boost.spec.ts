/**
 * @jest-environment jsdom
 */
type SceneManagerStub = {
  updateScene: () => void
  updateInputData: jest.Mock
  _exiting?: boolean
  _nextScene?: unknown
}

type Boost = { speed: (n?: number) => unknown; status: () => { gameSpeed: number } }

describe('ChayaBoost game speed', () => {
  let scene: jest.Mock
  let sm: SceneManagerStub
  let boost: Boost

  beforeEach(async () => {
    jest.resetModules()
    scene = jest.fn()
    sm = { updateScene: scene, updateInputData: jest.fn() }
    ;(globalThis as { SceneManager?: SceneManagerStub }).SceneManager = sm
    await import('@/plugins/mv/src/game-boost')
    boost = (window as Window & { ChayaBoost?: Boost }).ChayaBoost!
  })

  afterEach(() => {
    ;(globalThis as { __chayaBoostDispose?: () => void }).__chayaBoostDispose?.()
    delete (globalThis as { SceneManager?: unknown }).SceneManager
  })

  it('leaves SceneManager untouched at 1×', () => {
    boost.speed(1)
    expect(sm.updateScene).toBe(scene)
    expect(boost.status().gameSpeed).toBe(1)
  })

  it('runs extra scene updates with fresh input in between', () => {
    boost.speed(3)
    expect(boost.status().gameSpeed).toBe(3)
    sm.updateScene()
    expect(scene).toHaveBeenCalledTimes(3)
    expect(sm.updateInputData).toHaveBeenCalledTimes(2)
  })

  it('carries fractional speed across frames and clamps to 1–5', () => {
    boost.speed(1.5)
    sm.updateScene()
    sm.updateScene()
    expect(scene).toHaveBeenCalledTimes(3)

    boost.speed(99)
    expect(boost.status().gameSpeed).toBe(5)
  })

  it('stops extra updates during a scene change', () => {
    boost.speed(4)
    sm._nextScene = {}
    sm.updateScene()
    expect(scene).toHaveBeenCalledTimes(1)
  })

  it('sets follower speed when followers() has no forEach', () => {
    const follower: { _walkSpeedRate?: number } = {}
    const g = globalThis as { Game_Player?: { prototype: { moveSpeedRate: () => number } }; $gamePlayer?: { followers: () => { _data: unknown[] } } }
    g.Game_Player = { prototype: { moveSpeedRate: () => 4 } }
    g.$gamePlayer = { followers: () => ({ _data: [follower, null] }) }
    ;(boost as { walkRate: (n: number) => unknown }).walkRate(2)
    expect(follower._walkSpeedRate).toBe(2)
    delete g.Game_Player
    delete g.$gamePlayer
  })

  it('dispose restores the original updateScene', () => {
    boost.speed(2)
    expect(sm.updateScene).not.toBe(scene)
    ;(globalThis as { __chayaBoostDispose?: () => void }).__chayaBoostDispose?.()
    expect(sm.updateScene).toBe(scene)
  })
})

describe('ChayaBoost movement multipliers and distancePerFrame', () => {
  let boost: {
    on: (rate?: number) => unknown
    off: () => unknown
    rate: (rate: number) => unknown
    walkRate: (rate?: number) => unknown
    runRate: (rate?: number) => unknown
    rates: (opts?: { walk?: number; run?: number }) => unknown
    dash: (on?: boolean) => unknown
    status: () => { walk: number; run: number; moveRate: number | null; gameSpeed: number; alwaysDash: boolean }
  }

  class MockCharacterBase {
    _moveSpeed = 4
    _dashing = false
    _driving = false
    _memberIndex?: number
    realMoveSpeed() {
      return this._moveSpeed + (this.isDashing() ? 1 : 0)
    }
    isDashing() {
      return false
    }
    distancePerFrame(): number {
      return Math.pow(2, this.realMoveSpeed()) / 256
    }
  }

  class MockPlayer extends MockCharacterBase {
    override isDashing() {
      return this._dashing
    }
    canMove() {
      return true
    }
    isInVehicle() {
      return false
    }
  }

  class MockFollower extends MockCharacterBase {
    override _memberIndex = 0
    chaseCharacter() {}
  }

  class MockVehicle extends MockCharacterBase {
    override _driving = true
    isAirship() {
      return false
    }
  }

  class MockEvent extends MockCharacterBase {}

  beforeEach(async () => {
    jest.resetModules()
    const g = globalThis as Record<string, unknown>
    g.Game_CharacterBase = MockCharacterBase
    g.Game_Player = MockPlayer
    g.Game_Follower = MockFollower
    g.Game_Vehicle = MockVehicle
    g.Game_Event = MockEvent
    g.ConfigManager = { alwaysDash: false }

    const player = new MockPlayer()
    g.$gamePlayer = player

    await import('@/plugins/mv/src/game-boost')
    boost = (window as Window & { ChayaBoost?: typeof boost }).ChayaBoost!
  })

  afterEach(() => {
    ;(globalThis as { __chayaBoostDispose?: () => void }).__chayaBoostDispose?.()
    const g = globalThis as Record<string, unknown>
    delete g.Game_CharacterBase
    delete g.Game_Player
    delete g.Game_Follower
    delete g.Game_Vehicle
    delete g.Game_Event
    delete g.ConfigManager
    delete g.$gamePlayer
  })

  it('scales distancePerFrame for Game_Player with walkRate and runRate', () => {
    const player = (globalThis as { $gamePlayer: MockPlayer }).$gamePlayer
    const baseWalk = Math.pow(2, 4) / 256 // 0.0625
    const baseDash = Math.pow(2, 5) / 256 // 0.125

    // Default rate is 1
    expect(player.distancePerFrame()).toBeCloseTo(baseWalk)

    // Set walk 2.5x, run 4x
    boost.rates({ walk: 2.5, run: 4 })
    player._dashing = false
    expect(player.distancePerFrame()).toBeCloseTo(baseWalk * 2.5)

    player._dashing = true
    expect(player.distancePerFrame()).toBeCloseTo(baseDash * 4)

    // Turning off restores 1x
    boost.off()
    player._dashing = false
    expect(player.distancePerFrame()).toBeCloseTo(baseWalk)
  })

  it('scales distancePerFrame for Game_Follower matching player dash state', () => {
    const player = (globalThis as { $gamePlayer: MockPlayer }).$gamePlayer
    const follower = new MockFollower()
    const baseWalk = Math.pow(2, 4) / 256
    const baseDash = Math.pow(2, 5) / 256

    boost.rates({ walk: 2, run: 3.5 })

    // When player walks
    player._dashing = false
    expect(follower.distancePerFrame()).toBeCloseTo(baseWalk * 2)

    // When player dashes, follower moves at player run speed
    player._dashing = true
    follower._moveSpeed = 5
    expect(follower.distancePerFrame()).toBeCloseTo(baseDash * 3.5)
  })

  it('does not scale distancePerFrame for map events / NPCs', () => {
    const event = new MockEvent()
    const base = Math.pow(2, 4) / 256

    boost.rates({ walk: 3, run: 5 })
    expect(event.distancePerFrame()).toBeCloseTo(base)
  })

  it('scales distancePerFrame for driving vehicle', () => {
    const vehicle = new MockVehicle()
    const base = Math.pow(2, 4) / 256

    boost.rate(3)
    expect(vehicle.distancePerFrame()).toBeCloseTo(base * 3)

    // When not driving, vehicle moves at normal speed
    vehicle._driving = false
    expect(vehicle.distancePerFrame()).toBeCloseTo(base)
  })

  it('applies rates configured when $gamePlayer is temporarily absent', () => {
    const g = globalThis as Record<string, unknown>
    delete g.$gamePlayer

    boost.rates({ walk: 2.5, run: 3.5 })

    // Later, player is created on map load
    const newPlayer = new MockPlayer()
    g.$gamePlayer = newPlayer

    const baseWalk = Math.pow(2, 4) / 256
    expect(newPlayer.distancePerFrame()).toBeCloseTo(baseWalk * 2.5)
  })

  it('prevents double-multiplication when another plugin calls moveSpeedRate inside distancePerFrame', () => {
    const player = (globalThis as { $gamePlayer: MockPlayer }).$gamePlayer
    const base = Math.pow(2, 4) / 256

    // Simulate a plugin like MT_ChangeMoveSpeed that hooks distancePerFrame and calls moveSpeedRate
    const chainedOriginal = MockCharacterBase.prototype.distancePerFrame
    MockCharacterBase.prototype.distancePerFrame = function (this: MockCharacterBase) {
      const orig = chainedOriginal.call(this)
      const rate = (this as unknown as { moveSpeedRate?: () => number }).moveSpeedRate?.() ?? 1
      return orig * rate
    }

    boost.rate(3)
    player._dashing = false

    // Should multiply by 3, NOT 3 * 3 = 9
    expect(player.distancePerFrame()).toBeCloseTo(base * 3)
  })
})
