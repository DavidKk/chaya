jest.mock('@/services/runtime/agent-bridge', () => ({ listAgentGames: jest.fn(() => [{ gameId: 'game-a' }]), callAgentGame: jest.fn(async () => ({ scene: 'map' })) }))
jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/tool-runtime.server', () => ({
  createGameAgentTools: jest.fn(() => [
    {
      definition: { type: 'function', function: { name: 'chaya_edit_set', description: 'set', parameters: { type: 'object' } } },
      readOnly: false,
      run: jest.fn(),
    },
  ]),
  executeGameAgentTool: jest.fn(async () => ({ ok: true, content: '{"ok":true,"verification":{"walkRate":2}}' })),
}))
jest.mock('@/services/game-agent/session-store', () => ({ finishTurn: jest.fn() }))
jest.mock('@/services/log', () => ({ appendLog: jest.fn() }))

import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import type { GameAgentProfile } from '@/services/game-agent/settings'
import { executeGameAgentTool } from '@/services/game-agent/tool-runtime.server'
import { runAskTurn } from '@/services/game-agent/turn-runner.server'
import type { GameAgentEvent, GameAgentSession, GameAgentTurn } from '@/services/game-agent/types'
import { appendLog } from '@/services/log'
import { callAgentGame, listAgentGames } from '@/services/runtime/agent-bridge'

beforeEach(() => jest.clearAllMocks())

test('executes Gemma tool calls, returns the tool result, then emits the verified answer', async () => {
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat
    .mockResolvedValueOnce({
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'chaya_edit_set', arguments: { op: 'walkRate', value: 2 } } }],
    })
    .mockResolvedValueOnce({ role: 'assistant', content: '移动速度已设置为 2 倍。' })
  const session: GameAgentSession = { id: 'session', gameId: 'game-a', model: 'gemma', profileId: 'local', messages: [], activeTurnId: 'turn', updatedAt: 0 }
  const turn: GameAgentTurn = { id: 'turn', sessionId: 'session', gameId: 'game-a', abort: new AbortController(), state: 'running', startedAt: 0 }
  const profile = {
    id: 'local',
    label: 'Local',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    defaultModel: 'gemma',
    temperature: 0.2,
    keepAlive: '10m',
  } as GameAgentProfile
  const events: GameAgentEvent[] = []

  await runAskTurn({ gameId: 'game-a', model: 'gemma', profileId: 'local', mode: 'ask', prompt: '速度改成两倍' }, profile, session, turn, (event) => events.push(event))

  expect(executeGameAgentTool).toHaveBeenCalledWith(expect.any(Array), 'chaya_edit_set', { op: 'walkRate', value: 2 }, 'game-a', turn.abort.signal)
  expect(chat.mock.calls[1][0].messages).toContainEqual({ role: 'tool', tool_name: 'chaya_edit_set', content: '{"ok":true,"verification":{"walkRate":2}}' })
  expect(events).toContainEqual({ type: 'tool.started', callId: '1-0', name: 'chaya_edit_set' })
  expect(events).toContainEqual({ type: 'tool.completed', callId: '1-0', name: 'chaya_edit_set', ok: true })
  expect(appendLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', source: 'ChayaAgent', message: 'tool.started chaya_edit_set' }))
  expect(appendLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'ok', source: 'ChayaAgent', message: 'tool.completed chaya_edit_set ok' }))
  expect(events).toContainEqual({ type: 'assistant.delta', text: '移动速度已设置为 2 倍。' })
  expect(events).toContainEqual({ type: 'turn.completed', text: '移动速度已设置为 2 倍。', reason: 'answered' })
})

test('answers through service tools without reading game state when no game is connected', async () => {
  ;(listAgentGames as jest.MockedFunction<typeof listAgentGames>).mockReturnValue([])
  ;(streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>).mockResolvedValueOnce({ role: 'assistant', content: '本地服务可用。' })
  const session: GameAgentSession = { id: 'session', gameId: 'chaya-console', model: 'gemma', profileId: 'local', messages: [], activeTurnId: 'turn', updatedAt: 0 }
  const turn: GameAgentTurn = { id: 'turn', sessionId: 'session', gameId: 'chaya-console', abort: new AbortController(), state: 'running', startedAt: 0 }
  const profile = {
    id: 'local',
    label: 'Local',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    defaultModel: 'gemma',
    temperature: 0.2,
    keepAlive: '10m',
  } as GameAgentProfile
  const events: GameAgentEvent[] = []

  await runAskTurn({ gameId: 'chaya-console', model: 'gemma', profileId: 'local', mode: 'ask', prompt: '检查服务' }, profile, session, turn, (event) => events.push(event))

  expect(callAgentGame).not.toHaveBeenCalled()
  expect(events).toContainEqual({ type: 'assistant.delta', text: '本地服务可用。' })
})
