import { buildRemoteMcpTools, loadRemotePluginTools, type RemoteToolDeps } from '@/components/webmcp/remote'
import { MCP_TOOLS } from '@/lib/integration/mcp-catalog'
import { REMOTE_UNAVAILABLE_TOOLS } from '@/lib/webmcp/mode-matrix'

jest.mock('@/lib/browser/agent-trace-store', () => ({
  browserAgentTraceArchive: {
    list: jest.fn(async () => [{ id: 'task-cloud', gameId: 'game-cloud', goal: '开宝箱', state: 'completed', eventCount: 1, updatedAt: 2 }]),
    read: jest.fn(async () => ({ id: 'task-cloud', gameId: 'game-cloud', goal: '开宝箱', state: 'completed', events: [{ seq: 1, type: 'game.dialogue', at: 2 }], messages: [] })),
  },
}))

function deps(overrides: Partial<RemoteToolDeps> = {}): RemoteToolDeps {
  return {
    connected: () => true,
    roomId: () => 'room-1',
    callAgent: jest.fn(async () => null) as unknown as RemoteToolDeps['callAgent'],
    translationRequest: jest.fn(async () => ({ status: 200, data: { ok: true } })),
    requestCatalog: jest.fn(),
    gameOnline: () => true,
    quit: jest.fn(),
    serviceMode: 'remote',
    ...overrides,
  }
}

describe('Remote WebMCP tools', () => {
  it('offers every MCP tool except the documented unavailable ones', () => {
    const names = buildRemoteMcpTools(deps()).map((tool) => tool.name)
    const expected = MCP_TOOLS.map((tool) => tool.name).filter((name) => !REMOTE_UNAVAILABLE_TOOLS[name])
    expect(names.sort()).toEqual(expected.sort())
    for (const name of Object.keys(REMOTE_UNAVAILABLE_TOOLS)) expect(MCP_TOOLS.some((tool) => tool.name === name)).toBe(true)
  })

  it('keeps catalog schemas and read-only annotations', () => {
    const tools = buildRemoteMcpTools(deps())
    const state = tools.find((tool) => tool.name === 'chaya_live_state')
    expect(state?.inputSchema).toEqual(MCP_TOOLS.find((tool) => tool.name === 'chaya_live_state')?.inputSchema)
    expect(state?.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true })
    expect(tools.find((tool) => tool.name === 'chaya_cache_update')?.annotations).toMatchObject({ consequentialHint: true })
  })

  it('reports game_offline when the DataChannel is down', async () => {
    const tool = buildRemoteMcpTools(deps({ connected: () => false })).find((entry) => entry.name === 'chaya_live_state')
    expect(await tool?.execute({})).toMatchObject({ ok: false, error: 'game_offline' })
  })

  it('rejects a gameId that is not the linked room', async () => {
    const tool = buildRemoteMcpTools(deps()).find((entry) => entry.name === 'chaya_live_state')
    expect(await tool?.execute({ gameId: 'other' })).toMatchObject({ ok: false, error: 'tool_error' })
  })

  it('reads Agent activity from IndexedDB through chaya_logs_query', async () => {
    const tool = buildRemoteMcpTools(deps()).find((entry) => entry.name === 'chaya_logs_query')
    await expect(tool?.execute({ view: 'agent' })).resolves.toMatchObject({ ok: true, result: { view: 'agent', tasks: [{ id: 'task-cloud' }] } })
    await expect(tool?.execute({ view: 'agent', taskId: 'task-cloud' })).resolves.toMatchObject({
      ok: true,
      result: { view: 'agent', events: [{ type: 'game.dialogue' }] },
    })
  })

  it('turns first-party plugin declarations into chaya_plugin_* tools', async () => {
    const callAgent = jest.fn(async (method: string) =>
      method === 'plugins.list'
        ? [
            { name: 'ChayaBoost', tools: [{ tool: 'on', title: '加速', description: '开启加速', inputSchema: { type: 'object', properties: {} } }] },
            { name: 'ChayaEvil', tools: [{ tool: 'x', title: 'x', description: 'x', inputSchema: { type: 'object', properties: {} } }] },
          ]
        : { rate: 5 }
    ) as unknown as RemoteToolDeps['callAgent']
    const tools = await loadRemotePluginTools(deps({ callAgent }))
    expect(tools.map((tool) => tool.name)).toEqual(['chaya_plugin_boost_on'])
    expect(await tools[0].execute({ rate: 5 })).toEqual({ ok: true, result: { rate: 5 } })
    expect(callAgent).toHaveBeenLastCalledWith('plugin.tool', { plugin: 'ChayaBoost', tool: 'on', input: { rate: 5 } })
  })
})
