jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn(() => '') }))

import { decide } from '@/services/game-agent/managed-decide.server'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import type { GameAgentProfile } from '@/services/game-agent/settings'
import type { StartTurnInput } from '@/services/game-agent/types'

const profile = { id: 'local', endpoint: 'http://localhost:11434', keepAlive: '10m' } as GameAgentProfile
const input = { gameId: 'game-a', profileId: 'local', model: 'test', mode: 'ask', prompt: '帮我战斗' } as StartTurnInput
const messages = [
  { role: 'system' as const, content: 'battle' },
  { role: 'user' as const, content: 'state' },
]

beforeEach(() => jest.clearAllMocks())

test('moves across a two-column skill menu before confirming the selected skill', async () => {
  const chat = streamOllamaChat as jest.Mock
  chat.mockResolvedValue({ role: 'assistant', content: '{"index":1}' })
  const state = {
    battle: { instanceId: 'battle-1' },
    windows: [{ name: 'skillWindow', active: true, index: 0, maxCols: 2, options: [{ label: '治疗' }, { label: '火球' }, { label: '守护' }, { label: '冰刃' }] }],
  }
  const decideNext = () => decide(profile, input, messages, state, 'battle', new AbortController().signal, async () => null)

  await expect(decideNext()).resolves.toMatchObject({ tool_calls: [{ function: { arguments: { key: 'right' } } }] })
  expect(chat.mock.calls[0][0]).toMatchObject({ think: true, messages: [expect.objectContaining({ content: expect.not.stringContaining('/no_think') }), expect.anything()] })
  state.windows[0].index = 1
  await expect(decideNext()).resolves.toMatchObject({ tool_calls: [{ function: { arguments: { key: 'ok' } } }] })
})

test('enables reasoning when the acting party has no MP', async () => {
  const chat = streamOllamaChat as jest.Mock
  chat.mockResolvedValue({ role: 'assistant', content: '{"index":0}' })
  await decide(
    profile,
    input,
    messages,
    {
      battle: { instanceId: 'battle-1' },
      party: [{ hp: 30, mhp: 30, mp: 0 }],
      windows: [{ name: 'actorCommandWindow', active: true, index: 0, options: [{ symbol: 'attack' }, { symbol: 'skill' }] }],
    },
    'battle',
    new AbortController().signal,
    async () => null
  )
  expect(chat.mock.calls[0][0]).toMatchObject({ think: true, maxTokens: 384 })
})
