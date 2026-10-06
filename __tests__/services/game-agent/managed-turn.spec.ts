jest.mock('@/services/runtime/agent-bridge', () => ({ listAgentGames: jest.fn(() => [{ gameId: 'game-a' }]), callAgentGame: jest.fn() }))
jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn(() => '') }))
jest.mock('@/services/game-agent/session-store', () => ({ emitTurnEvent: jest.fn(), finishTurn: jest.fn() }))
jest.mock('@/services/game-agent/visual-observation.server', () => ({ findVisionModel: jest.fn(), inspectBattleImage: jest.fn(), battleImageFingerprint: jest.fn() }))

import { decide } from '@/services/game-agent/managed-decide.server'
import { resolveGoal } from '@/services/game-agent/managed-goal.server'
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

test('routes play requests in any language through the model instead of keyword matching', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({
    scene: 'Scene_Battle',
    battle: { instanceId: 'battle-1' },
    inventory: { items: [{ name: '药草' }] },
    screenText: '开始战斗 图片菜单',
  })
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat.mockResolvedValue({ role: 'assistant', content: '{"operate":true,"edit":false}' })

  await expect(classifyGameIntent({ ...input, prompt: '이 전투를 대신 싸워줘' }, profile, new AbortController().signal)).resolves.toEqual({ managed: true, edit: false })
  const sent = chat.mock.calls[0][0].messages[1].content
  expect(sent).toContain('이 전투를 대신 싸워줘')
  expect(sent).toContain('"inBattle":true')
  expect(sent).not.toMatch(/药草|开始战斗/)
})

test('retries an invalid intent classification before routing', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({ scene: 'Scene_Map', nearbyEvents: [{ id: 1, name: '村长', distance: 2 }] })
  const chat = streamOllamaChat as jest.Mock
  chat.mockResolvedValueOnce({ role: 'assistant', content: 'not json' }).mockResolvedValueOnce({ role: 'assistant', content: '{"operate":true,"edit":false}' })

  await expect(classifyGameIntent({ ...input, prompt: '找村长聊聊' }, profile, new AbortController().signal)).resolves.toEqual({ managed: true, edit: false })
  expect(chat).toHaveBeenCalledTimes(2)
  expect(chat.mock.calls.map((call: unknown[]) => (call[0] as { think?: boolean }).think)).toEqual([false, true])
})

test('rechecks a read-only classification before dropping an in-game action', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({ scene: 'Scene_Map', map: { id: 1, name: '村庄' }, nearbyEvents: [{ id: 2, name: '森林入口', distance: 4 }] })
  const chat = streamOllamaChat as jest.Mock
  chat
    .mockResolvedValueOnce({ role: 'assistant', content: '{"operate":false,"edit":false}' })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"operate":true,"edit":false}' })

  await expect(classifyGameIntent({ ...input, prompt: '打开宝箱' }, profile, new AbortController().signal)).resolves.toEqual({ managed: true, edit: false })
  expect(chat.mock.calls[1][0].messages[1].content).toContain('不要把操作请求改写成建议')
})

test('uses the model decision to authorize escape across languages', async () => {
  ;(streamOllamaChat as jest.Mock).mockResolvedValue({
    role: 'assistant',
    content: JSON.stringify({ summary: 'Flee this fight', scope: 'battle', targetEventId: null, skill: null, allowEscape: true, openQuestion: null }),
  })
  const goal = await resolveGoal(
    profile,
    { ...input, prompt: 'Please flee this fight' },
    { scene: 'Scene_Battle', battle: { instanceId: 'battle-1' } },
    new AbortController().signal
  )
  expect(goal).toMatchObject({ scope: 'battle', allowEscape: true })
})

test('uses thinking for tactical battle choices but not the opening command', async () => {
  const chat = streamOllamaChat as jest.Mock
  chat.mockResolvedValue({ role: 'assistant', content: '{"index":0}' })
  const state = {
    battle: { instanceId: 'battle-1', enemies: [{ hp: 10 }, { hp: 8 }] },
    party: [
      { hp: 30, mhp: 30 },
      { hp: 8, mhp: 30 },
    ],
    windows: [{ name: 'partyCommandWindow', active: true, index: 0, options: [{ symbol: 'fight' }, { symbol: 'escape' }] }],
  }
  const messages = [
    { role: 'system' as const, content: 'battle' },
    { role: 'user' as const, content: 'state' },
  ]
  await decide(profile, input, messages, state, 'battle', new AbortController().signal, async () => null)
  expect(chat.mock.calls[0][0]).toMatchObject({ think: false, maxTokens: 64 })

  state.windows[0] = { name: 'enemyWindow', active: true, index: 0, options: [{ symbol: 'enemy' }, { symbol: 'enemy' }] }
  await decide(profile, input, messages, state, 'battle', new AbortController().signal, async () => null)
  expect(chat.mock.calls[1][0]).toMatchObject({ think: true, maxTokens: 384 })
})

type MapEventMock = {
  id: number
  name: string
  x: number
  y: number
  trigger?: string
  sprite?: string
  hint?: string
  text?: string
  transfer?: { mapId: number; name: string; x?: number; y?: number }
}

/** Small map: moveTo reaches any free tile unless `blocked`, ok on a faced action event shows its text. */
function mockMap(
  events: MapEventMock[],
  start: { x: number; y: number; direction: number },
  options: { blocked?: boolean; manualAfterMove?: boolean; initialMapId?: number; maps?: Record<number, { name: string; events: MapEventMock[] }> } = {}
) {
  const game = callAgentGame as jest.MockedFunction<typeof callAgentGame>
  const player = { ...start }
  const map = { id: options.initialMapId || 1, name: options.maps?.[options.initialMapId || 1]?.name || '村庄' }
  const currentEvents = () => options.maps?.[map.id]?.events || (map.id === 1 ? events : [])
  let message = ''
  let speaker = ''
  let storySeq = 0
  let stateVersion = 0
  let manualInputEpoch = 0
  const front = () => ({ x: player.x + ({ 4: -1, 6: 1 }[player.direction] ?? 0), y: player.y + ({ 8: -1, 2: 1 }[player.direction] ?? 0) })
  game.mockImplementation(async (_id, method, params) => {
    if (method === 'game.state')
      return {
        scene: 'Scene_Map',
        map: { ...map },
        player: { ...player },
        nearbyEvents: currentEvents().map((event) => ({ ...event, distance: Math.abs(event.x - player.x) + Math.abs(event.y - player.y) })),
        message: { busy: !!message, text: message },
        controlToken: `step-${stateVersion}`,
        manualInputEpoch,
      }
    if (method === 'game.history') return { entries: storySeq ? [{ seq: storySeq, kind: 'message', text: message || '…', speaker }] : [], lastSeq: storySeq, dropped: 0 }
    stateVersion++
    if (method === 'player.moveTo') {
      const { x, y, stepwise } = params as { x: number; y: number; stepwise?: boolean }
      if (options.manualAfterMove) manualInputEpoch++
      if (options.blocked) return { arrived: false }
      const nextX = stepwise ? player.x + Math.sign(x - player.x) : x
      const nextY = stepwise && nextX !== player.x ? player.y : stepwise ? player.y + Math.sign(y - player.y) : y
      const event = currentEvents().find((item) => item.x === nextX && item.y === nextY)
      if (event && !event.transfer) return { arrived: false }
      player.x = nextX
      player.y = nextY
      if (event?.transfer) {
        map.id = event.transfer.mapId
        map.name = event.transfer.name
        player.x = event.transfer.x ?? player.x
        player.y = event.transfer.y ?? player.y
        return { arrived: false, moved: true, transferred: true, triggeredEventId: event.id }
      }
      return { arrived: player.x === x && player.y === y, moved: true }
    }
    const key = (params as { key: string }).key
    if (key === 'ok') {
      const faced = currentEvents().find((event) => event.x === front().x && event.y === front().y)
      if (message) message = ''
      else if (faced?.text) {
        message = faced.text
        speaker = faced.name
        storySeq++
      }
    } else player.direction = { left: 4, right: 6, up: 8, down: 2 }[key as 'left' | 'right' | 'up' | 'down']
    return { key }
  })
  return game
}

const pressedKeys = (game: jest.MockedFunction<typeof callAgentGame>) => game.mock.calls.filter((call) => call[1] === 'input.press').map((call) => (call[2] as { key: string }).key)
const moves = (game: jest.MockedFunction<typeof callAgentGame>) => game.mock.calls.filter((call) => call[1] === 'player.moveTo').map((call) => call[2])
const resolveTo = (targetEventId: number, skill: 'approach' | 'interact') =>
  (streamOllamaChat as jest.Mock).mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '目标', scope: 'map', targetEventId, skill, openQuestion: null }) })

test('walks next to the village elder with game pathfinding, faces him and verifies the dialogue ended', async () => {
  const game = mockMap([{ id: 1, name: '村长', x: 8, y: 4, trigger: 'action', text: '欢迎来到村庄。' }], { x: 11, y: 6, direction: 8 })
  resolveTo(1, 'interact').mockResolvedValue({ role: 'assistant', content: '{"summary":"村长欢迎旅行者来到村庄。"}' })

  await runManagedTurn({ ...input, prompt: '帮我跟村长对话' }, profile, turn())

  expect(moves(game).at(-1)).toEqual(expect.objectContaining({ x: 8, y: 5, stepwise: true, guard: expect.objectContaining({ allowedEffects: ['navigate'] }) }))
  expect(pressedKeys(game)).toEqual(['ok', 'ok'])
  expect(game).toHaveBeenCalledWith(
    'game-a',
    'input.press',
    expect.objectContaining({ key: 'ok', guard: expect.objectContaining({ targetEventId: 1, allowedEffects: expect.arrayContaining(['interact_event']) }) })
  )
  expect(emitTurnEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'turn.completed', reason: 'verified', text: expect.stringContaining('欢迎来到村庄') })
  )
})

test('opens a chest from a non-Chinese request via the interact map skill without asking for confirmation', async () => {
  const game = mockMap([{ id: 1, name: '宝箱', x: 11, y: 5, sprite: '!Chest', trigger: 'action', text: '打开了宝箱。' }], { x: 11, y: 8, direction: 2 })
  const chat = resolveTo(1, 'interact').mockResolvedValue({ role: 'assistant', content: '{"summary":"打开了宝箱。"}' })

  await runManagedTurn({ ...input, prompt: '보물상자 좀 열어줘' }, profile, turn())

  expect(chat.mock.calls[0][0].format).toMatchObject({ properties: { targetEventId: { enum: [1, null] }, skill: { enum: ['approach', 'interact', null] } } })
  expect(pressedKeys(game)).toEqual(['up', 'ok', 'ok'])
  expect(emitTurnEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'approval.required' }))
  expect(emitTurnEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'turn.completed', reason: 'verified', text: expect.stringContaining('已与宝箱完成交互') })
  )
})

test('enters a door by stepping onto its touch event and treats the transfer as success', async () => {
  const game = mockMap([{ id: 3, name: '村长家门口', x: 13, y: 3, trigger: 'player_touch', transfer: { mapId: 3, name: '村长的家' } }], { x: 13, y: 10, direction: 8 })
  resolveTo(3, 'interact')

  await runManagedTurn({ ...input, prompt: '进入村长家门口' }, profile, turn())

  expect(moves(game).at(-1)).toEqual(expect.objectContaining({ x: 13, y: 3, stepwise: true }))
  expect(pressedKeys(game)).toEqual([])
  expect(emitTurnEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'turn.completed', reason: 'verified', text: expect.stringContaining('已进入村长的家') })
  )
})

test('returns through the village and keeps acting until the forest chest is opened', async () => {
  const maps = {
    1: { name: '村庄', events: [{ id: 2, name: '森林入口', x: 16, y: 6, trigger: 'player_touch', transfer: { mapId: 2, name: '森林', x: 1, y: 6 } }] },
    2: { name: '森林', events: [{ id: 1, name: '宝箱', x: 11, y: 5, trigger: 'action', hint: '打开了宝箱。', text: '打开了宝箱。' }] },
    3: { name: '村长的家', events: [{ id: 2, name: '出门', x: 8, y: 12, trigger: 'player_touch', transfer: { mapId: 1, name: '村庄', x: 13, y: 4 } }] },
  }
  const game = mockMap([], { x: 8, y: 10, direction: 2 }, { initialMapId: 3, maps })
  ;(streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '打开宝箱', scope: 'map_event', targetEventId: 2, skill: 'interact', transit: true }) })
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '打开宝箱', scope: 'map_event', targetEventId: 2, skill: 'interact', transit: true }) })
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '打开宝箱', scope: 'map_event', targetEventId: 1, skill: 'interact', transit: false }) })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"direct":true}' })
    .mockResolvedValue({ role: 'assistant', content: '{"summary":"打开了宝箱。"}' })

  await runManagedTurn({ ...input, prompt: '打开宝箱' }, profile, turn())

  expect(moves(game).map((move) => (move as { guard: { mapId: number } }).guard.mapId)).toEqual(expect.arrayContaining([3, 1, 2]))
  expect(pressedKeys(game)).toContain('ok')
  expect(emitTurnEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'turn.completed', reason: 'verified', text: expect.stringContaining('已与宝箱完成交互') })
  )
  expect((emitTurnEvent as jest.Mock).mock.calls.filter((call) => call[1].type === 'turn.completed')).toHaveLength(1)
})

test('rejects a different named event as the final target and selects a route instead', async () => {
  const state = {
    scene: 'Scene_Map',
    map: { id: 1, name: '村庄' },
    nearbyEvents: [
      { id: 2, name: '森林入口', trigger: 'player_touch' },
      { id: 3, name: '村长家门口', trigger: 'player_touch' },
    ],
  }
  const chat = streamOllamaChat as jest.Mock
  chat
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '打开宝箱', scope: 'map_event', targetEventId: 3, skill: 'interact', transit: false }) })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"direct":false}' })
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({ summary: '经森林入口寻找宝箱', scope: 'map_event', targetEventId: 2, skill: 'interact', transit: true }),
    })

  const goal = await resolveGoal(profile, { ...input, prompt: '打开宝箱' }, state, new AbortController().signal)

  expect(goal).toMatchObject({ scope: 'map', targetEventId: 2, transit: true })
  expect(chat.mock.calls[1][0].messages[1].content).toContain('村长家门口')
})

test('stops after a route returns to an already tried exit', async () => {
  const maps = {
    1: { name: '村庄', events: [{ id: 3, name: '村长家门口', x: 13, y: 3, trigger: 'player_touch', transfer: { mapId: 3, name: '村长的家', x: 8, y: 11 } }] },
    3: { name: '村长的家', events: [{ id: 2, name: '出门', x: 8, y: 12, trigger: 'player_touch', transfer: { mapId: 1, name: '村庄', x: 13, y: 4 } }] },
  }
  const game = mockMap([], { x: 13, y: 4, direction: 8 }, { maps })
  ;(streamOllamaChat as jest.Mock)
    .mockResolvedValue({ role: 'assistant', content: JSON.stringify({ summary: '找宝箱', scope: 'map_event', targetEventId: 3, skill: 'interact', transit: true }) })
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '找宝箱', scope: 'map_event', targetEventId: 3, skill: 'interact', transit: true }) })
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '找宝箱', scope: 'map_event', targetEventId: 2, skill: 'interact', transit: true }) })

  await runManagedTurn({ ...input, prompt: '打开宝箱' }, profile, turn())

  expect(game.mock.calls.filter((call) => call[1] === 'player.moveTo' && (call[2] as { guard: { mapId: number } }).guard.mapId === 1)).toHaveLength(1)
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.failed', message: expect.stringContaining('重复绕行') }))
  expect(emitTurnEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed' }))
})

test('does not claim a touch interaction succeeded when a bump has no effect', async () => {
  const game = mockMap([{ id: 3, name: '关着的门', x: 8, y: 4, trigger: 'player_touch' }], { x: 8, y: 5, direction: 8 })
  resolveTo(3, 'interact')

  await runManagedTurn({ ...input, prompt: '进这扇门' }, profile, turn())

  expect(pressedKeys(game)).toEqual(['up'])
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.failed', message: expect.stringContaining('无法确认完成') }))
})

test('does not ask when the goal is already bound, even if the model adds a question', async () => {
  mockMap([{ id: 2, name: '村长夫人', x: 5, y: 6, trigger: 'action', text: '我家老头子又在外面跟人聊天了吧。' }], { x: 5, y: 9, direction: 8 })
  ;(streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({ summary: '与村长夫人聊天', scope: 'map', targetEventId: 2, skill: 'interact', openQuestion: '你是想和村长夫人聊天吗？' }),
    })
    .mockResolvedValue({ role: 'assistant', content: '{"summary":"夫人说村长在外面聊天。"}' })

  await runManagedTurn({ ...input, prompt: '找村长夫人聊天' }, profile, turn())

  expect(emitTurnEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'approval.required' }))
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', text: expect.stringContaining('已与村长夫人完成交互') }))
})

test('treats "talk to X" as a map interaction even when the model picks the on-screen dialogue scope', async () => {
  const game = mockMap([{ id: 1, name: '村长', x: 8, y: 4, trigger: 'action', text: '欢迎来到村庄。' }], { x: 8, y: 7, direction: 8 })
  const chat = (streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '与村长对话', scope: 'visible_dialogue', targetEventId: 1, skill: null, openQuestion: null }) })
    .mockResolvedValue({ role: 'assistant', content: '{"summary":"村长欢迎旅行者。"}' })

  await runManagedTurn({ ...input, prompt: '帮我跟村长对话' }, profile, turn())

  expect(chat.mock.calls[0][0].format).toMatchObject({ properties: { scope: { enum: ['battle', 'visible_dialogue', 'map_event', 'unclear'] } } })
  expect(pressedKeys(game)).toEqual(['ok', 'ok'])
  expect(emitTurnEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'approval.required' }))
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', text: expect.stringContaining('已与村长完成交互') }))
})

test('does not claim success when an interaction has no observable effect', async () => {
  const game = mockMap([{ id: 1, name: '村长', x: 8, y: 4, trigger: 'action' }], { x: 8, y: 7, direction: 8 })
  resolveTo(1, 'interact')

  await runManagedTurn({ ...input, prompt: '跟村长对话' }, profile, turn())

  expect(pressedKeys(game)).toEqual(['ok'])
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.failed', message: expect.stringContaining('无法确认完成') }))
})

test('asks the model again when it finds the event but omits the map skill', async () => {
  const game = mockMap([{ id: 1, name: '村长', x: 8, y: 4, trigger: 'action', text: '你好。' }], { x: 8, y: 7, direction: 8 })
  const chat = (streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '找村长', scope: 'map_event', targetEventId: 1, skill: null, openQuestion: null }) })
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '与村长交谈', scope: 'map_event', targetEventId: 1, skill: 'interact', openQuestion: null }) })
    .mockResolvedValue({ role: 'assistant', content: '{"summary":"村长问好。"}' })

  await runManagedTurn({ ...input, prompt: '找村长聊聊' }, profile, turn())

  expect(chat.mock.calls[1][0].messages[1].content).toContain('缺少动作')
  expect(chat.mock.calls[1][0].think).toBe(true)
  expect(pressedKeys(game)).toEqual(['ok', 'ok'])
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', reason: 'verified' }))
})

test('rechecks an approach decision before treating finding a person as done', async () => {
  const game = mockMap([{ id: 1, name: '村长', x: 8, y: 4, trigger: 'action', text: '你好。' }], { x: 8, y: 7, direction: 8 })
  const chat = (streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '找到村长', scope: 'map', targetEventId: 1, skill: 'approach', openQuestion: null }) })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"stopBeside":false}' })
    .mockResolvedValue({ role: 'assistant', content: '{"summary":"村长问好。"}' })

  await runManagedTurn({ ...input, prompt: '找村长' }, profile, turn())

  expect(chat.mock.calls[1][0].messages[0].content).toContain('只判断玩家是否明确要求走到目标旁边就停止')
  expect(pressedKeys(game)).toEqual(['ok', 'ok'])
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', text: expect.stringContaining('已与村长完成交互') }))
})

test('gives the summarizer speakers and the interaction partner', async () => {
  mockMap([{ id: 2, name: '村长夫人', x: 5, y: 6, trigger: 'action', text: '我家老头子又在外面跟人聊天了吧。' }], { x: 5, y: 9, direction: 8 })
  const chat = resolveTo(2, 'interact').mockResolvedValue({ role: 'assistant', content: '{"summary":"村长夫人说村长又在外面聊天。"}' })

  await runManagedTurn({ ...input, prompt: '跟村长夫人互动' }, profile, turn())

  const summaryInput = chat.mock.calls.at(-1)?.[0].messages.at(-1)?.content || ''
  expect(summaryInput).toContain('与“村长夫人”交互')
  expect(summaryInput).toContain('村长夫人：我家老头子又在外面跟人聊天了吧。')
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', text: expect.stringContaining('记录到的剧情：村长夫人：') }))
})

test('re-understands the player reply as the newest instruction instead of failing', async () => {
  mockMap([{ id: 2, name: '村长夫人', x: 5, y: 6, trigger: 'action', text: '我家老头子又在外面跟人聊天了吧。' }], { x: 5, y: 9, direction: 8 })
  const chat = (streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '找人聊天', scope: 'unclear', targetEventId: null, skill: null, openQuestion: '你想找谁？' }) })
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '找人聊天', scope: 'unclear', targetEventId: null, skill: null, openQuestion: '你想找谁？' }) })
    .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ summary: '与村长夫人互动', scope: 'map', targetEventId: 2, skill: 'interact', openQuestion: null }) })
    .mockResolvedValue({ role: 'assistant', content: '{"summary":"夫人说村长在外面聊天。"}' })
  const active = turn()
  ;(emitTurnEvent as jest.Mock).mockImplementation((_turn, event) => {
    if (event.type !== 'approval.required') return
    active.reply = '跟村长夫人互动'
    active.resume?.()
  })

  await runManagedTurn({ ...input, prompt: '找她聊天' }, profile, active)

  expect(JSON.parse(chat.mock.calls[2][0].messages[1].content)).toMatchObject({ request: '跟村长夫人互动', earlierRequest: '找她聊天' })
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.completed', text: expect.stringContaining('已与村长夫人完成交互') }))
})

test('keeps asking up to the clarification limit before giving up', async () => {
  mockMap([{ id: 2, name: '村长夫人', x: 5, y: 6, trigger: 'action' }], { x: 5, y: 9, direction: 8 })
  ;(streamOllamaChat as jest.Mock).mockResolvedValue({
    role: 'assistant',
    content: JSON.stringify({ summary: '不明确', scope: 'unclear', targetEventId: null, skill: null, openQuestion: '你想做什么？' }),
  })
  const active = turn()
  ;(emitTurnEvent as jest.Mock).mockImplementation((_turn, event) => {
    if (event.type !== 'approval.required') return
    active.reply = '随便'
    active.resume?.()
  })

  await runManagedTurn({ ...input, prompt: '嗯' }, profile, active)

  expect((emitTurnEvent as jest.Mock).mock.calls.filter((call) => call[1].type === 'approval.required')).toHaveLength(2)
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.failed', message: expect.stringContaining('多次补充后仍无法确定目标') }))
})

test('the approach map skill stops next to the event without triggering it', async () => {
  const game = mockMap([{ id: 1, name: '宝箱', x: 11, y: 5, trigger: 'action', text: '打开了宝箱。' }], { x: 11, y: 9, direction: 8 })
  resolveTo(1, 'approach').mockResolvedValueOnce({ role: 'assistant', content: '{"stopBeside":true}' })

  await runManagedTurn({ ...input, prompt: '走到宝箱旁边' }, profile, turn())

  expect(moves(game).at(-1)).toEqual(expect.objectContaining({ x: 11, y: 6, stepwise: true }))
  expect(pressedKeys(game)).toEqual([])
  expect(emitTurnEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'turn.completed', reason: 'verified', text: expect.stringContaining('已到达宝箱旁') })
  )
})

test('fails with a clear reason when no tile beside the target is reachable', async () => {
  const game = mockMap([{ id: 1, name: '宝箱', x: 11, y: 5, trigger: 'action' }], { x: 11, y: 9, direction: 8 }, { blocked: true })
  resolveTo(1, 'interact')

  await runManagedTurn({ ...input, prompt: '打开宝箱' }, profile, turn())

  expect(moves(game)).toHaveLength(4)
  expect(pressedKeys(game)).toEqual([])
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.failed', message: expect.stringContaining('无法走到宝箱旁边') }))
})

test('stops the task as soon as the player operates the game', async () => {
  const game = mockMap([{ id: 1, name: '宝箱', x: 11, y: 5, trigger: 'action', text: '打开了宝箱。' }], { x: 11, y: 9, direction: 8 }, { manualAfterMove: true })
  resolveTo(1, 'interact')

  await runManagedTurn({ ...input, prompt: '打开宝箱' }, profile, turn())

  expect(pressedKeys(game)).toEqual([])
  expect(finishTurn).toHaveBeenCalledWith(expect.anything(), 'stopped')
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'turn.stopped' }))
  expect(emitTurnEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'approval.required' }))
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
