jest.mock('@/services/runtime/agent-bridge', () => ({ listAgentGames: jest.fn(() => [{ gameId: 'game-a' }]), callAgentGame: jest.fn() }))
jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn(() => '') }))
jest.mock('@/services/game-agent/session-store', () => ({ emitTurnEvent: jest.fn(), finishTurn: jest.fn() }))

import { runManagedTurn } from '@/services/game-agent/managed-turn.server'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import { emitTurnEvent, finishTurn } from '@/services/game-agent/session-store'
import type { GameAgentProfile } from '@/services/game-agent/settings'
import type { GameAgentTurn, StartTurnInput } from '@/services/game-agent/types'
import { callAgentGame } from '@/services/runtime/agent-bridge'

const profile = { id: 'local', endpoint: 'http://localhost:11434', keepAlive: '10m' } as GameAgentProfile
const input: StartTurnInput = { gameId: 'game-a', profileId: 'local', model: 'test', mode: 'ask', prompt: '帮我代打' }

function turn(): GameAgentTurn {
  return { id: 'turn', sessionId: 'session', gameId: 'game-a', abort: new AbortController(), state: 'running', startedAt: Date.now(), lastSeq: 0, events: [], listeners: new Set() }
}

beforeEach(() => jest.clearAllMocks())

test('executes one guarded input from a multi-call decision, then reobserves before the next decision', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const states = [
    { scene: 'Scene_Battle', map: { id: 1 }, battle: { instanceId: 'battle-1' }, controlToken: 'before', message: { busy: false } },
    { scene: 'Scene_Battle', map: { id: 1 }, battle: { instanceId: 'battle-1' }, controlToken: 'after', message: { busy: false } },
    { scene: 'Scene_Map', map: { id: 1 }, battle: null, lastBattleResult: { id: 'battle-1', result: 'victory' }, controlToken: 'done' },
  ]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? { entries: [], lastSeq: 0, dropped: 0 } : { key: 'ok' }))
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat.mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"完成当前战斗","scope":"battle"}' }).mockResolvedValue({
    role: 'assistant',
    content: '',
    tool_calls: [{ function: { name: 'task_press', arguments: { key: 'ok' } } }, { function: { name: 'task_press', arguments: { key: 'ok' } } }],
  })

  await runManagedTurn(input, profile, turn())

  const calls = game.mock.calls.filter((call) => call[1] === 'input.press')
  expect(calls).toHaveLength(2)
  expect(calls[0][2]).toMatchObject({ guard: { controlToken: 'before', battleInstanceId: 'battle-1' } })
  expect(calls[1][2]).toMatchObject({ guard: { controlToken: 'after', battleInstanceId: 'battle-1' } })
  expect(finishTurn).toHaveBeenCalledWith(expect.anything(), 'completed')
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', reason: 'verified' }))
})

test('stale control token causes a fresh observation before another input', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const states = [
    { scene: 'Scene_Battle', map: { id: 1 }, battle: { instanceId: 'battle-1' }, controlToken: 'stale' },
    { scene: 'Scene_Battle', map: { id: 1 }, battle: { instanceId: 'battle-1' }, controlToken: 'fresh' },
    { scene: 'Scene_Map', map: { id: 1 }, battle: null, lastBattleResult: { id: 'battle-1', result: 'victory' }, controlToken: 'done' },
  ]
  let press = 0
  game.mockImplementation(async (_id, method) => {
    if (method === 'game.state') return states.shift()
    if (method === 'game.history') return { entries: [], lastSeq: 0, dropped: 0 }
    if (++press === 1) throw new Error('STATE_CHANGED')
    return { key: 'ok' }
  })
  ;(streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>)
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"完成当前战斗","scope":"battle"}' })
    .mockResolvedValue({
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'task_press', arguments: { key: 'ok' } } }],
    })

  await runManagedTurn(input, profile, turn())

  const calls = game.mock.calls.filter((call) => call[1] === 'input.press')
  expect(calls[0][2]).toMatchObject({ guard: { controlToken: 'stale' } })
  expect(calls[1][2]).toMatchObject({ guard: { controlToken: 'fresh' } })
})

test('includes the dialogue already visible at task start in the verified summary', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const states = [
    { scene: 'Scene_Map', map: { id: 1 }, message: { busy: true, text: '村长说桥已经修好。' }, controlToken: 'before' },
    { scene: 'Scene_Map', map: { id: 1 }, message: { busy: false, text: '' }, controlToken: 'after' },
  ]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? { entries: [], lastSeq: 3, dropped: 0 } : { key: 'ok' }))
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"跳过并总结当前剧情","scope":"dialogue"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"action":"press","key":"ok"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'task_finish', arguments: { evidence: '编造的结局' } } }] })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"桥已经修好。"}' })

  await runManagedTurn({ ...input, prompt: '跳过剧情并总结' }, profile, turn())

  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', text: expect.stringContaining('村长说桥已经修好') }))
  expect(emitTurnEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'assistant.delta', text: expect.stringContaining('编造的结局') }))
})

test('advances each visible line and summarizes only recorded dialogue after the window closes', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const states = [
    { scene: 'Scene_Map', map: { id: 1 }, message: { busy: true, text: '桥被雨冲断。' }, controlToken: 'line-1' },
    { scene: 'Scene_Map', map: { id: 1 }, message: { busy: true, text: '工匠修好了桥。' }, controlToken: 'line-2' },
    { scene: 'Scene_Map', map: { id: 1 }, message: { busy: true, text: '入口在村东。' }, controlToken: 'line-3' },
    { scene: 'Scene_Map', map: { id: 1 }, message: { busy: false, text: '' }, controlToken: 'done' },
  ]
  const histories = [
    { entries: [{ seq: 1, kind: 'message', text: '桥被雨冲断。' }], lastSeq: 1, dropped: 0 },
    { entries: [{ seq: 2, kind: 'message', text: '工匠修好了桥。' }], lastSeq: 2, dropped: 0 },
    { entries: [{ seq: 3, kind: 'message', text: '入口在村东。' }], lastSeq: 3, dropped: 0 },
    { entries: [], lastSeq: 3, dropped: 0 },
  ]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? histories.shift() : { key: 'ok' }))
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"跳过当前剧情","scope":"dialogue"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"action":"press","key":"ok"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"action":"press","key":"ok"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"action":"press","key":"ok"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'task_finish', arguments: { evidence: '窗口关闭' } } }] })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"桥被雨冲断后由工匠修复，入口在村东。"}' })

  await runManagedTurn({ ...input, prompt: '跳过剧情并总结' }, profile, turn())

  expect(game.mock.calls.filter((call) => call[1] === 'input.press')).toHaveLength(3)
  expect(emitTurnEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'turn.completed', reason: 'verified', text: expect.stringContaining('剧情摘要：桥被雨冲断后由工匠修复') })
  )
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', text: expect.stringContaining('入口在村东。') }))
})

test('pauses at a story choice without selecting a branch', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const states = [
    { scene: 'Scene_Map', map: { id: 1 }, message: { busy: true, text: '桥修好了。' }, controlToken: 'line' },
    { scene: 'Scene_Map', map: { id: 1 }, message: { busy: true, text: '现在出发吗？', choices: ['现在出发', '稍后再去'] }, controlToken: 'choice' },
  ]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? { entries: [], lastSeq: 0, dropped: 0 } : { key: 'ok' }))
  ;(streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>)
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"跳过剧情","scope":"dialogue"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"action":"press","key":"ok"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"action":"ask_user","question":"现在出发还是稍后再去？"}' })
  const active = turn()
  ;(emitTurnEvent as jest.Mock).mockImplementation((_turn, event) => {
    if (event.type === 'approval.required') {
      active.abort.abort()
      active.resume?.()
    }
  })

  await runManagedTurn({ ...input, prompt: '跳过剧情，遇到选项让我决定' }, profile, active)

  expect(game.mock.calls.filter((call) => call[1] === 'input.press')).toHaveLength(1)
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'approval.required', question: '现在出发还是稍后再去？' }))
  expect(finishTurn).toHaveBeenCalledWith(active, 'stopped')
})
