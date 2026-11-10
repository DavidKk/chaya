import { applyCompanionMessageEvent, type CompanionEventApplyState } from '@/components/game-agent/companion-event-apply'
import type { CompanionMessageEvent } from '@/lib/runtime/companion-protocol'

const state = (): CompanionEventApplyState => ({
  consumerId: 'panel',
  conversationId: 'conversation',
  chatRequestId: 'route-1',
  character: 'rin',
  messages: [],
  seenSeq: new Set(),
  seenKeys: new Set(),
  afterSeq: 0,
  gameId: 'game',
})
const status = (): CompanionMessageEvent => ({
  seq: 1,
  at: 100,
  kind: 'model.status',
  requestId: 'route-1',
  messageId: 'loading',
  conversationId: 'conversation',
  stamp: { scope: { libraryGameId: 'game', dataRevision: '', playthroughId: '', runtimeInstanceId: 'runtime', segmentId: '' }, contextEpoch: 1, factsRevision: 1 },
  modelStatus: { phase: 'loading', residency: 'cold' },
})

test('cold start changes progress without creating a chat reply or completing the request', () => {
  const result = applyCompanionMessageEvent(state(), status())
  expect(result.chatProgress).toContain('冷启动')
  expect(result.messages).toBeNull()
  expect(result.chatRequestId).toBe('route-1')
  expect(result.chatBusy).toBeNull()
})

test('missing status payload cannot falsely report readiness', () => {
  expect(applyCompanionMessageEvent(state(), { ...status(), modelStatus: undefined }).chatProgress).toBeNull()
})

test('an unavailable residency probe does not claim that the model is loaded', () => {
  const result = applyCompanionMessageEvent(state(), { ...status(), modelStatus: { phase: 'ready', residency: 'unknown' } })
  expect(result.chatProgress).toBe('正在连接模型，准备生成…')
})

test.each([
  { requestId: 'old-route' },
  { conversationId: 'other-conversation' },
  { stamp: { ...status().stamp, scope: { ...status().stamp.scope, libraryGameId: 'other-game' } } },
])('foreign or stale loading status cannot replace current progress: %j', (patch) => {
  const result = applyCompanionMessageEvent(state(), { ...status(), ...patch })
  expect(result.chatProgress).toBeNull()
  expect(result.messages).toBeNull()
})

test('completed event with thought attaches thinking process to chat message', () => {
  const event: CompanionMessageEvent = {
    seq: 2,
    at: 200,
    kind: 'completed',
    requestId: 'route-1',
    messageId: 'msg-1',
    conversationId: 'conversation',
    stamp: status().stamp,
    text: '这是一条回复',
    thought: '模型思考分析中，推导最优对话...',
    metrics: { generationMs: 1500 } as never,
  }
  const result = applyCompanionMessageEvent(state(), event)
  expect(result.messages).toHaveLength(1)
  expect(result.messages![0].text).toBe('这是一条回复')
  expect(result.messages![0].thought).toEqual(
    expect.objectContaining({
      thought: '模型思考分析中，推导最优对话...',
      durationMs: 1500,
    })
  )
})

test('completed event with thought but empty text preserves thought without dropping message', () => {
  const event: CompanionMessageEvent = {
    seq: 3,
    at: 300,
    kind: 'completed',
    requestId: 'route-1',
    messageId: 'msg-2',
    conversationId: 'conversation',
    stamp: status().stamp,
    thought: '仅有深度思考，暂未产生正文',
  }
  const result = applyCompanionMessageEvent(state(), event)
  expect(result.messages).toHaveLength(1)
  expect(result.messages![0].text).toBe('')
  expect(result.messages![0].thought?.thought).toBe('仅有深度思考，暂未产生正文')
})
