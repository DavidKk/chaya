jest.mock('@/services/runtime/agent-bridge', () => ({
  callAgentGame: jest.fn(),
  listAgentGames: jest.fn(),
  listPluginTools: jest.fn(),
}))

import { createGameAgentTools, executeGameAgentTool } from '@/services/game-agent/tool-runtime'
import { callAgentGame, listAgentGames, listPluginTools } from '@/services/runtime/agent-bridge'

const mockedCall = callAgentGame as jest.MockedFunction<typeof callAgentGame>
const mockedGames = listAgentGames as jest.MockedFunction<typeof listAgentGames>
const mockedPlugins = listPluginTools as jest.MockedFunction<typeof listPluginTools>

beforeEach(() => {
  mockedGames.mockReturnValue([{ gameId: 'game-a', lastSeenMs: 0, toolCount: 1, name: 'Demo' }])
  mockedPlugins.mockReturnValue([
    {
      plugin: 'ChayaBoost',
      tool: 'on',
      title: 'Boost on',
      description: 'Boost movement',
      inputSchema: { type: 'object', properties: { rate: { type: 'number' } } },
      gameIds: ['game-a'],
    },
  ])
})

test('offers the bound game tools while excluding destructive and oversized tools', () => {
  const names = createGameAgentTools('game-a').map((tool) => tool.definition.function.name)
  expect(names).toEqual(expect.arrayContaining(['chaya_live_state', 'chaya_live_play', 'chaya_edit_set', 'chaya_plugin_boost_on']))
  expect(names).not.toEqual(expect.arrayContaining(['chaya_live_screenshot', 'chaya_live_quit', 'chaya_live_eval', 'chaya_edit_action']))
})

test('forces the bound game id and includes read-back verification after a write', async () => {
  mockedCall.mockImplementation(async (_gameId, method) => {
    if (method === 'edit.apply') return { applied: true }
    if (method === 'edit.state') return { session: { walkRate: 2 } }
    return {}
  })
  const tools = createGameAgentTools('game-a')
  const result = await executeGameAgentTool(tools, 'chaya_edit_set', { gameId: 'other-game', op: 'walkRate', value: 2 }, 'game-a', new AbortController().signal)
  expect(result.ok).toBe(true)
  expect(JSON.parse(result.content)).toEqual({ ok: true, result: { applied: true }, verification: { session: { walkRate: 2 } } })
  expect(mockedCall).toHaveBeenNthCalledWith(1, 'game-a', 'edit.apply', { op: { op: 'walkRate', value: 2 } })
  expect(mockedCall).toHaveBeenNthCalledWith(2, 'game-a', 'edit.state', {})
})

test('returns tool errors to the model instead of ending the turn', async () => {
  mockedCall.mockRejectedValueOnce(new Error('game unavailable'))
  const result = await executeGameAgentTool(createGameAgentTools('game-a'), 'chaya_live_state', {}, 'game-a', new AbortController().signal)
  expect(result.ok).toBe(false)
  expect(JSON.parse(result.content)).toEqual({ ok: false, error: 'game unavailable' })
})

test('keeps a completed write successful when only read-back verification fails', async () => {
  mockedCall.mockImplementation(async (_gameId, method) => {
    if (method === 'edit.apply') return { applied: true }
    throw new Error('verification unavailable')
  })
  const result = await executeGameAgentTool(createGameAgentTools('game-a'), 'chaya_edit_set', { op: 'gold', value: 10 }, 'game-a', new AbortController().signal)
  expect(result.ok).toBe(true)
  expect(JSON.parse(result.content)).toEqual({ ok: true, result: { applied: true }, verificationError: 'verification unavailable' })
})
