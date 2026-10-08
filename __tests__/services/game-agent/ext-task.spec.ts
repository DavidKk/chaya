jest.mock('@/services/runtime/agent-bridge', () => ({
  resolveAgentGame: jest.fn((gameId: string) => gameId),
  callAgentGame: jest.fn(),
}))
jest.mock('@/services/game-agent/session-store', () => ({ finishTurn: jest.fn() }))

import { startExtPlayTurn } from '@/services/game-agent/ext-task.server'
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
