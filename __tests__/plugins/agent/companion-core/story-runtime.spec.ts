jest.mock('@/plugins/mv/src/agent/handlers', () => ({
  AGENT_MANUAL_INPUT_EVENT: 'chaya:test-manual-input',
  readAgentGameState: () => ({ nearbyEvents: [] }),
}))
jest.mock('@/plugins/mv/src/agent/runtime/companion-core/story-banter', () => ({
  CompanionBanterEngine: class {
    trigger() {}
  },
}))
jest.mock('@/plugins/mv/src/cheat/runtime/skip-battle-result', () => ({
  isBattleResultContext: () => false,
  trySkipBattleResult: jest.fn(),
  setSkipBattleResult: jest.fn(),
}))
jest.mock('@/plugins/mv/src/helpers/net/logger', () => {
  const warn = jest.fn()
  return { createLogger: () => ({ warn }) }
})

import { AGENT_MANUAL_INPUT_EVENT } from '@/plugins/mv/src/agent/handlers'
import type { CompanionComplete } from '@/plugins/mv/src/agent/runtime/companion-chat'
import { StoryExplorationPlanner } from '@/plugins/mv/src/agent/runtime/companion-core/story-exploration'
import { StoryFailureMemory } from '@/plugins/mv/src/agent/runtime/companion-core/story-failure-memory'
import { CompanionStoryRuntime } from '@/plugins/mv/src/agent/runtime/companion-core/story-runtime'
import { createAgentRuntimeIdentity } from '@/plugins/mv/src/agent/runtime/identity'
import { createLogger } from '@/plugins/mv/src/helpers/net/logger'

class Scene_Map {
  _messageWindow = {
    _choiceWindow: {
      active: true,
      select: jest.fn(),
      callOkHandler: jest.fn(),
      processOk: jest.fn(() => {
        this._messageWindow._choiceWindow.callOkHandler()
        this._messageWindow._choiceWindow.active = false
      }),
      deactivate: jest.fn(() => {
        this._messageWindow._choiceWindow.active = false
      }),
      close: jest.fn(),
    },
  }
}

describe('story choice ownership', () => {
  const engine = globalThis as any
  const keys = ['window', 'SceneManager', '$gameMap', '$gameMessage', '$gamePlayer', 'Input', '__CHAYA_STORY_FAILURE_MEMORY__']
  let previous: unknown[]
  let scene: Scene_Map
  let choices: string[]
  let complete: jest.MockedFunction<CompanionComplete>
  let resolveChoice: (value: Awaited<ReturnType<CompanionComplete>>) => void
  let rejectChoice: (reason: unknown) => void
  let abort: AbortController
  let runtime: CompanionStoryRuntime
  let running: Promise<void>

  beforeEach(() => {
    jest.useFakeTimers()
    previous = keys.map((key) => engine[key])
    delete engine.__CHAYA_STORY_FAILURE_MEMORY__
    createAgentRuntimeIdentity('another-game')
    engine.window = new EventTarget()
    scene = new Scene_Map()
    choices = ['Left', 'Right']
    engine.SceneManager = { _scene: scene }
    engine.$gameMap = { mapId: () => 99 }
    engine.$gameMessage = { isChoice: () => true, choices: () => choices }
    engine.$gamePlayer = { canMove: () => false }
    engine.Input = { _currentState: {} }
    const response = new Promise<Awaited<ReturnType<CompanionComplete>>>((resolve, reject) => {
      resolveChoice = resolve
      rejectChoice = reject
    })
    complete = jest.fn<ReturnType<CompanionComplete>, Parameters<CompanionComplete>>(
      (_messages, options) =>
        new Promise((_resolve, reject) => {
          options.signal.throwIfAborted()
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
    )
    complete.mockImplementationOnce(() => response)
    abort = new AbortController()
    runtime = new CompanionStoryRuntime({ signal: abort.signal, complete, profileId: 'profile', model: 'model' })
    running = runtime.start()
    expect(complete).toHaveBeenCalledTimes(1)
  })

  afterEach(async () => {
    runtime.stop()
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(1_000)
    await running
    jest.restoreAllMocks()
    jest.clearAllTimers()
    jest.useRealTimers()
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete engine[key]
      else engine[key] = previous[index]
    })
  })

  test('applies a current choice exactly once', async () => {
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(scene._messageWindow._choiceWindow.select).toHaveBeenCalledWith(1)
    expect(scene._messageWindow._choiceWindow.callOkHandler).toHaveBeenCalledTimes(1)
  })

  test('retains the initial goal and later restrictions beyond two minutes', () => {
    const persistent = new CompanionStoryRuntime({ signal: abort.signal, goal: '先处理当前层，不要上上一层' })
    persistent.applyPlayerGuidance('先拆除陷阱')
    jest.setSystemTime(Date.now() + 180_000)
    expect(persistent.getPlayerGuidance()).toBe('先处理当前层，不要上上一层\n先拆除陷阱')
    expect(persistent.getChatContext().guidance).toContain('不要上上一层')
  })

  test('cancels an old choice when player guidance changes and never applies its late reply', async () => {
    runtime.applyPlayerGuidance('不要上楼')
    expect(complete.mock.calls[0][1].signal.aborted).toBe(true)
    expect(runtime.getPlayerGuidance()).toBe('不要上楼')
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(scene._messageWindow._choiceWindow.processOk).not.toHaveBeenCalled()
  })

  test('pauses a policy conflict without recording it as exhausted or failed gameplay', async () => {
    runtime.stop()
    resolveChoice({ role: 'assistant', content: '1' })
    await running
    choices = ['Go upstairs', 'Go downstairs']
    runtime = new CompanionStoryRuntime({ signal: abort.signal, goal: '不要离开当前地图' })
    running = runtime.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(runtime.isActive()).toBe(false)
    expect(runtime.getSummary()).toContain('路线限制冲突')
    expect(scene._messageWindow._choiceWindow.processOk).not.toHaveBeenCalled()
    expect(StoryFailureMemory.history(99)).toEqual([])
  })

  test('uses the initial goal before the first menu decision', async () => {
    runtime.stop()
    resolveChoice({ role: 'assistant', content: '1' })
    await running
    choices = ['Go upstairs', 'Stay here']
    engine.$gameMessage.choiceCancelType = () => 1
    runtime = new CompanionStoryRuntime({ signal: abort.signal, goal: '不要上上一层' })
    running = runtime.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(scene._messageWindow._choiceWindow.select).toHaveBeenCalledWith(1)
    expect(StoryFailureMemory.history(99)).toEqual([])
  })

  test('keeps player instructions after a guided action succeeds', async () => {
    engine.$gameMessage.isChoice = () => false
    engine.$gamePlayer = { canMove: () => true, x: 0, y: 0 }
    const find = jest.spyOn(StoryExplorationPlanner.prototype, 'findNextTarget').mockReturnValue({ eventId: 99, x: 0, y: 1, kind: 'npc', name: 'Guide', priority: 1, guided: true })
    jest.spyOn(StoryExplorationPlanner.prototype, 'executeTarget').mockImplementation(async () => {
      engine.$gamePlayer.canMove = () => false
      return { success: true }
    })
    runtime.applyPlayerGuidance('不要上楼，先询问这里的人')
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(100)
    expect(find).toHaveBeenCalledWith(99, { x: 0, y: 0 }, '不要上楼，先询问这里的人')
    expect(runtime.getPlayerGuidance()).toBe('不要上楼，先询问这里的人')
  })

  test('aborts navigation immediately when a new instruction arrives', async () => {
    engine.$gameMessage.isChoice = () => false
    engine.$gamePlayer = { canMove: () => true, x: 0, y: 0 }
    jest.spyOn(StoryExplorationPlanner.prototype, 'findNextTarget').mockReturnValue({ eventId: 99, x: 0, y: 1, kind: 'npc', name: 'Guide', priority: 1 })
    let movingSignal: AbortSignal | undefined
    const execute = jest.spyOn(StoryExplorationPlanner.prototype, 'executeTarget').mockImplementation(async (_target, _io, signal) => {
      movingSignal = signal
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(1)
    engine.$gamePlayer.canMove = () => false
    runtime.applyPlayerGuidance('不要上楼')
    expect(movingSignal?.aborted).toBe(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(runtime.isActive()).toBe(true)
    expect(runtime.getSummary()).toContain('正在调整探索决策')
    expect(StoryFailureMemory.history(99)).toEqual([])
  })

  test('leaves exhausted branches through the configured menu exit and continues exploring', async () => {
    runtime.stop()
    resolveChoice({ role: 'assistant', content: '1' })
    await running
    const attempts = StoryFailureMemory.choiceAttempts(99, 0, choices, { requiresLockpick: false }, JSON.stringify(['', []]))
    attempts.add(0)
    attempts.add(1)
    StoryFailureMemory.settleChoice(99, 0, false)
    engine.$gameMessage.choiceCancelType = () => 1
    running = runtime.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(scene._messageWindow._choiceWindow.select).toHaveBeenCalledWith(1)
    expect(scene._messageWindow._choiceWindow.processOk).toHaveBeenCalledTimes(1)
    expect(runtime.isActive()).toBe(true)
    expect(runtime.getSummary()).toContain('通过菜单退出')
    expect(StoryFailureMemory.blocked(99, 0)?.reason).toBe('no_effect')
  })

  test('pauses exhausted branches only when the game offers no safe menu exit', async () => {
    runtime.stop()
    resolveChoice({ role: 'assistant', content: '1' })
    await running
    const attempts = StoryFailureMemory.choiceAttempts(99, 0, choices, { requiresLockpick: false }, JSON.stringify(['', []]))
    attempts.add(0)
    attempts.add(1)
    StoryFailureMemory.settleChoice(99, 0, false)
    running = runtime.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(runtime.isActive()).toBe(false)
    expect(runtime.getSummary()).toContain('没有安全退出选项')
    expect(scene._messageWindow._choiceWindow.processOk).not.toHaveBeenCalled()
  })

  test('pauses a rejected menu confirmation without recording a failed choice', async () => {
    scene._messageWindow._choiceWindow.processOk.mockImplementation(() => undefined)
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(runtime.isActive()).toBe(false)
    expect(runtime.getSummary()).toContain('未被游戏菜单接受')
    expect(StoryFailureMemory.choiceAttempts(99, 0, choices, { requiresLockpick: false }, JSON.stringify(['', []])).size).toBe(0)
  })

  test('discards a late response when a new question reuses the same options and window', async () => {
    engine.$gameMessage.allText = () => 'Another question'
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(scene._messageWindow._choiceWindow.processOk).not.toHaveBeenCalled()
  })

  test('reports recovered runtime exceptions through the plugin logger', async () => {
    const failure = new TypeError('Map data unavailable')
    engine.$gameMessage.isChoice = () => {
      throw failure
    }
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(createLogger('story-runtime').warn).toHaveBeenCalledWith('Recovering loop from exception', failure)
  })

  test('stops repeated runtime exceptions instead of retrying forever', async () => {
    engine.$gameMessage.isChoice = () => {
      throw new TypeError('Map data unavailable')
    }
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(2_500)
    await running
    expect(runtime.isActive()).toBe(false)
    expect(runtime.getPhase()).toBe('paused')
    expect(runtime.getSummary()).toContain('同一运行异常')
  })

  test.each(['resolve', 'reject'] as const)('does not apply a late %s after stop', async (result) => {
    runtime.stop()
    if (result === 'resolve') resolveChoice({ role: 'assistant', content: '1' })
    else rejectChoice(new DOMException('Cancelled', 'AbortError'))
    await running
    expect(scene._messageWindow._choiceWindow.callOkHandler).not.toHaveBeenCalled()
    expect(complete.mock.calls[0][1].signal.aborted).toBe(true)
  })

  test('discards a pending choice immediately after manual player input', async () => {
    engine.window.dispatchEvent(new Event(AGENT_MANUAL_INPUT_EVENT))
    expect(complete.mock.calls[0][1].signal.aborted).toBe(true)
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(runtime.getPhase()).toBe('paused')
    expect(scene._messageWindow._choiceWindow.callOkHandler).not.toHaveBeenCalled()
  })

  test('does not apply a late choice after its parent signal is aborted', async () => {
    abort.abort()
    resolveChoice({ role: 'assistant', content: '1' })
    await running
    expect(scene._messageWindow._choiceWindow.callOkHandler).not.toHaveBeenCalled()
  })

  test.each(['scene', 'map', 'message', 'window', 'options', 'inactive'] as const)('discards a choice when its %s changes', async (changed) => {
    const choiceWindow = scene._messageWindow._choiceWindow
    if (changed === 'scene') engine.SceneManager._scene = new Scene_Map()
    if (changed === 'map') engine.$gameMap = { mapId: () => 100 }
    if (changed === 'message') engine.$gameMessage = { isChoice: () => true, choices: () => choices }
    if (changed === 'window') scene._messageWindow = new Scene_Map()._messageWindow
    if (changed === 'options') choices = ['New left', 'New right']
    if (changed === 'inactive') choiceWindow.active = false
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(choiceWindow.callOkHandler).not.toHaveBeenCalled()
    expect(scene._messageWindow._choiceWindow.callOkHandler).not.toHaveBeenCalled()
    const attempts = StoryFailureMemory.choiceAttempts(99, 0, ['Left', 'Right'], { requiresLockpick: false }, JSON.stringify(['', []]))
    expect(attempts.size).toBe(0)
  })

  test('does not auto-confirm map 215 in another game', async () => {
    engine.$gameMap.mapId = () => 215
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(engine.Input._currentState.ok).not.toBe(true)
    expect(scene._messageWindow._choiceWindow.callOkHandler).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(2)
  })

  test('waits for the choice window to become active before asking again', async () => {
    scene._messageWindow._choiceWindow.active = false
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(200)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(scene._messageWindow._choiceWindow.callOkHandler).not.toHaveBeenCalled()
    scene._messageWindow._choiceWindow.active = true
    await jest.advanceTimersByTimeAsync(50)
    expect(complete).toHaveBeenCalledTimes(2)
  })

  test('exits the old loop when stopped and immediately restarted', async () => {
    runtime.stop()
    const restarted = runtime.start()
    expect(complete).toHaveBeenCalledTimes(2)
    resolveChoice({ role: 'assistant', content: '1' })
    await running
    expect(complete).toHaveBeenCalledTimes(2)
    expect(scene._messageWindow._choiceWindow.callOkHandler).not.toHaveBeenCalled()
    runtime.stop()
    await restarted
  })

  test('stops on gameover without leaving the selected save session', async () => {
    const gotoTitle = jest.fn()
    const commandNewGame = jest.fn()
    engine.SceneManager._scene = new (class Scene_Gameover {
      gotoTitle = gotoTitle
      commandNewGame = commandNewGame
    })()
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(500)
    await running
    expect(runtime.isActive()).toBe(false)
    expect(runtime.getPhase()).toBe('paused')
    expect(gotoTitle).not.toHaveBeenCalled()
    expect(commandNewGame).not.toHaveBeenCalled()
  })

  test('lets the engine sample facing input before confirming an interaction', async () => {
    engine.$gameMessage.isChoice = () => false
    engine.$gamePlayer = { canMove: () => true, x: 0, y: 0 }
    jest.spyOn(StoryExplorationPlanner.prototype, 'findNextTarget').mockReturnValue({
      eventId: 99,
      x: 0,
      y: 1,
      kind: 'npc',
      name: 'Guide',
      priority: 1,
    })
    jest.spyOn(StoryExplorationPlanner.prototype, 'executeTarget').mockImplementation(async (_target, io) => {
      await io.press('down')
      await io.press('ok')
      return { success: true }
    })
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(engine.Input._currentState.down).toBe(true)
    expect(engine.Input._currentState.ok).not.toBe(true)
    await jest.advanceTimersByTimeAsync(100)
    expect(engine.Input._currentState.down).toBe(false)
    expect(engine.Input._currentState.ok).toBe(true)
  })

  test('stops an interaction exception without asking the puzzle model or retrying the target', async () => {
    engine.$gameMessage.isChoice = () => false
    engine.$gamePlayer = { canMove: () => true, x: 0, y: 0 }
    jest.spyOn(StoryExplorationPlanner.prototype, 'findNextTarget').mockReturnValue({
      eventId: 24,
      x: 17,
      y: 6,
      kind: 'other',
      name: 'EV024',
      priority: 1,
    })
    const failure = new TypeError("Cannot read properties of undefined (reading 'get')")
    const execute = jest.spyOn(StoryExplorationPlanner.prototype, 'executeTarget').mockRejectedValue(failure)
    const solve = jest.spyOn(StoryExplorationPlanner.prototype, 'resolvePuzzleTarget')
    resolveChoice({ role: 'assistant', content: '1' })
    await jest.advanceTimersByTimeAsync(1_000)
    await running
    expect(runtime.isActive()).toBe(false)
    expect(runtime.getSummary()).toContain('程序异常')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(solve).not.toHaveBeenCalled()
    expect(createLogger('story-runtime').warn).toHaveBeenCalledWith('Target interaction raised a runtime exception', { mapId: 99, eventId: 24, error: failure })
  })
})
