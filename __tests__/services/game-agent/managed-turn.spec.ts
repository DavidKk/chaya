jest.mock('@/services/runtime/agent-bridge', () => ({ listAgentGames: jest.fn(() => [{ gameId: 'game-a' }]), callAgentGame: jest.fn() }))
jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn(() => '') }))
jest.mock('@/services/game-agent/session-store', () => ({ emitTurnEvent: jest.fn(), finishTurn: jest.fn() }))
jest.mock('@/services/game-agent/visual-observation.server', () => ({ findVisionModel: jest.fn(), inspectBattleImage: jest.fn(), battleImageFingerprint: jest.fn() }))

import { classifyGameIntent, runManagedTurn } from '@/services/game-agent/managed-turn.server'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import { emitTurnEvent, finishTurn } from '@/services/game-agent/session-store'
import type { GameAgentProfile } from '@/services/game-agent/settings'
import type { GameAgentTurn, StartTurnInput } from '@/services/game-agent/types'
import { battleImageFingerprint, findVisionModel, inspectBattleImage } from '@/services/game-agent/visual-observation.server'
import { callAgentGame } from '@/services/runtime/agent-bridge'

const profile = { id: 'local', endpoint: 'http://localhost:11434', keepAlive: '10m' } as GameAgentProfile
const input: StartTurnInput = { gameId: 'game-a', profileId: 'local', model: 'test', mode: 'ask', prompt: '帮我代打' }

function turn(): GameAgentTurn {
  return { id: 'turn', sessionId: 'session', gameId: 'game-a', abort: new AbortController(), state: 'running', startedAt: Date.now(), lastSeq: 0, events: [], listeners: new Set() }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(streamOllamaChat as jest.Mock).mockReset()
  ;(findVisionModel as jest.Mock).mockReset()
  ;(inspectBattleImage as jest.Mock).mockReset()
  ;(battleImageFingerprint as jest.Mock).mockReset()
})

test('routes an explicit battle handoff without relying on model intent classification', async () => {
  await expect(classifyGameIntent(input, profile, new AbortController().signal)).resolves.toEqual({ managed: true, edit: false })
  await expect(classifyGameIntent({ ...input, prompt: '帮我跳过当前剧情并总结' }, profile, new AbortController().signal)).resolves.toEqual({ managed: true, edit: false })
  expect(streamOllamaChat).not.toHaveBeenCalled()
})

test('executes one guarded input from a multi-call decision, then reobserves before the next decision', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const states = [
    {
      scene: 'Scene_Battle',
      map: { id: 1 },
      battle: { instanceId: 'battle-1' },
      controlToken: 'before',
      message: { busy: false },
      windows: [
        {
          name: 'partyCommandWindow',
          active: true,
          index: 0,
          symbol: 'fight',
          options: [
            { label: '战斗', symbol: 'fight' },
            { label: '逃跑', symbol: 'escape' },
          ],
        },
      ],
    },
    {
      scene: 'Scene_Battle',
      map: { id: 1 },
      battle: { instanceId: 'battle-1' },
      controlToken: 'after',
      message: { busy: false },
      windows: [
        {
          name: 'actorCommandWindow',
          active: true,
          index: 0,
          symbol: 'attack',
          options: [
            { label: '攻击', symbol: 'attack' },
            { label: '技能', symbol: 'skill' },
          ],
        },
      ],
    },
    { scene: 'Scene_Map', map: { id: 1 }, battle: null, lastBattleResult: { id: 'battle-1', result: 'victory' }, controlToken: 'done' },
  ]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? { entries: [], lastSeq: 0, dropped: 0 } : { key: 'ok' }))
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat.mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"完成当前战斗","scope":"battle"}' }).mockResolvedValue({ role: 'assistant', content: '{"index":0}' })

  await runManagedTurn(input, profile, turn())

  const calls = game.mock.calls.filter((call) => call[1] === 'input.press')
  expect(chat.mock.calls[1]?.[0].format).toMatchObject({ properties: { index: { enum: [0] } } })
  expect(calls).toHaveLength(2)
  expect(calls[0][2]).toMatchObject({ guard: { controlToken: 'before', battleInstanceId: 'battle-1' } })
  expect(calls[1][2]).toMatchObject({ guard: { controlToken: 'after', battleInstanceId: 'battle-1' } })
  expect(finishTurn).toHaveBeenCalledWith(expect.anything(), 'completed')
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', reason: 'verified' }))
})

test('uses vision for an image-only battle menu and guards the confirmed action', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const states = [
    { scene: 'Scene_Battle', map: { id: 1 }, battle: { instanceId: 'battle-1', phase: 'input' }, windows: [], controlToken: 'image-menu' },
    { scene: 'Scene_Map', map: { id: 1 }, battle: null, lastBattleResult: { id: 'battle-1', result: 'victory' } },
  ]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? { entries: [], lastSeq: 0, dropped: 0 } : {}))
  ;(streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>).mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"完成战斗","scope":"battle"}' })
  ;(findVisionModel as jest.MockedFunction<typeof findVisionModel>).mockResolvedValue('gemma4:vision')
  ;(inspectBattleImage as jest.MockedFunction<typeof inspectBattleImage>).mockResolvedValue({
    key: 'ok',
    visibleText: '攻击',
    selectedText: '攻击',
    targetText: '攻击',
    safe: true,
    imageFingerprint: 'before',
  })
  ;(battleImageFingerprint as jest.MockedFunction<typeof battleImageFingerprint>).mockResolvedValue('after')

  await runManagedTurn(input, profile, turn())

  expect(inspectBattleImage).toHaveBeenCalledWith(
    profile,
    'gemma4:vision',
    'test',
    'game-a',
    input.prompt,
    expect.objectContaining({ scene: 'Scene_Battle' }),
    expect.any(AbortSignal)
  )
  expect(game).toHaveBeenCalledWith(
    'game-a',
    'input.press',
    expect.objectContaining({
      key: 'ok',
      guard: expect.objectContaining({ controlToken: 'image-menu', battleInstanceId: 'battle-1', allowedEffects: expect.arrayContaining(['unknown']) }),
    })
  )
  expect(finishTurn).toHaveBeenCalledWith(expect.anything(), 'completed')
})

test('pauses when an image menu repeats the same navigation decision', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  game.mockImplementation(async (_id, method) =>
    method === 'game.state'
      ? { scene: 'Scene_Battle', map: { id: 1 }, battle: { instanceId: 'battle-1', turn: 1, phase: 'input', actor: { id: 2 } }, windows: [], controlToken: 'same' }
      : method === 'game.history'
        ? { entries: [], lastSeq: 0, dropped: 0 }
        : {}
  )
  ;(streamOllamaChat as jest.Mock).mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"完成战斗","scope":"battle"}' })
  ;(findVisionModel as jest.Mock).mockResolvedValue('gemma4:vision')
  ;(inspectBattleImage as jest.Mock).mockResolvedValue({ key: 'up', visibleText: '剑士 术士', selectedText: '术士', targetText: '剑士', safe: true, imageFingerprint: 'before' })
  ;(battleImageFingerprint as jest.Mock).mockResolvedValue('after')
  const active = turn()
  ;(emitTurnEvent as jest.Mock).mockImplementation((_turn, event) => {
    if (event.type === 'approval.required') {
      active.abort.abort()
      active.resume?.()
    }
  })

  await runManagedTurn(input, profile, active)

  expect(game.mock.calls.filter((call) => call[1] === 'input.press')).toHaveLength(1)
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'approval.required', question: expect.stringContaining('反复移动') }))
})

test('selects a non-default enemy before confirming the target', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const enemyMenu = (index: number) => ({
    scene: 'Scene_Battle',
    map: { id: 1 },
    battle: {
      instanceId: 'battle-1',
      enemies: [
        { name: '史莱姆', hp: 32 },
        { name: '灰狼', hp: 40 },
      ],
    },
    controlToken: `target-${index}`,
    message: { busy: false },
    windows: [{ name: 'enemyWindow', active: true, index, item: { name: index ? '灰狼' : '史莱姆' }, options: [{ label: '史莱姆' }, { label: '灰狼' }] }],
  })
  const states = [enemyMenu(0), enemyMenu(1), { scene: 'Scene_Map', map: { id: 1 }, battle: null, lastBattleResult: { id: 'battle-1', result: 'victory' } }]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? { entries: [], lastSeq: 0, dropped: 0 } : {}))
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat.mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"优先攻击灰狼","scope":"battle"}' }).mockResolvedValue({ role: 'assistant', content: '{"index":1}' })

  await runManagedTurn({ ...input, prompt: '帮我代打，优先攻击灰狼' }, profile, turn())

  const presses = game.mock.calls.filter((call) => call[1] === 'input.press')
  expect(presses.map((call) => call[2])).toEqual([
    expect.objectContaining({ key: 'down', guard: expect.objectContaining({ controlToken: 'target-0' }) }),
    expect.objectContaining({ key: 'ok', guard: expect.objectContaining({ controlToken: 'target-1' }) }),
  ])
  expect(finishTurn).toHaveBeenCalledWith(expect.anything(), 'completed')
})

test('arms the local reaction monitor for a battle and stops it when the turn ends', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const states = [
    {
      scene: 'Scene_Battle',
      map: { id: 1 },
      battle: { instanceId: 'battle-1' },
      reactionAvailable: true,
      controlToken: 'before',
      windows: [{ name: 'partyCommandWindow', active: true, index: 0, symbol: 'fight', options: [{ label: '战斗', symbol: 'fight' }] }],
    },
    {
      scene: 'Scene_Map',
      map: { id: 1 },
      battle: null,
      lastBattleResult: { id: 'battle-1', result: 'victory' },
      lastReaction: { id: 'dodge-1', latencyMs: 3 },
      qteOutcome: { id: 'dodge-1', result: 'success' },
    },
  ]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? { entries: [], lastSeq: 0, dropped: 0 } : {}))
  ;(streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>)
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"完成当前战斗","scope":"battle"}' })
    .mockResolvedValue({ role: 'assistant', content: '{"index":0}' })

  await runManagedTurn(input, profile, turn())

  const methods = game.mock.calls.map((call) => call[1])
  expect(methods.indexOf('input.reaction.arm')).toBeLessThan(methods.indexOf('input.press'))
  expect(methods.at(-1)).toBe('input.reaction.stop')
  expect(game).toHaveBeenCalledWith('game-a', 'input.reaction.arm', expect.objectContaining({ battleInstanceId: 'battle-1', allowedKeys: expect.arrayContaining(['left']) }))
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', text: expect.stringContaining('限时反应：成功') }))
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

test('asks the player when an unfamiliar battle menu has no available vision model', async () => {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  game.mockImplementation(async (_id, method) =>
    method === 'game.state'
      ? { scene: 'Scene_Battle', map: { id: 1 }, battle: { instanceId: 'battle-1' }, windows: [{ name: 'customWindow', active: true }], controlToken: 'current' }
      : { entries: [], lastSeq: 0, dropped: 0 }
  )
  ;(streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>)
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"完成当前战斗","scope":"battle"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'task_ask_user', arguments: { question: '要使用哪项技能？' } } }] })
  const active = turn()
  ;(emitTurnEvent as jest.Mock).mockImplementation((_turn, event) => {
    if (event.type === 'approval.required') {
      active.abort.abort()
      active.resume?.()
    }
  })

  await runManagedTurn(input, profile, active)

  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'approval.required', question: expect.stringContaining('视觉识别不可用') }))
  expect(game.mock.calls.some((call) => call[1] === 'input.press')).toBe(false)
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
    { entries: [{ seq: 2, kind: 'message', text: '職人が橋を修理した。', translated: '工匠修好了桥。' }], lastSeq: 2, dropped: 0 },
    { entries: [{ seq: 3, kind: 'message', text: '入口在村东。' }], lastSeq: 3, dropped: 0 },
    { entries: [], lastSeq: 3, dropped: 0 },
  ]
  game.mockImplementation(async (_id, method) => (method === 'game.state' ? states.shift() : method === 'game.history' ? histories.shift() : { key: 'ok' }))
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"跳过当前剧情","scope":"dialogue"}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"桥被雨冲断后由工匠修复，入口在村东。"}' })

  await runManagedTurn({ ...input, prompt: '跳过剧情并总结' }, profile, turn())

  expect(game.mock.calls.filter((call) => call[1] === 'input.press')).toHaveLength(3)
  const summaryInput = chat.mock.calls.at(-1)?.[0].messages.at(-1)?.content || ''
  expect(summaryInput).toContain('職人が橋を修理した。')
  expect(summaryInput).not.toContain('工匠修好了桥。')
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
  ;(streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>).mockResolvedValueOnce({ role: 'assistant', content: '{"summary":"跳过剧情","scope":"dialogue"}' })
  const active = turn()
  ;(emitTurnEvent as jest.Mock).mockImplementation((_turn, event) => {
    if (event.type === 'approval.required') {
      active.abort.abort()
      active.resume?.()
    }
  })

  await runManagedTurn({ ...input, prompt: '跳过剧情，遇到选项让我决定' }, profile, active)

  expect(game.mock.calls.filter((call) => call[1] === 'input.press')).toHaveLength(1)
  expect(emitTurnEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'approval.required', question: expect.stringContaining('请在游戏里选择，然后回复继续。') })
  )
  expect(finishTurn).toHaveBeenCalledWith(active, 'stopped')
})
