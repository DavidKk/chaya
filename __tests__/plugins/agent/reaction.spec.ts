import { armReaction, reactionOutcome, reactionResult, startReactionMonitor, stopReaction } from '@/plugins/src/agent/reaction'

describe('in-game reaction monitor', () => {
  const g = globalThis as typeof globalThis & { window?: Window; requestAnimationFrame?: typeof requestAnimationFrame; cancelAnimationFrame?: typeof cancelAnimationFrame }
  const originalWindow = g.window
  const originalRequestFrame = g.requestAnimationFrame
  const originalCancelFrame = g.cancelAnimationFrame
  let now = 1_000
  let queued: FrameRequestCallback[]
  let scope: { battleInstanceId: string | null; mapId: number | null; manualInputEpoch: number }
  let send: jest.Mock
  let dispose: () => void

  beforeEach(() => {
    queued = []
    scope = { battleInstanceId: 'battle-1', mapId: 1, manualInputEpoch: 0 }
    send = jest.fn(async () => {})
    g.window = { ChayaAgentQteSource: () => null } as unknown as Window
    g.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      queued.push(callback)
      return queued.length
    })
    g.cancelAnimationFrame = jest.fn()
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    dispose = startReactionMonitor(() => scope, send)
  })

  afterEach(() => {
    stopReaction()
    dispose()
    jest.restoreAllMocks()
    if (originalWindow === undefined) delete g.window
    else g.window = originalWindow
    if (originalRequestFrame === undefined) delete g.requestAnimationFrame
    else g.requestAnimationFrame = originalRequestFrame
    if (originalCancelFrame === undefined) delete g.cancelAnimationFrame
    else g.cancelAnimationFrame = originalCancelFrame
  })

  function frame() {
    queued.shift()?.(now)
  }

  it('reacts once within one frame and ignores expired or repeated cues', () => {
    armReaction({ battleInstanceId: 'battle-1', mapId: 1, allowedKeys: ['left'], ttlMs: 5_000 })
    ;(g.window as Window & { ChayaAgentQteSource: () => unknown }).ChayaAgentQteSource = () => ({ id: 'dodge-1', key: 'left', startedAt: 1_000, expiresAt: 1_700 })
    now = 1_016
    frame()
    frame()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('left')
    expect(reactionResult()).toEqual({ id: 'dodge-1', key: 'left', latencyMs: 16 })
    ;(g.window as Window & { ChayaAgentQteSource: { lastResult?: { id: string; result: string } } }).ChayaAgentQteSource.lastResult = { id: 'dodge-1', result: 'success' }
    expect(reactionOutcome()).toEqual({ id: 'dodge-1', result: 'success' })
    ;(g.window as Window & { ChayaAgentQteSource: () => unknown }).ChayaAgentQteSource = () => ({ id: 'dodge-2', key: 'left', expiresAt: 1_010 })
    frame()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stops when the player takes over or the battle changes', () => {
    armReaction({ battleInstanceId: 'battle-1', mapId: 1, allowedKeys: ['ok'], ttlMs: 5_000 })
    ;(g.window as Window & { ChayaAgentQteSource: () => unknown }).ChayaAgentQteSource = () => ({ id: 'prompt', key: 'ok', expiresAt: 1_700 })
    scope.manualInputEpoch = 1
    frame()
    expect(send).not.toHaveBeenCalled()
    armReaction({ battleInstanceId: 'battle-1', mapId: 1, allowedKeys: ['ok'], ttlMs: 5_000 })
    scope.battleInstanceId = 'battle-2'
    frame()
    expect(send).not.toHaveBeenCalled()
  })
})
