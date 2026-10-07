jest.mock('@/services/runtime/agent-bridge', () => ({ listAgentGames: jest.fn(() => [{ gameId: 'game-a' }]), callAgentGame: jest.fn() }))
jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn(() => '') }))
jest.mock('@/services/game-agent/session-store', () => ({ emitTurnEvent: jest.fn(), finishTurn: jest.fn() }))
jest.mock('@/services/game-agent/visual-observation.server', () => ({ findVisionModel: jest.fn(), inspectBattleImage: jest.fn(), battleImageFingerprint: jest.fn() }))

import { runManagedTurn } from '@/services/game-agent/managed-turn.server'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import { emitTurnEvent } from '@/services/game-agent/session-store'
import type { GameAgentProfile } from '@/services/game-agent/settings'
import type { GameAgentTurn, StartTurnInput } from '@/services/game-agent/types'
import { battleImageFingerprint, findVisionModel, inspectBattleImage } from '@/services/game-agent/visual-observation.server'
import { callAgentGame } from '@/services/runtime/agent-bridge'

test('animated screenshots do not hide a stalled structured battle menu', async () => {
  const state = {
    scene: 'Scene_Battle',
    map: { id: 1 },
    battle: { instanceId: 'battle-1' },
    windows: [
      {
        name: 'partyCommandWindow',
        active: true,
        index: 0,
        options: [
          { label: '战斗', symbol: 'fight' },
          { label: '逃跑', symbol: 'escape' },
        ],
      },
    ],
    controlToken: 'same',
  }
  ;(callAgentGame as jest.Mock).mockImplementation(async (_id, method) => (method === 'game.state' ? state : method === 'game.history' ? { entries: [], lastSeq: 0 } : {}))
  ;(streamOllamaChat as jest.Mock).mockResolvedValue({ role: 'assistant', content: '{"summary":"帮我战斗","scope":"battle"}' })
  let frame = 0
  ;(battleImageFingerprint as jest.Mock).mockImplementation(() => Promise.resolve(String(++frame)))
  ;(findVisionModel as jest.Mock).mockResolvedValue('vision')
  ;(inspectBattleImage as jest.Mock).mockResolvedValue({ key: null, safe: false, visibleText: '战斗 逃跑' })
  const turn = {
    id: 'turn',
    sessionId: 'session',
    gameId: 'game-a',
    abort: new AbortController(),
    state: 'running',
    startedAt: Date.now(),
    lastSeq: 0,
    events: [],
    listeners: new Set(),
  } as GameAgentTurn
  ;(emitTurnEvent as jest.Mock).mockImplementation((_turn, event) => {
    if (event.type === 'approval.required') {
      turn.abort.abort()
      turn.resume?.()
    }
  })

  await runManagedTurn(
    { gameId: 'game-a', profileId: 'local', model: 'test', mode: 'ask', prompt: '帮我战斗' } as StartTurnInput,
    { id: 'local', endpoint: 'http://localhost:11434', keepAlive: '10m' } as GameAgentProfile,
    turn
  )

  expect((callAgentGame as jest.Mock).mock.calls.filter((call) => call[1] === 'input.press')).toHaveLength(2)
  expect(inspectBattleImage).toHaveBeenCalledTimes(1)
  expect(emitTurnEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'approval.required', question: expect.stringContaining('无法确认图片菜单') }))
})
