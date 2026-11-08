jest.mock('@/services/runtime/agent-bridge', () => ({
  resolveAgentGame: jest.fn((gameId: string) => gameId),
  callAgentGame: jest.fn(),
}))
jest.mock('@/services/game-agent/session-store', () => ({ finishTurn: jest.fn() }))

import { pumpExtTask, startExtPlayTurn } from '@/services/game-agent/ext-task.server'
import { finishTurn } from '@/services/game-agent/session-store'
import type { GameAgentEvent, GameAgentTurn } from '@/services/game-agent/types'
import { callAgentGame } from '@/services/runtime/agent-bridge'

test('starts play in ext and maps authoritative progress to the server SSE shape', async () => {
  const call = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  call.mockResolvedValueOnce({ id: 'turn-1', state: 'running' }).mockResolvedValueOnce({
    gap: false,
    task: { id: 'turn-1', state: 'completed' },
    events: [
      { seq: 1, type: 'phase', at: 1, data: { phase: 'acting', step: 1, maxSteps: 80 } },
      { seq: 2, type: 'progress.updated', at: 2, data: { summary: '已完成当前战斗，继续观察。', cycle: 1, reason: 'answered', steps: 2, toolCalls: 1 } },
      { seq: 3, type: 'assistant.completed', at: 3, data: { text: 'done', reason: 'answered' } },
    ],
  })
  const turn: GameAgentTurn = {
    id: 'turn-1',
    sessionId: 'session-1',
    gameId: 'game-1',
    abort: new AbortController(),
    state: 'running',
    startedAt: 0,
    lastSeq: 0,
    events: [],
    listeners: new Set(),
  }
  const events: GameAgentEvent[] = []

  await startExtPlayTurn({ gameId: 'game-1', profileId: 'profile', model: 'model', mode: 'play', prompt: 'go' }, turn, (event) => events.push(event))

  expect(call.mock.calls[0][1]).toBe('agent.task')
  expect(call.mock.calls[0][2]).toMatchObject({
    message: { type: 'agent.task.start', taskId: 'turn-1', conversationId: 'session-1', capability: 'play', profileId: 'profile', model: 'model', goal: 'go' },
  })
  expect(events).toEqual([
    { type: 'phase', phase: 'acting', step: 1, maxSteps: 80 },
    { type: 'progress.updated', summary: '已完成当前战斗，继续观察。', cycle: 1, reason: 'answered', steps: 2, toolCalls: 1 },
    { type: 'assistant.delta', text: 'done' },
    { type: 'turn.completed', text: '', reason: 'verified' },
  ])
  expect(finishTurn).toHaveBeenCalledWith(turn, 'completed')
})

describe('custody task polling', () => {
  const call = callAgentGame as jest.MockedFunction<typeof callAgentGame>

  beforeEach(() => {
    jest.useFakeTimers()
    call.mockReset()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('terminates after ten consecutive missing task responses', async () => {
    call.mockResolvedValue({ task: null, events: [] })
    const emit = jest.fn()
    const pending = pumpExtTask('game-1', 'task-1', new AbortController().signal, 0, emit, undefined, true)
    await jest.advanceTimersByTimeAsync(9_000)
    await pending
    expect(call).toHaveBeenCalledTimes(10)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({ type: 'turn.stopped' })
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(['failed', 'interrupted'] as const)('reports the terminal %s state immediately', async (state) => {
    call.mockResolvedValue({ task: { state, error: 'Executor exited' }, events: [] })
    const emit = jest.fn()
    await pumpExtTask('game-1', 'task-1', new AbortController().signal, 0, emit, undefined, true)
    expect(call).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({
      type: 'turn.failed',
      code: state === 'interrupted' ? 'AGENT_TASK_INTERRUPTED' : 'AGENT_TURN_FAILED',
      message: 'Executor exited',
    })
    expect(jest.getTimerCount()).toBe(0)
  })

  test('resets the error budget only after a healthy task response', async () => {
    for (let attempt = 0; attempt < 9; attempt++) call.mockResolvedValueOnce({ task: null })
    call.mockResolvedValueOnce({ task: { state: 'running' } })
    call.mockResolvedValue({ task: null })
    const emit = jest.fn()
    const pending = pumpExtTask('game-1', 'task-1', new AbortController().signal, 0, emit, undefined, true)
    await jest.advanceTimersByTimeAsync(17_500)
    expect(emit).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1_000)
    await pending
    expect(call).toHaveBeenCalledTimes(20)
    expect(emit).toHaveBeenCalledWith({ type: 'turn.stopped' })
  })

  test('counts mixed transport failures and missing tasks toward the same retry limit', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      call.mockRejectedValueOnce(new Error('Connection unavailable')).mockResolvedValueOnce({ task: null })
    }
    const emit = jest.fn()
    const pending = pumpExtTask('game-1', 'task-1', new AbortController().signal, 0, emit, undefined, true)
    await jest.advanceTimersByTimeAsync(9_000)
    await pending
    expect(call).toHaveBeenCalledTimes(10)
    expect(emit).toHaveBeenCalledWith({ type: 'turn.stopped' })
  })

  test('cancels a retry wait immediately without polling again', async () => {
    call.mockResolvedValue({ task: null })
    const abort = new AbortController()
    const pending = pumpExtTask('game-1', 'task-1', abort.signal, 0, jest.fn(), undefined, true)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await jest.advanceTimersByTimeAsync(0)
    abort.abort()
    await rejected
    expect(call).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test('finishes the server turn when custody fails', async () => {
    call.mockResolvedValueOnce({ state: 'running' }).mockResolvedValue({ task: { state: 'failed' } })
    const turn: GameAgentTurn = {
      id: 'turn-1',
      sessionId: 'session-1',
      gameId: 'game-1',
      abort: new AbortController(),
      state: 'running',
      startedAt: 0,
      lastSeq: 0,
      events: [],
      listeners: new Set(),
    }
    const pending = startExtPlayTurn({ gameId: 'game-1', profileId: 'profile', model: 'model', mode: 'play', prompt: 'go', lifetime: 'until_stopped' }, turn, jest.fn())
    await jest.advanceTimersByTimeAsync(9_000)
    await pending
    expect(finishTurn).toHaveBeenCalledWith(turn, 'failed')
  })

  test('reports completion even for custody tasks', async () => {
    call.mockResolvedValue({ task: { state: 'completed' } })
    const emit = jest.fn()
    await pumpExtTask('game-1', 'task-1', new AbortController().signal, 0, emit, undefined, true)
    expect(call).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({ type: 'turn.completed', text: '', reason: 'verified' })
  })
})
