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
