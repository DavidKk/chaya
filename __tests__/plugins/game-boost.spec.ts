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
    await import('@/plugins/src/game-boost')
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

  it('dispose restores the original updateScene', () => {
    boost.speed(2)
    expect(sm.updateScene).not.toBe(scene)
    ;(globalThis as { __chayaBoostDispose?: () => void }).__chayaBoostDispose?.()
    expect(sm.updateScene).toBe(scene)
  })
})
