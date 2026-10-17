import { loadCompanionTranscript, saveCompanionTranscript } from '@/components/game-agent/companion-transcript'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

test('persists semantic gameplay events in the companion activity stream', () => {
  const target = storage()
  saveCompanionTranscript(
    'game-a',
    {
      messages: [],
      activity: [
        { seq: 1, type: 'agent.decision', data: { summary: '选择宝箱' } },
        { seq: 2, type: 'game.dialogue', data: { summary: '老人：你好' } },
        { seq: 3, type: 'game.watch.triggered', data: { changes: [{ kind: 'battle_changed' }] } },
        { seq: 4, type: 'unrelated.internal', data: {} },
      ],
    },
    target
  )

  expect(loadCompanionTranscript('game-a', target).activity.map((event) => event.type)).toEqual(['agent.decision', 'game.dialogue', 'game.watch.triggered'])
})

test('retains tool starts and terminal events for the live timer lifecycle', () => {
  const target = storage()
  saveCompanionTranscript(
    'game-a',
    {
      messages: [],
      activity: [
        { seq: 1, type: 'tool.started', at: 1000, data: { callId: 'call', startedAt: 1000 } },
        { seq: 2, type: 'turn.stopped', at: 2000 },
      ],
    },
    target
  )
  expect(loadCompanionTranscript('game-a', target).activity.map((event) => event.type)).toEqual(['tool.started', 'turn.stopped'])
})
